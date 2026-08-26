from pathlib import Path

import pytest

from world_packs.canonical import strict_json_load
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.errors import IntegrityError, MigrationError
from world_packs.migrations import MigrationRegistry, migrate_pack
from world_packs.repair import repair_pack
from world_packs.storage import ContentAddressedStore
from world_packs.verification import verify_pack


ROOT = Path(__file__).resolve().parent
BANFF = ROOT / "app/public/data/routes/15573295095.json"


def build_pack(repository: Path):
    return WorldPackCompiler(repository).build_route(
        BANFF,
        BuildConfiguration(
            world_id="banff-repair-test",
            acquired_at="2026-08-26T00:00:00Z",
            corridor_radius_m=120,
            exploration_radius_m=180,
            quality_cell_size_m=120,
            source_uri="repository:banff-fixture@9d82ce0b",
            source_date="2025-05-25",
            deliberate_missing_cell_offsets=((0, 0),),
        ),
    )


def tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def tamper(path: Path, value: bytes = b"tampered") -> None:
    path.chmod(0o644)
    path.write_bytes(value)


def test_repair_rebuilds_derived_artifact_and_preserves_corrupt_evidence(
    tmp_path: Path,
):
    repository = tmp_path / "repository"
    built = build_pack(repository)
    expected = tree_bytes(built.path)
    target = built.path / "physics/terrain-collision.glb"
    tamper(target)

    repaired = repair_pack(built.path, repository)

    assert repaired.repaired is True
    assert repaired.pack_id == built.pack_id
    assert repaired.path == built.path
    assert repaired.quarantined_path is not None
    assert (
        repaired.quarantined_path / "physics/terrain-collision.glb"
    ).read_bytes() == b"tampered"
    assert tree_bytes(repaired.path) == expected
    assert verify_pack(repaired.path).status == "complete"


def test_repair_restores_damaged_pack_source_from_content_store(tmp_path: Path):
    repository = tmp_path / "repository"
    built = build_pack(repository)
    source = built.path / "sources/original/route-detail.json"
    tamper(source)

    repaired = repair_pack(built.path, repository)

    assert repaired.repaired is True
    assert verify_pack(repaired.path).packId == built.pack_id


def test_repair_rebuilds_when_pack_and_cas_derived_artifact_are_damaged(
    tmp_path: Path,
):
    repository = tmp_path / "repository"
    built = build_pack(repository)
    manifest = strict_json_load(built.path / "manifest.json")
    assert isinstance(manifest, dict)
    artifact = next(
        artifact
        for artifact in manifest["artifacts"]
        if artifact["logicalPath"] == "physics/terrain-collision.glb"
    )
    tamper(built.path / artifact["logicalPath"])
    store = ContentAddressedStore(repository / "objects")
    tamper(store.object_path(artifact["sha256"]))

    repaired = repair_pack(built.path, repository)

    assert repaired.repaired is True
    assert verify_pack(repaired.path).packId == built.pack_id
    assert list((repository / "objects/quarantine").glob(f"{artifact['sha256']}.*"))


def test_repair_blocks_when_pack_and_cas_source_are_both_damaged(tmp_path: Path):
    repository = tmp_path / "repository"
    built = build_pack(repository)
    inventory = strict_json_load(built.path / "sources/inventory.json")
    assert isinstance(inventory, dict)
    source_record = inventory["sources"][0]
    pack_source = built.path / source_record["logicalPath"]
    tamper(pack_source)
    store = ContentAddressedStore(repository / "objects")
    object_path = store.object_path(source_record["sha256"])
    tamper(object_path)

    with pytest.raises(IntegrityError, match="source evidence"):
        repair_pack(built.path, repository)

    assert pack_source.read_bytes() == b"tampered"
    assert not (repository / "quarantine").exists()


def test_repair_is_a_noop_for_valid_pack(tmp_path: Path):
    repository = tmp_path / "repository"
    built = build_pack(repository)
    before = tree_bytes(built.path)

    result = repair_pack(built.path, repository)

    assert result.repaired is False
    assert result.quarantined_path is None
    assert tree_bytes(built.path) == before


def test_migration_registry_is_ordered_and_non_mutating():
    registry = MigrationRegistry()
    source = {"schemaVersion": 0, "value": "retained"}

    def to_v1(document: dict[str, object]) -> dict[str, object]:
        return {**document, "schemaVersion": 1, "added": "derived"}

    registry.register(0, 1, to_v1)
    migrated = registry.migrate_document(source)

    assert source == {"schemaVersion": 0, "value": "retained"}
    assert migrated == {
        "schemaVersion": 1,
        "value": "retained",
        "added": "derived",
    }
    with pytest.raises(MigrationError, match="newer"):
        registry.migrate_document({"schemaVersion": 2})
    with pytest.raises(MigrationError, match="no migration path"):
        MigrationRegistry().migrate_document(source)


def test_current_pack_migration_is_verified_noop(tmp_path: Path):
    built = build_pack(tmp_path / "repository")
    before = tree_bytes(built.path)

    result = migrate_pack(built.path)

    assert result.changed is False
    assert result.source_version == 1
    assert result.target_version == 1
    assert result.health.status == "complete"
    assert tree_bytes(built.path) == before
