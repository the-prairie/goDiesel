"""Deterministic route-corridor subsets of PLATEAU LOD1 3D Tiles."""

from __future__ import annotations

import math
import os
import shutil
import statistics
import struct
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import urlopen

from .canonical import (
    canonical_json_document,
    sha256_bytes,
    strict_json_loads,
)
from .errors import AcquisitionError, IntegrityError, ValidationError
from .geometry import EARTH_RADIUS_M, route_local_points
from .route import load_canonical_route


_B3DM_HEADER = struct.Struct("<4s6I")


def _record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be an object")
    return value


def _safe_content_uri(uri: object) -> str:
    if not isinstance(uri, str) or not uri:
        raise ValidationError("3D Tiles content URI must have content")
    parsed = urlparse(uri)
    path = PurePosixPath(unquote(parsed.path))
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValidationError("3D Tiles content URI must be a relative path")
    if path.is_absolute() or ".." in path.parts or path.suffix.lower() != ".b3dm":
        raise ValidationError(f"unsafe 3D Tiles content URI: {uri}")
    return path.as_posix()


def _source_url(root_url: str, relative_uri: str) -> str:
    resolved = urljoin(root_url, relative_uri)
    root = urlparse(root_url)
    candidate = urlparse(resolved)
    if (candidate.scheme, candidate.netloc) != (root.scheme, root.netloc):
        raise ValidationError("3D Tiles content escapes its source origin")
    root_directory = PurePosixPath(unquote(root.path)).parent
    candidate_path = PurePosixPath(unquote(candidate.path))
    try:
        candidate_path.relative_to(root_directory)
    except ValueError as error:
        raise ValidationError("3D Tiles content escapes its source prefix") from error
    return resolved


def _fetch(uri: str) -> bytes:
    try:
        with urlopen(uri, timeout=90) as response:
            return response.read()
    except (OSError, ValueError) as error:
        raise AcquisitionError(f"could not acquire 3D Tiles source: {uri}") from error


