import stat
import math
from pathlib import Path

import pytest

from world_packs.canonical import canonical_json_bytes, sha256_bytes, strict_json_load
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.errors import ValidationError
from world_packs.geometry import glb_json, route_local_points
from world_packs.route import load_canonical_route
from world_packs.terrain import NormalizedTerrain


ROOT = Path(__file__).resolve().parent
TOKYO = ROOT / "app/public/data/routes/17665674778.json"


def configuration() -> BuildConfiguration:
    return BuildConfiguration(
        world_id="tokyo-test",
        acquired_at="2026-08-26T00:00:00Z",
        corridor_radius_m=100,
        exploration_radius_m=150,
        quality_cell_size_m=100,
        source_uri="repository:app/public/data/routes/17665674778.json@9d82ce0b",
        source_date="2025-11-26",
        deliberate_missing_cell_offsets=((0, 0),),
    )


def tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def normalized_terrain_fixture(tmp_path: Path) -> Path:
    route = load_canonical_route(TOKYO)
    points = route_local_points(route)
    step = 500
    minimum_x = math.floor((min(point.x for point in points) - 200) / step) * step
    maximum_x = math.ceil((max(point.x for point in points) + 200) / step) * step
    minimum_y = math.floor((min(point.y for point in points) - 200) / step) * step
    maximum_y = math.ceil((max(point.y for point in points) + 200) / step) * step
    columns = round((maximum_x - minimum_x) / step) + 1
    rows = round((maximum_y - minimum_y) / step) + 1
    origin = route["coordinates"][0]
    path = tmp_path / "normalized-terrain.json"
    path.write_bytes(
        canonical_json_bytes(
            {
                "schemaVersion": 1,
                "coordinateReference": "route-local-enu-v1",
                "origin": {
                    "latitude": origin["latitude"],
                    "longitude": origin["longitude"],
                    "elevationM": origin["elevationM"],
                },
                "source": {
                    "logicalName": "measured-dem",
                    "sha256": "c" * 64,
                    "sourceUri": "https://example.test/dem.tif?versionId=1",
                    "sourceVersion": "1",
                    "sourceCrs": "EPSG:9999",
                    "verticalDatum": "test-datum",
                    "licence": "OGL-test",
                    "attribution": "Measured terrain test source",
                },
                "grid": {
                    "minimumXM": minimum_x,
                    "minimumYM": minimum_y,
                    "stepM": step,
                    "columns": columns,
                    "rows": rows,
                    "heightsM": [0] * (columns * rows),
                    "measuredRuns": [[0, columns * rows]],
                },
                "verticalAlignment": {
                    "method": "median-recorded-minus-measured-v1",
                    "offsetM": 1.25,
                    "routeSampleCount": len(points),
                    "residualP95M": 2.5,
                },
                "nodata": {
                    "semantic": "unavailable",
                    "fillAbsoluteElevationM": 0,
                    "filledVertexCount": 0,
                },
                "normalizer": {
                    "name": "godiesel-raster-normalizer",
                    "version": "1",
                    "sampling": "nearest-source-cell-centre",
                },
            }
        )
        + b"\n"
    )
    return path


def test_compiler_builds_byte_identical_sealed_core_packs(tmp_path: Path):
    first = WorldPackCompiler(tmp_path / "first").build_route(TOKYO, configuration())
    second = WorldPackCompiler(tmp_path / "second").build_route(TOKYO, configuration())

    assert first.pack_id == second.pack_id
    assert first.created is True
    assert second.created is True
    assert tree_bytes(first.path) == tree_bytes(second.path)
    assert first.pack_id.startswith("wp_")
    assert len(first.pack_id) == 67

    expected = {
        "checksums.json",
        "cinematic/camera-timelines.json",
        "cinematic/experience-manifest.json",
        "cinematic/poster-candidates.json",
        "imagery/materials/procedural.json",
        "lod/core.json",
        "manifest.json",
        "migrations/version.json",
        "physics/structures-collision.glb",
        "physics/terrain-collision.glb",
        "physics/traversable-surfaces.glb",
        "physics/world-navigation.json",
        "provenance/accuracy.json",
        "provenance/attribution.json",
        "provenance/coverage.json",
        "provenance/transformations.json",
        "reconstruction/inventory.json",
        "route/annotations.json",
        "route/canonical-route.json",
        "route/media-index.json",
        "route/route-thread.glb",
        "runtime/world.json",
        "sources/inventory.json",
        "sources/original/route-detail.json",
        "structures/tileset.json",
        "terrain/surface/core-terrain.glb",
        "transportation/network.json",
    }
    assert set(tree_bytes(first.path)) == expected
    assert stat.S_IMODE(first.path.stat().st_mode) == 0o555
    assert all(
        stat.S_IMODE(path.stat().st_mode) == 0o444
        for path in first.path.rglob("*")
        if path.is_file()
    )


