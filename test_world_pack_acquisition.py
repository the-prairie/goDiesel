from pathlib import Path

import pytest

from world_packs.acquisition import AcquiredSource
from world_packs.errors import AcquisitionError


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
