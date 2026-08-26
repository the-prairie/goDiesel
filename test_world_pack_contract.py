import os
from pathlib import Path

import pytest

from world_packs.canonical import (
    canonical_json_bytes,
    sha256_bytes,
    strict_json_loads,
)
from world_packs.acquisition import AcquiredSource
from world_packs.errors import IntegrityError, ValidationError
from world_packs.schema import SCHEMA_ROOT, load_schema, validate_document
from world_packs.storage import ContentAddressedStore
from world_packs.transformations import TransformationGraph, TransformationStep


SHA_A = "a" * 64
SHA_B = "b" * 64


def valid_manifest() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "packId": f"wp_{SHA_A}",
        "worldId": "tokyo-17665674778",
        "routeId": "17665674778",
        "quality": "core",
        "compiler": {"name": "godiesel-world-compiler", "version": "1.0.0"},
        "configuration": {
            "corridorRadiusM": 750,
            "explorationRadiusM": 1500,
            "qualityCellSizeM": 250,
            "coordinateReference": "route-local-enu-v1",
            "deliberateMissingCellOffsets": [],
        },
        "sourceInventorySha256": SHA_A,
        "transformationGraphSha256": SHA_A,
        "coverageSha256": SHA_A,
        "artifacts": [
            {
                "logicalPath": "route/canonical-route.json",
                "kind": "artifact",
                "role": "canonical-route",
                "sha256": SHA_A,
                "byteSize": 42,
                "mediaType": "application/json",
                "formatVersion": "1",
                "evidenceClass": "derived",
                "requiredRuntime": True,
                "transformationIds": [SHA_B],
            }
        ],
        "runtime": {
            "entrypoint": "runtime/world.json",
            "networkRequired": False,
            "providerCredentialsRequired": False,
            "physicalNeighbourhoodRequired": True,
        },
    }


def test_canonical_json_uses_rfc_8785_and_rejects_ambiguous_json():
    assert canonical_json_bytes({"key": "value", "another-key": 2}) == (
        b'{"another-key":2,"key":"value"}'
    )
    assert sha256_bytes(canonical_json_bytes({"b": 2, "a": 1})) == sha256_bytes(
        canonical_json_bytes({"a": 1, "b": 2})
    )

    with pytest.raises(ValidationError, match="duplicate key"):
        strict_json_loads('{"packId":"one","packId":"two"}')
    with pytest.raises(ValidationError, match="non-finite"):
        strict_json_loads('{"value": NaN}')


def test_every_world_pack_schema_is_valid_and_manifest_is_closed():
    schema_names = {path.name.removesuffix(".schema.json") for path in SCHEMA_ROOT.glob("*.schema.json")}
    assert schema_names == {
        "artifact",
        "canonical-route",
        "checksums",
        "coverage",
        "camera-timelines",
        "experience-manifest",
        "manifest",
        "migration-version",
        "source-inventory",
        "transformations",
        "runtime-world",
        "world-navigation",
    }
    for name in schema_names:
        assert load_schema(name)["$schema"] == (
            "https://json-schema.org/draft/2020-12/schema"
        )

    manifest = valid_manifest()
    validate_document("manifest", manifest)
    manifest["providerUrl"] = "https://example.test/not-allowed"
    with pytest.raises(ValidationError, match="Additional properties"):
        validate_document("manifest", manifest)


def test_content_store_deduplicates_and_detects_tampering(tmp_path: Path):
    store = ContentAddressedStore(tmp_path / "objects")
    first = store.admit(
        b"retained evidence",
        media_type="application/octet-stream",
        format_version="1",
    )
    second = store.admit(
        b"retained evidence",
        media_type="application/octet-stream",
        format_version="1",
    )
    assert first == second
    assert len(list((tmp_path / "objects/sha256").glob("*/*"))) == 1

    materialized = tmp_path / "pack/sources/original/evidence.bin"
    store.materialize(first, materialized)
    assert materialized.read_bytes() == b"retained evidence"
    assert materialized.stat().st_ino != store.object_path(first.sha256).stat().st_ino

    os.chmod(store.object_path(first.sha256), 0o644)
    store.object_path(first.sha256).write_bytes(b"tampered evidence")
    with pytest.raises(IntegrityError, match="mismatch"):
        store.verify(first)


def test_content_store_streams_file_admission(tmp_path: Path):
    source = tmp_path / "large.bin"
    source.write_bytes((b"world-pack-evidence" * 100_000) + b"end")
    store = ContentAddressedStore(tmp_path / "objects")

    record = store.admit_file(
        source,
        media_type="application/octet-stream",
        format_version="1",
    )

    assert record.byteSize == source.stat().st_size
    assert store.read(record) == source.read_bytes()


def test_content_store_rejects_symlinked_object_shard(tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    store = ContentAddressedStore(tmp_path / "objects")
    digest = sha256_bytes(b"evidence")
    store.objects.mkdir(parents=True)
    (store.objects / digest[:2]).symlink_to(outside, target_is_directory=True)

    with pytest.raises(IntegrityError, match="escapes"):
        store.admit(
            b"evidence",
            media_type="application/octet-stream",
            format_version="1",
        )


def test_acquisition_metadata_never_retains_workstation_path(tmp_path: Path):
    source_path = tmp_path / "private-owner-source.fit"
    source_path.write_bytes(b"owner source fixture")
    source = AcquiredSource(
        logical_name="route-original",
        path=source_path,
        media_type="application/octet-stream",
        format_version="fit-2.0",
        evidence_class="recorded",
        source_uri="owner-source:sha256:pending",
        acquired_at="2026-08-26T00:00:00Z",
        source_date=None,
        licence="owner-controlled-private-source",
        attribution="Owner recording",
        adapter="local-file",
        adapter_version="1",
    )

    assert "path" not in source.metadata()
    assert str(tmp_path) not in repr(source.metadata())


def test_transformation_graph_is_deterministic_and_rejects_cycles():
    first = TransformationStep("first", "1", (SHA_B,), (SHA_A,), {})
    second = TransformationStep("second", "1", (SHA_A,), (SHA_B,), {})
    graph = TransformationGraph()

    first_identity = graph.add(first)
    assert first_identity == first.identity
    with pytest.raises(ValidationError, match="cycle"):
        graph.add(second)
    assert graph.as_document() == {
        "schemaVersion": 1,
        "steps": [first.as_dict()],
    }


def test_source_inventory_date_time_format_is_enforced():
    inventory = {
        "schemaVersion": 1,
        "sources": [
            {
                "logicalName": "route-detail",
                "logicalPath": "sources/original/route.json",
                "sha256": SHA_A,
                "byteSize": 1,
                "mediaType": "application/json",
                "formatVersion": "godiesel-route-detail-v1",
                "evidenceClass": "derived",
                "sourceUri": "repo:app/public/data/routes/route.json",
                "acquiredAt": "not-a-date",
                "sourceDate": None,
                "licence": "owner-controlled-derived-route-data",
                "attribution": "goDiesel route pipeline",
                "adapter": "route-detail",
                "adapterVersion": "1",
            }
        ],
    }
    with pytest.raises(ValidationError, match="date-time"):
        validate_document("source-inventory", inventory)
