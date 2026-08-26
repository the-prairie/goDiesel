from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin

from world_packs.canonical import canonical_json_document, sha256_file
from world_packs.cog_window import extract_route_cog_window


def test_cog_window_extraction_is_bounded_and_deterministic(tmp_path: Path):
    route = tmp_path / "route.json"
    route.write_bytes(
        canonical_json_document(
            {
                "activity_id": "route-1",
                "slug": "route-1",
                "lifecycle": "completed",
                "route": [
                    {"lat": 48.4, "lng": -123.3, "elev": 12, "d": 0},
                    {"lat": 48.401, "lng": -123.299, "elev": 13, "d": 150},
                ],
                "provenance": {"track": {"segment_count": 1}, "discontinuities": []},
            }
        )
    )
    source = tmp_path / "source.tif"
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=400,
        height=400,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(-123.32, 48.42, 0.0001, 0.0001),
        nodata=-32767,
    ) as dataset:
        dataset.write(np.arange(160_000, dtype=np.float32).reshape(400, 400), 1)
    first = tmp_path / "first.tif"
    second = tmp_path / "second.tif"

    first_lineage = extract_route_cog_window(
        route,
        str(source),
        first,
        exploration_radius_m=200,
        remote_etag="synthetic-etag",
        remote_byte_size=source.stat().st_size,
    )
    second_lineage = extract_route_cog_window(
        route,
        str(source),
        second,
        exploration_radius_m=200,
        remote_etag="synthetic-etag",
        remote_byte_size=source.stat().st_size,
    )

    assert sha256_file(first) == sha256_file(second)
    assert first_lineage == second_lineage
    assert first.stat().st_size < source.stat().st_size
    assert first_lineage["method"] == "cog-window-v1"
    assert first_lineage["remoteEtag"] == "synthetic-etag"
    assert first_lineage["sourceWindow"][2] < 400
    with rasterio.open(first) as dataset:
        assert dataset.crs.to_string() == "EPSG:4326"
        assert dataset.width == first_lineage["sourceWindow"][2]
