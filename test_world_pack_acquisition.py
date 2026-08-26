from pathlib import Path

import pytest

from world_packs.acquisition import AcquiredSource, admit_source_receipt
from world_packs.canonical import canonical_json_document, sha256_bytes
from world_packs.errors import AcquisitionError
from scripts.verify_world_source_receipt import verify_receipt


def acquired_source(tmp_path: Path, **overrides: object) -> AcquiredSource:
    source = tmp_path / "terrain.tif"
    source.write_bytes(b"retained source")
    values: dict[str, object] = {
        "logical_name": "terrain-dem",
        "path": source,
        "media_type": "image/tiff",
        "format_version": "GeoTIFF-1.1",
        "evidence_class": "measured",
        "source_uri": "https://example.test/terrain.tif",
        "source_version": "survey-2019",
        "acquired_at": "2026-08-26T12:00:00Z",
        "source_date": "2019",
        "licence_id": "OGL-BC-2.0",
        "licence_uri": "https://example.test/licence",
        "licence_evidence_sha256": "1" * 64,
        "attribution": "Contains information licensed under OGL-BC 2.0.",
        "retention_allowed": True,
        "derivatives_allowed": True,
        "redistribution": "allowed",
        "public_use_obligations": ("attribution",),
        "third_party_rights": "none-declared",
        "decision": "admit",
        "decision_reason": "Dataset record declares OGL-BC 2.0.",
        "adapter": "lidar-bc",
        "adapter_version": "1",
    }
    values.update(overrides)
    return AcquiredSource(**values)  # type: ignore[arg-type]


def test_public_pack_admission_preserves_licence_decision(tmp_path: Path):
    source = acquired_source(tmp_path)

    assert source.public_pack_metadata() == {
        "logical_name": "terrain-dem",
        "media_type": "image/tiff",
        "format_version": "GeoTIFF-1.1",
        "evidence_class": "measured",
        "source_uri": "https://example.test/terrain.tif",
        "source_version": "survey-2019",
        "acquired_at": "2026-08-26T12:00:00Z",
        "source_date": "2019",
        "licence_id": "OGL-BC-2.0",
        "licence_uri": "https://example.test/licence",
        "licence_evidence_sha256": "1" * 64,
        "attribution": "Contains information licensed under OGL-BC 2.0.",
        "retention_allowed": True,
        "derivatives_allowed": True,
        "redistribution": "allowed",
        "public_use_obligations": ["attribution"],
        "third_party_rights": "none-declared",
        "decision": "admit",
        "decision_reason": "Dataset record declares OGL-BC 2.0.",
        "adapter": "lidar-bc",
        "adapter_version": "1",
    }


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"redistribution": "unknown"}, "redistribution is not allowed"),
        ({"decision": "metadata_only"}, "decision is not admit"),
        ({"retention_allowed": False}, "retention is not allowed"),
        ({"derivatives_allowed": False}, "derivatives are not allowed"),
    ],
)
def test_public_pack_admission_fails_closed(
    tmp_path: Path, overrides: dict[str, object], message: str
):
    source = acquired_source(tmp_path, **overrides)

    with pytest.raises(AcquisitionError, match=message):
        source.public_pack_metadata()


def test_source_receipt_admits_only_exact_cached_bytes(tmp_path: Path):
    custody = tmp_path / "custody"
    custody.mkdir()
    source = custody / "terrain.tif"
    source.write_bytes(b"measured terrain")
    licence = custody / "licence.pdf"
    licence.write_bytes(b"licence evidence")
    receipt = tmp_path / "receipt.json"
    receipt.write_bytes(
        canonical_json_document(
            {
                "schemaVersion": 1,
                "worldId": "coastal-test",
                "acquiredAt": "2026-08-26T12:00:00Z",
                "licence": {
                    "id": "OGL-BC-2.0",
                    "uri": "https://example.test/licence",
                    "evidenceFilename": "licence.pdf",
                    "evidenceSha256": sha256_bytes(licence.read_bytes()),
                    "attribution": "Contains information licensed under OGL-BC 2.0.",
                    "retentionAllowed": True,
                    "derivativesAllowed": True,
                    "redistribution": "allowed",
                    "publicUseObligations": ["attribution", "non-endorsement"],
                    "thirdPartyRights": "none-declared",
                    "decision": "admit",
                    "decisionReason": "Dataset record declares OGL-BC 2.0.",
                },
                "assets": [
                    {
                        "logicalName": "terrain-dem",
                        "filename": "terrain.tif",
                        "sourceUri": "https://example.test/terrain.tif?versionId=1",
                        "sourceVersion": "1",
                        "sha256": sha256_bytes(source.read_bytes()),
                        "byteSize": source.stat().st_size,
                        "mediaType": "image/tiff",
                        "formatVersion": "GeoTIFF-1.1",
                        "evidenceClass": "measured",
                        "sourceDate": "2019",
                        "adapter": "pinned-http",
                        "adapterVersion": "1",
                    }
                ],
            }
        )
    )

    admitted = admit_source_receipt(receipt, custody)

    assert [source.logical_name for source in admitted] == ["terrain-dem"]
    assert admitted[0].public_pack_metadata()["source_version"] == "1"
    assert verify_receipt(receipt, custody) == {
        "schemaVersion": 1,
        "status": "admitted",
        "sourceCount": 1,
        "sources": ["terrain-dem"],
    }

    source.write_bytes(b"tampered terrain")
    with pytest.raises(AcquisitionError, match="digest mismatch"):
        admit_source_receipt(receipt, custody)


def test_source_receipt_rejects_unknown_contract_fields(tmp_path: Path):
    custody = tmp_path / "custody"
    custody.mkdir()
    receipt = tmp_path / "receipt.json"
    receipt.write_bytes(
        canonical_json_document(
            {
                "schemaVersion": 1,
                "worldId": "coastal-test",
                "acquiredAt": "2026-08-26T12:00:00Z",
                "licence": {},
                "assets": [],
                "providerToken": "must-never-enter-custody",
            }
        )
    )

    with pytest.raises(AcquisitionError, match="Additional properties"):
        admit_source_receipt(receipt, custody)
