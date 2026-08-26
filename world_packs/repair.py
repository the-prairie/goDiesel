"""Non-destructive source reconstruction for a damaged sealed World Pack."""

from __future__ import annotations

import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from .canonical import sha256_file, strict_json_load
from .compiler import BuildConfiguration, WorldPackCompiler
from .errors import IntegrityError
from .schema import validate_document
from .storage import ContentAddressedStore, ObjectRecord
from .verification import verify_pack


@dataclass(frozen=True)
class RepairResult:
    pack_id: str
    path: Path
    repaired: bool
    quarantined_path: Path | None


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise IntegrityError(f"{label} is not an object")
    return value


def _source_bytes(
    pack: Path,
    repository: Path,
    source: dict[str, object],
) -> bytes:
    logical_path = source.get("logicalPath")
    digest = source.get("sha256")
    byte_size = source.get("byteSize")
    media_type = source.get("mediaType")
    format_version = source.get("formatVersion")
    if not all(
        isinstance(value, str)
        for value in (logical_path, digest, media_type, format_version)
    ) or not isinstance(byte_size, int):
        raise IntegrityError("retained source inventory is incomplete")
    pack_source = pack / str(logical_path)
    if (
        pack_source.is_file()
        and not pack_source.is_symlink()
        and pack_source.stat().st_size == byte_size
        and sha256_file(pack_source) == digest
    ):
        return pack_source.read_bytes()
    store = ContentAddressedStore(repository / "objects")
    record = ObjectRecord(str(digest), byte_size, str(media_type), str(format_version))
    try:
        return store.read(record)
    except IntegrityError as error:
        raise IntegrityError(
            "repair is blocked because retained source evidence is missing or damaged"
        ) from error


def repair_pack(pack: Path, repository: Path) -> RepairResult:
    try:
        health = verify_pack(pack)
        return RepairResult(str(health.packId), pack.resolve(), False, None)
    except IntegrityError:
        pass

    if pack.is_symlink() or not pack.is_dir():
        raise IntegrityError(f"pack is not a repairable directory: {pack}")
    pack = pack.resolve()
    repository = repository.resolve()
    manifest = _object(strict_json_load(pack / "manifest.json"), "manifest")
    source_inventory = _object(
        strict_json_load(pack / "sources/inventory.json"), "source inventory"
    )
    validate_document("manifest", manifest)
    validate_document("source-inventory", source_inventory)
    raw_sources = source_inventory.get("sources")
    if not isinstance(raw_sources, list) or len(raw_sources) != 1:
        raise IntegrityError(
            "foundation repair requires exactly one retained strict route source"
        )
    source = _object(raw_sources[0], "retained source")
    route_source = _source_bytes(pack, repository, source)
    pack_id = manifest.get("packId")
    world_id = manifest.get("worldId")
    quality = manifest.get("quality")
    manifest_configuration = _object(
        manifest.get("configuration"), "manifest configuration"
    )
    if not isinstance(pack_id, str) or not isinstance(world_id, str):
        raise IntegrityError("repair manifest identity is invalid")
    if pack.name != pack_id:
        raise IntegrityError("repair refuses a pack outside its identity path")
    offsets = manifest_configuration.get("deliberateMissingCellOffsets")
    if not isinstance(offsets, list) or any(
        not isinstance(offset, list)
        or len(offset) != 2
        or any(isinstance(value, bool) or not isinstance(value, int) for value in offset)
        for offset in offsets
    ):
        raise IntegrityError("repair configuration has invalid missing-cell offsets")
    configuration = BuildConfiguration(
        world_id=world_id,
        acquired_at=str(source.get("acquiredAt")),
        quality=str(quality),
        corridor_radius_m=int(manifest_configuration["corridorRadiusM"]),
        exploration_radius_m=int(manifest_configuration["explorationRadiusM"]),
        quality_cell_size_m=int(manifest_configuration["qualityCellSizeM"]),
        source_uri=str(source.get("sourceUri")),
        source_date=(
            str(source["sourceDate"]) if source.get("sourceDate") is not None else None
        ),
        licence=str(source.get("licence")),
        attribution=str(source.get("attribution")),
        deliberate_missing_cell_offsets=tuple(
            (int(offset[0]), int(offset[1])) for offset in offsets
        ),
    )

    work_root = repository / ".repair" / uuid.uuid4().hex
    source_path = work_root / "retained-route-detail.json"
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(route_source)
    try:
        rebuilt = WorldPackCompiler(work_root / "repository").build_route(
            source_path, configuration
        )
        if rebuilt.pack_id != pack_id:
            raise IntegrityError(
                f"source reconstruction produced {rebuilt.pack_id}, expected {pack_id}"
            )
        verify_pack(rebuilt.path)
        original_store = ContentAddressedStore(repository / "objects")
        for rebuilt_file in rebuilt.path.rglob("*"):
            if rebuilt_file.is_file():
                original_store.repair_file(
                    rebuilt_file,
                    media_type=(
                        "application/json"
                        if rebuilt_file.suffix == ".json"
                        else "model/gltf-binary"
                    ),
                    format_version="repair-v1",
                )

        quarantine = repository / "quarantine" / world_id / f"{pack_id}.{uuid.uuid4().hex}"
        quarantine.parent.mkdir(parents=True, exist_ok=True)
        pack.chmod(0o755)
        os.replace(pack, quarantine)
        try:
            rebuilt.path.chmod(0o755)
            os.replace(rebuilt.path, pack)
            WorldPackCompiler._seal(pack)
            verify_pack(pack)
        except Exception:
            if pack.exists():
                WorldPackCompiler._make_writable(pack)
                shutil.rmtree(pack)
            os.replace(quarantine, pack)
            raise
        return RepairResult(pack_id, pack, True, quarantine)
    finally:
        if work_root.exists():
            WorldPackCompiler._make_writable(work_root)
            shutil.rmtree(work_root)
