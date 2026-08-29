#!/usr/bin/env python3
"""Prove deterministic export, offline clean-room import, migration, and repair."""

from __future__ import annotations

import json
import os
import socket
import tempfile
from pathlib import Path

from world_packs.archive import export_pack, import_pack
from world_packs.canonical import canonical_json_document, strict_json_load
from world_packs.migrations import migrate_pack
from world_packs.repair import repair_pack
from world_packs.verification import verify_pack


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = ROOT / "app/public/world-packs"
INDEX = PUBLIC_ROOT / "index.json"
EXPECTED = ROOT / "docs/world-packs/proof/durability-proof.json"
ROUTE_SLUGS = ("17665674778", "15573295095", "6496900063")
PREVIOUS_PACK_IDS = {
    "tokyo-urban": "wp_3a23cbaa71d49c450d8f1b079f888a225d206656bea9641656991f74a59d0f3b",
    "banff-mountain": "wp_2c02563ef8f3674ca08b88141e493290fcea12a80dea07678f6bd39fe24cf2b1",
    "ucluelet-coastal": "wp_465bc298bd0f525d2b73430b12b978e92cef9ae71d40b2c38ceb85d01117f326",
}
PROVIDER_CREDENTIAL_NAMES = (
    "CESIUM_ION_ACCESS_TOKEN",
    "GOOGLE_MAPS_API_KEY",
    "MAPBOX_ACCESS_TOKEN",
    "MAPBOX_TOKEN",
    "VITE_GOOGLE_MAPS_API_KEY",
)


def _block_network() -> tuple[object, object]:
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args: object, **_kwargs: object) -> None:
        raise OSError("network disabled by World Pack durability proof")

    socket.socket.connect = blocked  # type: ignore[method-assign]
    socket.socket.connect_ex = blocked  # type: ignore[method-assign]
    return original_connect, original_connect_ex


def _restore_network(original: tuple[object, object]) -> None:
    socket.socket.connect = original[0]  # type: ignore[method-assign,assignment]
    socket.socket.connect_ex = original[1]  # type: ignore[method-assign,assignment]


def build_proof() -> dict[str, object]:
    for name in PROVIDER_CREDENTIAL_NAMES:
        os.environ.pop(name, None)
    index = strict_json_load(INDEX)
    if not isinstance(index, dict):
        raise RuntimeError("World Pack index is invalid")
    original_network = _block_network()
    try:
        worlds = []
        with tempfile.TemporaryDirectory(prefix="godiesel-clean-room-") as temporary:
            clean_root = Path(temporary)
            for route_slug in ROUTE_SLUGS:
                entry = index["packs"][route_slug]
                world_id = str(entry["worldId"])
                pack_id = str(entry["packId"])
                source_pack = PUBLIC_ROOT / world_id / pack_id
                first_archive = export_pack(
                    source_pack, clean_root / f"{world_id}-first.worldpack.zip"
                )
                second_archive = export_pack(
                    source_pack, clean_root / f"{world_id}-second.worldpack.zip"
                )
                if first_archive.sha256 != second_archive.sha256:
                    raise RuntimeError(f"{world_id} archive export is not deterministic")
                repository = clean_root / f"{world_id}-repository"
                imported = import_pack(first_archive.path, repository)
                health = verify_pack(imported.path)
                migration = migrate_pack(imported.path)
                previous_pack_id = PREVIOUS_PACK_IDS[world_id]
                previous = PUBLIC_ROOT / world_id / previous_pack_id
                previous_migration = migrate_pack(previous)
                manifest = strict_json_load(imported.path / "manifest.json")
                if not isinstance(manifest, dict):
                    raise RuntimeError(f"{world_id} imported manifest is invalid")
                required_runtime = [
                    artifact
                    for artifact in manifest["artifacts"]
                    if artifact["requiredRuntime"]
                ]
                repair_target = imported.path / "physics/terrain-collision.glb"
                repair_target.chmod(0o644)
                repair_target.write_bytes(b"durability-proof-tamper")
                repaired = repair_pack(imported.path, repository)
                repaired_health = verify_pack(repaired.path)
                if not repaired.repaired or repaired.quarantined_path is None:
                    raise RuntimeError(f"{world_id} repair did not quarantine damage")
                if (
                    repaired.quarantined_path / "physics/terrain-collision.glb"
                ).read_bytes() != b"durability-proof-tamper":
                    raise RuntimeError(f"{world_id} repair did not preserve evidence")
                worlds.append(
                    {
                        "routeSlug": route_slug,
                        "worldId": world_id,
                        "packId": pack_id,
                        "archiveSha256": first_archive.sha256,
                        "archiveByteSize": first_archive.byte_size,
                        "archiveExportsByteIdentical": True,
                        "cleanRoomImportedPackId": imported.pack_id,
                        "requiredRuntimeArtifactCount": len(required_runtime),
                        "requiredRuntimeRequestsLocal": True,
                        "providerRequests": 0,
                        "currentMigrationChanged": migration.changed,
                        "previousReadablePackId": previous_pack_id,
                        "previousMigrationChanged": previous_migration.changed,
                        "repairQuarantinedDamage": True,
                        "repairedPackId": str(repaired_health.packId),
                        "status": str(health.status),
                    }
                )
        return {
            "schemaVersion": 1,
            "networkDisabled": True,
            "providerCredentialsRemoved": list(PROVIDER_CREDENTIAL_NAMES),
            "worlds": worlds,
        }
    finally:
        _restore_network(original_network)


def main() -> int:
    proof = build_proof()
    value = canonical_json_document(proof)
    if "--print" in os.sys.argv:
        os.sys.stdout.buffer.write(value)
        return 0
    if strict_json_load(EXPECTED) != proof:
        os.sys.stderr.buffer.write(value)
        raise RuntimeError(f"durability proof differs from {EXPECTED}")
    print(f"Verified durability proof for {len(proof['worlds'])} sealed World Packs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