def _region(value: object, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 6:
        raise ValidationError(f"{label} region must contain six numbers")
    if any(
        isinstance(item, bool)
        or not isinstance(item, (int, float))
        or not math.isfinite(float(item))
        for item in value
    ):
        raise ValidationError(f"{label} region contains an invalid number")
    result = [float(item) for item in value]
    if result[0] > result[2] or result[1] > result[3] or result[4] > result[5]:
        raise ValidationError(f"{label} region bounds are reversed")
    return result


def _leaf_contents(tile: object) -> list[tuple[str, list[float]]]:
    result: list[tuple[str, list[float]]] = []

    def visit(value: object, inherited_region: list[float] | None) -> None:
        node = _record(value, "3D Tiles tile")
        volume = node.get("boundingVolume")
        node_region = inherited_region
        if volume is not None:
            node_region = _region(
                _record(volume, "3D Tiles bounding volume").get("region"),
                "3D Tiles bounding volume",
            )
        children = node.get("children", [])
        if not isinstance(children, list):
            raise ValidationError("3D Tiles children must be an array")
        if children:
            for child in children:
                visit(child, node_region)
            return
        content = node.get("content")
        if content is None:
            return
        content_record = _record(content, "3D Tiles content")
        uri = content_record.get("uri", content_record.get("url"))
        if node_region is None:
            raise ValidationError("3D Tiles leaf content needs a region")
        result.append((_safe_content_uri(uri), node_region))

    visit(tile, None)
    if not result:
        raise ValidationError("3D Tiles source contains no leaf B3DM content")
    uris = [uri for uri, _ in result]
    if len(set(uris)) != len(uris):
        raise ValidationError("3D Tiles source contains duplicate content URIs")
    return result


def _segment_intersects_rectangle(
    start: tuple[float, float],
    end: tuple[float, float],
    bounds: tuple[float, float, float, float],
) -> bool:
    minimum_x, minimum_y, maximum_x, maximum_y = bounds
    delta_x = end[0] - start[0]
    delta_y = end[1] - start[1]
    lower, upper = 0.0, 1.0
    for p, q in (
        (-delta_x, start[0] - minimum_x),
        (delta_x, maximum_x - start[0]),
        (-delta_y, start[1] - minimum_y),
        (delta_y, maximum_y - start[1]),
    ):
        if p == 0:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            if ratio > upper:
                return False
            lower = max(lower, ratio)
        else:
            if ratio < lower:
                return False
            upper = min(upper, ratio)
    return True


def _intersects_corridor(
    region: list[float],
    route_xy: list[tuple[float, float]],
    origin_latitude: float,
    origin_longitude: float,
    radius_m: float,
) -> bool:
    latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
    longitude_scale = latitude_scale * math.cos(math.radians(origin_latitude))
    west, south, east, north = [math.degrees(value) for value in region[:4]]
    bounds = (
        (west - origin_longitude) * longitude_scale - radius_m,
        (south - origin_latitude) * latitude_scale - radius_m,
        (east - origin_longitude) * longitude_scale + radius_m,
        (north - origin_latitude) * latitude_scale + radius_m,
    )
    return any(
        _segment_intersects_rectangle(route_xy[index - 1], route_xy[index], bounds)
        for index in range(1, len(route_xy))
    )


def _trim_b3dm(source: bytes, uri: str) -> bytes:
    if len(source) < _B3DM_HEADER.size:
        raise IntegrityError(f"B3DM source is truncated: {uri}")
    magic, version, byte_length, feature_json, feature_binary, batch_json, batch_binary = (
        _B3DM_HEADER.unpack_from(source)
    )
    if magic != b"b3dm" or version != 1 or byte_length != len(source):
        raise IntegrityError(f"B3DM header is invalid: {uri}")
    payload_offset = _B3DM_HEADER.size + feature_json + feature_binary + batch_json + batch_binary
    if payload_offset + 12 > len(source) or source[payload_offset : payload_offset + 4] != b"glTF":
        raise IntegrityError(f"B3DM payload does not contain a GLB: {uri}")
    glb_length = struct.unpack_from("<I", source, payload_offset + 8)[0]
    if glb_length != len(source) - payload_offset:
        raise IntegrityError(f"B3DM GLB length is invalid: {uri}")
    feature_end = _B3DM_HEADER.size + feature_json + feature_binary
    result_length = feature_end + glb_length
    header = _B3DM_HEADER.pack(
        b"b3dm", 1, result_length, feature_json, feature_binary, 0, 0
    )
    return header + source[_B3DM_HEADER.size : feature_end] + source[payload_offset:]


def _vertical_alignment(
    route: dict[str, object], selected: list[tuple[str, list[float]]]
) -> dict[str, object]:
    coordinates = route.get("coordinates")
    if not isinstance(coordinates, list):
        raise ValidationError("canonical route coordinates are invalid")
    differences = []
    for raw_coordinate in coordinates:
        coordinate = _record(raw_coordinate, "canonical route coordinate")
        latitude = float(coordinate["latitude"])
        longitude = float(coordinate["longitude"])
        matching_regions = [
            region
            for _, region in selected
            if math.degrees(region[0]) <= longitude <= math.degrees(region[2])
            and math.degrees(region[1]) <= latitude <= math.degrees(region[3])
        ]
        if matching_regions:
            differences.append(
                max(region[4] for region in matching_regions)
                - float(coordinate["elevationM"])
            )
    if len(differences) < 2:
        raise AcquisitionError(
            "PLATEAU subset needs two route samples for vertical alignment"
        )
    offset = statistics.median(differences)
    residuals = sorted(abs(value - offset) for value in differences)
    residual_p95 = residuals[math.ceil(len(residuals) * 0.95) - 1]
    return {
        "method": "route-to-region-lower-bound-median-v1",
        "offsetM": round(offset, 6),
        "residualP95M": round(residual_p95, 6),
        "sampleCount": len(differences),
        "semantics": "Subtract offsetM from source ellipsoidal structure height for route-datum display alignment",
    }


def _same_tree(left: Path, right: Path) -> bool:
    left_files = sorted(path.relative_to(left) for path in left.rglob("*") if path.is_file())
    right_files = sorted(path.relative_to(right) for path in right.rglob("*") if path.is_file())
    return left_files == right_files and all(
        (left / relative).read_bytes() == (right / relative).read_bytes()
        for relative in left_files
    )


def build_plateau_tileset_subset(
    route_detail_path: Path,
    source_tileset_uri: str,
    output_directory: Path,
    *,
    corridor_radius_m: int,
    dataset_id: str,
    source_year: int,
) -> dict[str, object]:
    """Build and atomically promote a deterministic route-corridor tileset."""
    if corridor_radius_m < 1:
        raise ValidationError("PLATEAU corridor radius must be positive")
    if not dataset_id or PurePosixPath(dataset_id).name != dataset_id:
        raise ValidationError("PLATEAU dataset ID must be a safe path segment")
    if source_year < 2000 or source_year > 9999:
        raise ValidationError("PLATEAU source year is invalid")

    route = load_canonical_route(route_detail_path)
    points = route_local_points(route)
    route_xy = [(point.x, point.y) for point in points]
    origin = _record(route["coordinates"][0], "route origin")
    tileset_bytes = _fetch(source_tileset_uri)
    tileset = _record(strict_json_loads(tileset_bytes), "3D Tiles source")
    source_root = _record(tileset.get("root"), "3D Tiles root")
    source_geometric_error = tileset.get("geometricError")
    if (
        isinstance(source_geometric_error, bool)
        or not isinstance(source_geometric_error, (int, float))
        or not math.isfinite(float(source_geometric_error))
        or float(source_geometric_error) <= 0
    ):
        raise ValidationError("3D Tiles source geometric error must be positive")
    selected = [
        (uri, region)
        for uri, region in _leaf_contents(source_root)
        if _intersects_corridor(
            region,
            route_xy,
            float(origin["latitude"]),
            float(origin["longitude"]),
            corridor_radius_m,
        )
    ]
    if not selected:
        raise AcquisitionError("PLATEAU source has no content in the route corridor")

    output_directory = output_directory.resolve()
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{output_directory.name}.", dir=output_directory.parent)
    )
    try:
        contents: list[dict[str, object]] = []
        children: list[dict[str, object]] = []
        for uri, region in sorted(selected):
            source = _fetch(_source_url(source_tileset_uri, uri))
            derived = _trim_b3dm(source, uri)
            target = staging / PurePosixPath(uri)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(derived)
            contents.append(
                {
                    "uri": uri,
                    "region": region,
                    "sourceSha256": sha256_bytes(source),
                    "sourceByteSize": len(source),
                    "derivedSha256": sha256_bytes(derived),
                    "derivedByteSize": len(derived),
                    "transform": "strip-b3dm-batch-table-v1",
                }
            )
            children.append(
                {
                    "boundingVolume": {"region": region},
                    "geometricError": 0,
                    "content": {"uri": uri},
                }
            )

        union = [
            min(region[0] for _, region in selected),
            min(region[1] for _, region in selected),
            max(region[2] for _, region in selected),
            max(region[3] for _, region in selected),
            min(region[4] for _, region in selected),
            max(region[5] for _, region in selected),
        ]
        subset_tileset = {
            "asset": {"version": "1.0", "generator": "goDiesel PLATEAU subset v1"},
            "geometricError": float(source_geometric_error),
            "root": {
                "boundingVolume": {"region": union},
                "geometricError": float(source_geometric_error),
                "refine": "ADD",
                "children": children,
            },
        }
        manifest = {
            "schemaVersion": 1,
            "datasetId": dataset_id,
            "sourceYear": source_year,
            "sourceTilesetUri": source_tileset_uri,
            "sourceTilesetSha256": sha256_bytes(tileset_bytes),
            "corridorRadiusM": corridor_radius_m,
            "verticalAlignment": _vertical_alignment(route, selected),
            "contents": contents,
        }
        (staging / "tileset.json").write_bytes(canonical_json_document(subset_tileset))
        (staging / "source-manifest.json").write_bytes(canonical_json_document(manifest))
        if output_directory.exists():
            if output_directory.is_symlink() or not output_directory.is_dir():
                raise IntegrityError("PLATEAU output path is not a regular directory")
            if not _same_tree(staging, output_directory):
                raise IntegrityError("PLATEAU output conflicts with existing subset")
            shutil.rmtree(staging)
        else:
            os.replace(staging, output_directory)
        return {
            "datasetId": dataset_id,
            "contentCount": len(contents),
            "sourceByteSize": sum(int(item["sourceByteSize"]) for item in contents),
            "derivedByteSize": sum(int(item["derivedByteSize"]) for item in contents),
            "manifestSha256": sha256_bytes(canonical_json_document(manifest)),
        }
    finally:
        if staging.exists():
            shutil.rmtree(staging)