def test_manifest_identity_and_route_truth_are_exact(tmp_path: Path):
    result = WorldPackCompiler(tmp_path / "repository").build_route(
        TOKYO, configuration()
    )
    manifest = strict_json_load(result.path / "manifest.json")
    experience = strict_json_load(
        result.path / "cinematic/experience-manifest.json"
    )
    canonical = strict_json_load(result.path / "route/canonical-route.json")
    source = strict_json_load(TOKYO)
    assert isinstance(manifest, dict)
    assert isinstance(experience, dict)
    assert isinstance(canonical, dict)
    assert isinstance(source, dict)

    identity = {
        key: value
        for key, value in manifest.items()
        if key not in {"packId", "runtime", "artifacts"}
    }
    identity["artifacts"] = [
        artifact
        for artifact in manifest["artifacts"]
        if artifact["role"] != "pack-binding"
    ]
    assert manifest["packId"] == f"wp_{sha256_bytes(canonical_json_bytes(identity))}"
    assert experience["packId"] == manifest["packId"]
    assert manifest["runtime"] == {
        "entrypoint": "runtime/world.json",
        "networkRequired": False,
        "providerCredentialsRequired": False,
        "physicalNeighbourhoodRequired": True,
    }
    assert [
        coordinate["latitude"] for coordinate in canonical["coordinates"]
    ] == [coordinate["lat"] for coordinate in source["route"]]
    assert [
        coordinate["longitude"] for coordinate in canonical["coordinates"]
    ] == [coordinate["lng"] for coordinate in source["route"]]
    assert [
        coordinate["distanceM"] for coordinate in canonical["coordinates"]
    ] == [coordinate["d"] for coordinate in source["route"]]


def test_coverage_names_deliberate_gaps_and_unavailable_structures(tmp_path: Path):
    result = WorldPackCompiler(tmp_path / "repository").build_route(
        TOKYO, configuration()
    )
    coverage = strict_json_load(result.path / "provenance/coverage.json")
    assert isinstance(coverage, dict)
    deliberate = [cell for cell in coverage["cells"] if cell["deliberateGap"]]

    assert [cell["id"] for cell in deliberate] == ["0:0"]
    assert deliberate[0]["visual"]["class"] == "procedural"
    assert "Deliberate source-gap" in deliberate[0]["visual"]["reason"]
    assert all(
        cell["structures"]["class"] == "unavailable"
        for cell in coverage["cells"]
    )
    assert all(cell["collision"]["class"] == "procedural" for cell in coverage["cells"])


def test_compiler_never_bridges_recorded_discontinuities(tmp_path: Path):
    result = WorldPackCompiler(tmp_path / "repository").build_route(
        TOKYO, configuration()
    )
    navigation = strict_json_load(result.path / "physics/world-navigation.json")
    assert isinstance(navigation, dict)
    edges = {(edge["from"], edge["to"]) for edge in navigation["edges"]}

    assert (207, 208) not in edges
    assert (274, 275) not in edges
    assert len(edges) == 374

    thread = glb_json((result.path / "route/route-thread.glb").read_bytes())
    ribbon = glb_json(
        (result.path / "physics/traversable-surfaces.glb").read_bytes()
    )
    assert thread["meshes"][0]["primitives"][0]["mode"] == 1
    assert thread["accessors"][1]["count"] == 374 * 2
    assert ribbon["accessors"][1]["count"] == 374 * 6


def test_repeated_build_reuses_the_same_sealed_version(tmp_path: Path):
    compiler = WorldPackCompiler(tmp_path / "repository")
    first = compiler.build_route(TOKYO, configuration())
    before = tree_bytes(first.path)
    second = compiler.build_route(TOKYO, configuration())

    assert second == type(first)(first.world_id, first.pack_id, first.path, False)
    assert tree_bytes(first.path) == before
    assert len(list((tmp_path / "repository/packs/tokyo-test").glob("wp_*"))) == 1


def test_failed_build_leaves_current_sealed_version_untouched(tmp_path: Path):
    repository = tmp_path / "repository"
    valid = WorldPackCompiler(repository).build_route(TOKYO, configuration())
    current = repository / "packs/tokyo-test/current.json"
    current_before = current.read_bytes()
    pack_before = tree_bytes(valid.path)

    class FailingCompiler(WorldPackCompiler):
        @staticmethod
        def _identity_digest(identity: dict[str, object]) -> str:
            raise RuntimeError("injected compiler failure before promotion")

    with pytest.raises(RuntimeError, match="injected"):
        FailingCompiler(repository).build_route(TOKYO, configuration())

    assert current.read_bytes() == current_before
    assert tree_bytes(valid.path) == pack_before
    assert not list((repository / ".staging").iterdir())


def test_compiler_rejects_quality_claim_without_sources(tmp_path: Path):
    with pytest.raises(ValidationError, match="only Core"):
        BuildConfiguration(
            world_id="tokyo-test",
            acquired_at="2026-08-26T00:00:00Z",
            quality="detailed",
        )


def test_compiler_uses_normalized_measured_terrain_and_preserves_provenance(
    tmp_path: Path,
):
    terrain_path = normalized_terrain_fixture(tmp_path)
    measured_configuration = configuration()
    measured_configuration = BuildConfiguration(
        **{
            **measured_configuration.__dict__,
            "normalized_terrain_path": terrain_path,
        }
    )

    result = WorldPackCompiler(tmp_path / "repository").build_route(
        TOKYO, measured_configuration
    )
    manifest = strict_json_load(result.path / "manifest.json")
    coverage = strict_json_load(result.path / "provenance/coverage.json")
    accuracy = strict_json_load(result.path / "provenance/accuracy.json")
    retained = result.path / "sources/derived/normalized-terrain.json"
    terrain = NormalizedTerrain.load(terrain_path)

    assert retained.read_bytes() == terrain_path.read_bytes()
    visual = next(
        artifact for artifact in manifest["artifacts"] if artifact["role"] == "visual-terrain"
    )
    assert visual["evidenceClass"] == "measured"
    assert (result.path / visual["logicalPath"]).read_bytes() == terrain.visual_glb()
    assert all(cell["terrain"]["class"] == "measured" for cell in coverage["cells"])
    assert accuracy["terrain"] == {
        "class": "measured",
        "declaredAccuracyM": 2.5,
        "verticalAlignmentOffsetM": 1.25,
    }
