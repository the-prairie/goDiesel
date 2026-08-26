from pathlib import Path

import pytest

from world_packs.canonical import canonical_json_document
from world_packs.errors import ValidationError
from world_packs.geometry import glb_json
from world_packs.terrain import NormalizedTerrain


def terrain_document() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "coordinateReference": "route-local-enu-v1",
        "origin": {"latitude": 48.4, "longitude": -123.3, "elevationM": 10},
        "source": {
            "logicalName": "terrain-dem",
            "sha256": "a" * 64,
            "sourceUri": "https://example.test/dem.tif?versionId=1",
            "sourceVersion": "1",
            "sourceCrs": "EPSG:3157",
            "verticalDatum": "CGVD2013",
            "licence": "OGL-BC-2.0",
            "attribution": "Contains information licensed under OGL-BC 2.0.",
        },
        "grid": {
            "minimumXM": -10,
            "minimumYM": -20,
            "stepM": 10,
            "columns": 3,
            "rows": 2,
            "heightsM": [-2, -1, 0, 1, 2, 3],
            "measuredRuns": [[0, 3], [4, 2]],
        },
        "verticalAlignment": {
            "method": "median-recorded-minus-measured-v1",
            "offsetM": 2.5,
            "routeSampleCount": 4,
            "residualP95M": 0.4,
        },
        "nodata": {
            "semantic": "water",
            "fillAbsoluteElevationM": 0,
            "filledVertexCount": 1,
        },
        "normalizer": {
            "name": "godiesel-raster-normalizer",
            "version": "1",
            "sampling": "nearest-source-cell-centre",
        },
    }


def test_normalized_terrain_is_closed_and_builds_deterministic_mesh(tmp_path: Path):
    document = terrain_document()
    path = tmp_path / "terrain.json"
    path.write_bytes(canonical_json_document(document))

    terrain = NormalizedTerrain.load(path)

    assert terrain.measured_vertex_count == 5
    assert terrain.is_measured(3) is False
    assert terrain.position(4) == (0.0, -10.0, 2.0)
    assert terrain.visual_glb() == terrain.visual_glb()
    visual = glb_json(terrain.visual_glb())
    assert visual["accessors"][0]["count"] == 6
    assert visual["meshes"][0]["primitives"][0]["attributes"] == {
        "POSITION": 0,
        "NORMAL": 2,
        "COLOR_0": 3,
    }
    assert visual["materials"][0]["pbrMetallicRoughness"]["roughnessFactor"] == 0.92


def test_normalized_terrain_rejects_overlapping_runs_and_wrong_height_count(
    tmp_path: Path,
):
    document = terrain_document()
    document["grid"]["measuredRuns"] = [[0, 4], [3, 2]]
    path = tmp_path / "terrain.json"
    path.write_bytes(canonical_json_document(document))

    with pytest.raises(ValidationError, match="overlap"):
        NormalizedTerrain.load(path)

    document = terrain_document()
    document["grid"]["heightsM"] = [1, 2, 3, 4]
    path.write_bytes(canonical_json_document(document))
    with pytest.raises(ValidationError, match="height count"):
        NormalizedTerrain.load(path)
