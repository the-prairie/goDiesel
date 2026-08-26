from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin

from world_packs.acquisition import AcquiredSource
from world_packs.canonical import canonical_json_document, sha256_bytes
from world_packs.raster_normalizer import normalize_raster_terrain


def test_raster_normalizer_is_deterministic_and_records_nodata(tmp_path: Path):
    route = tmp_path / "route.json"
    route.write_bytes(
        canonical_json_document(
            {
                "activity_id": "route-1",
                "slug": "route-1",
                "name": "Synthetic route",
                "region": "Test",
                "type": "Hike",
                "lifecycle": "completed",
                "source_kind": "test",
                "route": [
                    {"lat": 48.4, "lng": -123.3, "elev": 12, "d": 0},
                    {"lat": 48.401, "lng": -123.299, "elev": 13, "d": 150},
                ],
                "provenance": {"track": {"segment_count": 1}, "discontinuities": []},
            }
        )
    )
    raster = tmp_path / "terrain.tif"
    values = np.full((200, 200), 10, dtype=np.float32)
    values[115:125, 75:85] = -9999
    with rasterio.open(
        raster,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(-123.31, 48.41, 0.0001, 0.0001),
        nodata=-9999,
    ) as dataset:
        dataset.write(values, 1)
    source = AcquiredSource(
        logical_name="terrain-dem",
        path=raster,
        media_type="image/tiff",
        format_version="GeoTIFF-1.1",
        evidence_class="measured",
        source_uri="https://example.test/terrain.tif?versionId=1",
        source_version="1",
        acquired_at="2026-08-26T12:00:00Z",
        source_date="2019",
        licence_id="OGL-test",
        licence_uri="https://example.test/licence",
        licence_evidence_sha256=sha256_bytes(b"licence"),
        attribution="Test attribution",
        retention_allowed=True,
        derivatives_allowed=True,
        redistribution="allowed",
        public_use_obligations=("attribution",),
        third_party_rights="none-declared",
        decision="admit",
        decision_reason="Synthetic test source.",
        adapter="test-raster",
        adapter_version="1",
    )

    first = normalize_raster_terrain(
        route,
        source,
        exploration_radius_m=200,
        step_m=50,
        vertical_datum="test-datum",
        nodata_semantic="water",
        nodata_fill_absolute_elevation_m=0,
    )
    second = normalize_raster_terrain(
        route,
        source,
        exploration_radius_m=200,
        step_m=50,
        vertical_datum="test-datum",
        nodata_semantic="water",
        nodata_fill_absolute_elevation_m=0,
    )

    assert canonical_json_document(first) == canonical_json_document(second)
    assert first["source"]["sourceCrs"] == "EPSG:4326"
    assert first["verticalAlignment"]["offsetM"] == pytest.approx(2.5)
    assert first["nodata"]["filledVertexCount"] > 0
