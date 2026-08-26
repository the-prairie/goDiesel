"""Independent validation of retained route-scoped structure tilesets."""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from .canonical import sha256_file, strict_json_load
from .errors import IntegrityError, ValidationError
from .geometry import EARTH_RADIUS_M


_B3DM_HEADER = struct.Struct("<4s6I")
_CONTENT_KEYS = {
    "uri",
    "region",
    "sourceSha256",
    "sourceByteSize",
    "derivedSha256",
    "derivedByteSize",
    "transform",
}


def _record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be an object")
    return value


def _digest(value: object, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValidationError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _positive_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValidationError(f"{label} must be a positive integer")
    return value


def _safe_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValidationError(f"{label} must have content")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".b3dm":
        raise ValidationError(f"{label} is not a safe B3DM path")
    return path.as_posix()


def _region(value: object, label: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != 6:
        raise ValidationError(f"{label} must contain six numbers")
    if any(
        isinstance(item, bool)
        or not isinstance(item, (int, float))
        or not math.isfinite(float(item))
        for item in value
    ):
        raise ValidationError(f"{label} contains an invalid number")
    region = tuple(float(item) for item in value)
    if region[0] > region[2] or region[1] > region[3] or region[4] > region[5]:
        raise ValidationError(f"{label} bounds are reversed")
    return region


def _validate_b3dm(path: Path) -> None:
    with path.open("rb") as source:
        header_bytes = source.read(_B3DM_HEADER.size)
        if len(header_bytes) != _B3DM_HEADER.size:
            raise IntegrityError(f"retained B3DM is truncated: {path}")
        magic, version, length, feature_json, feature_binary, batch_json, batch_binary = (
            _B3DM_HEADER.unpack(header_bytes)
        )
        payload_offset = (
            _B3DM_HEADER.size
            + feature_json
            + feature_binary
            + batch_json
            + batch_binary
        )
        source.seek(payload_offset)
        glb_header = source.read(12)
    if (
        magic != b"b3dm"
        or version != 1
        or length != path.stat().st_size
        or batch_json != 0
        or batch_binary != 0
        or len(glb_header) != 12
        or glb_header[:4] != b"glTF"
        or struct.unpack_from("<I", glb_header, 8)[0] != length - payload_offset
    ):
        raise IntegrityError(f"retained B3DM contract is invalid: {path}")


@dataclass(frozen=True)
class StructureContent:
    uri: str
    region: tuple[float, ...]
    source_sha256: str
    source_byte_size: int
    derived_sha256: str
    derived_byte_size: int


@dataclass(frozen=True)
class StructureTileset:
    root: Path
    dataset_id: str
    source_year: int
    source_tileset_uri: str
    source_manifest_sha256: str
    corridor_radius_m: int
    vertical_alignment_offset_m: float
    vertical_alignment_residual_p95_m: float
    vertical_alignment_sample_count: int
    contents: tuple[StructureContent, ...]

    @classmethod
    def load(cls, root: Path) -> "StructureTileset":
        root = root.resolve()
        if not root.is_dir() or root.is_symlink():
            raise ValidationError(f"structure tileset is not a regular directory: {root}")
        manifest_path = root / "source-manifest.json"
        tileset_path = root / "tileset.json"
        for path in (manifest_path, tileset_path):
            if not path.is_file() or path.is_symlink():
                raise ValidationError(f"structure tileset file is unavailable: {path}")

        manifest = _record(strict_json_load(manifest_path), "structure source manifest")
        if set(manifest) != {
            "schemaVersion",
            "datasetId",
            "sourceYear",
            "sourceTilesetUri",
            "sourceTilesetSha256",
            "corridorRadiusM",
            "verticalAlignment",
            "contents",
        } or manifest.get("schemaVersion") != 1:
            raise ValidationError("structure source manifest has unsupported fields")
        dataset_id = manifest.get("datasetId")
        if (
            not isinstance(dataset_id, str)
            or not dataset_id
            or PurePosixPath(dataset_id).name != dataset_id
        ):
            raise ValidationError("structure dataset ID is not a safe path segment")
        source_year = manifest.get("sourceYear")
        if isinstance(source_year, bool) or not isinstance(source_year, int):
            raise ValidationError("structure source year must be an integer")
        source_uri = manifest.get("sourceTilesetUri")
        if not isinstance(source_uri, str) or not source_uri:
            raise ValidationError("structure source URI must have content")
        _digest(manifest.get("sourceTilesetSha256"), "structure source tileset hash")
        corridor_radius_m = _positive_integer(
            manifest.get("corridorRadiusM"), "structure corridor radius"
        )
        alignment = _record(
            manifest.get("verticalAlignment"), "structure vertical alignment"
        )
        if set(alignment) != {
            "method",
            "offsetM",
            "residualP95M",
            "sampleCount",
            "semantics",
        } or alignment.get("method") != "route-to-region-lower-bound-median-v1":
            raise ValidationError("structure vertical alignment has unsupported fields")
        offset = alignment.get("offsetM")
        residual = alignment.get("residualP95M")
        if (
            isinstance(offset, bool)
            or not isinstance(offset, (int, float))
            or not math.isfinite(float(offset))
            or isinstance(residual, bool)
            or not isinstance(residual, (int, float))
            or not math.isfinite(float(residual))
            or float(residual) < 0
        ):
            raise ValidationError("structure vertical alignment values are invalid")
        sample_count = _positive_integer(
            alignment.get("sampleCount"), "structure vertical alignment sample count"
        )
        if not isinstance(alignment.get("semantics"), str) or not alignment["semantics"]:
            raise ValidationError("structure vertical alignment semantics are missing")
        raw_contents = manifest.get("contents")
        if not isinstance(raw_contents, list) or not raw_contents:
            raise ValidationError("structure source manifest needs content")

        contents: list[StructureContent] = []
        expected_files = {Path("source-manifest.json"), Path("tileset.json")}
        for index, value in enumerate(raw_contents):
            item = _record(value, f"structure content {index}")
            if set(item) != _CONTENT_KEYS or item.get("transform") != "strip-b3dm-batch-table-v1":
                raise ValidationError(f"structure content {index} has unsupported fields")
            uri = _safe_path(item.get("uri"), f"structure content {index} URI")
            target = root / PurePosixPath(uri)
            if not target.is_file() or target.is_symlink():
                raise IntegrityError(f"retained structure content is unavailable: {uri}")
            derived_size = _positive_integer(
                item.get("derivedByteSize"), f"structure content {index} size"
            )
            derived_hash = _digest(
                item.get("derivedSha256"), f"structure content {index} hash"
            )
            if target.stat().st_size != derived_size or sha256_file(target) != derived_hash:
                raise IntegrityError(f"retained structure content identity mismatch: {uri}")
            _validate_b3dm(target)
            expected_files.add(Path(uri))
            contents.append(
                StructureContent(
                    uri=uri,
                    region=_region(item.get("region"), f"structure content {index} region"),
                    source_sha256=_digest(
                        item.get("sourceSha256"), f"structure content {index} source hash"
                    ),
                    source_byte_size=_positive_integer(
                        item.get("sourceByteSize"), f"structure content {index} source size"
                    ),
                    derived_sha256=derived_hash,
                    derived_byte_size=derived_size,
                )
            )
        if len({content.uri for content in contents}) != len(contents):
            raise ValidationError("structure source manifest repeats a content URI")
        actual_files = {
            path.relative_to(root)
            for path in root.rglob("*")
            if path.is_file()
        }
        if actual_files != expected_files:
            raise IntegrityError("structure tileset contains undeclared or missing files")

        tileset = _record(strict_json_load(tileset_path), "retained structure tileset")
        tileset_root = _record(tileset.get("root"), "retained structure tileset root")
        children = tileset_root.get("children")
        if not isinstance(children, list):
            raise ValidationError("retained structure tileset children must be an array")
        references: dict[str, tuple[float, ...]] = {}
        for index, value in enumerate(children):
            child = _record(value, f"retained structure child {index}")
            content = _record(child.get("content"), f"retained structure child {index} content")
            volume = _record(
                child.get("boundingVolume"),
                f"retained structure child {index} bounding volume",
            )
            uri = _safe_path(content.get("uri"), f"retained structure child {index} URI")
            references[uri] = _region(
                volume.get("region"), f"retained structure child {index} region"
            )
        declared = {content.uri: content.region for content in contents}
        if references != declared:
            raise IntegrityError("structure tileset references disagree with source manifest")
        return cls(
            root=root,
            dataset_id=dataset_id,
            source_year=source_year,
            source_tileset_uri=source_uri,
            source_manifest_sha256=sha256_file(manifest_path),
            corridor_radius_m=corridor_radius_m,
            vertical_alignment_offset_m=float(offset),
            vertical_alignment_residual_p95_m=float(residual),
            vertical_alignment_sample_count=sample_count,
            contents=tuple(contents),
        )

    def covers_local_point(
        self,
        x: float,
        y: float,
        origin_latitude: float,
        origin_longitude: float,
    ) -> bool:
        latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
        longitude_scale = latitude_scale * math.cos(math.radians(origin_latitude))
        longitude = origin_longitude + x / longitude_scale
        latitude = origin_latitude + y / latitude_scale
        return any(
            math.degrees(content.region[0]) <= longitude <= math.degrees(content.region[2])
            and math.degrees(content.region[1]) <= latitude <= math.degrees(content.region[3])
            for content in self.contents
        )
