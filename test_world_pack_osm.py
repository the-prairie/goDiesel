from pathlib import Path

from world_packs.canonical import canonical_json_document
from world_packs.geometry import LocalPoint, glb_json
from world_packs.osm import OsmBuilding, OsmWorldData
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.canonical import strict_json_load


ROOT = Path(__file__).resolve().parent
TOKYO = ROOT / "app/public/data/routes/17665674778.json"


def source_fixture(tmp_path: Path) -> Path:
    path = tmp_path / "osm.json"
    path.write_bytes(
        canonical_json_document(
            {
                "version": 0.6,
                "osm3s": {"timestamp_osm_base": "2026-08-26T12:00:00Z"},
                "elements": [
                    {
                        "type": "way",
                        "id": 10,
                        "tags": {"building": "yes", "building:levels": "2"},
                        "geometry": [
                            {"lat": 51.0, "lon": -115.0},
                            {"lat": 51.0, "lon": -114.99999},
                            {"lat": 51.00001, "lon": -114.99999},
                            {"lat": 51.00001, "lon": -115.0},
                            {"lat": 51.0, "lon": -115.0},
                        ],
                    },
                    {
                        "type": "way",
                        "id": 20,
                        "tags": {"highway": "path"},
                        "geometry": [
                            {"lat": 51.0, "lon": -115.0},
                            {"lat": 51.00002, "lon": -115.0},
                        ],
                    },
                    {
                        "type": "way",
                        "id": 30,
                        "tags": {"highway": "residential"},
                        "geometry": [
                            {"lat": 51.0, "lon": -115.0},
                            {"lat": 51.0, "lon": -114.99998},
                        ],
                    },
                ],
            }
        )
    )
    return path


def test_osm_normalizer_compiles_recorded_transport_and_collision(tmp_path: Path):
    source = source_fixture(tmp_path)
    route = [LocalPoint(-20, 0, 2, 0), LocalPoint(-20, 20, 3, 20)]

    data = OsmWorldData.load(
        source,
        route,
        origin_latitude=51,
        origin_longitude=-115,
        exploration_radius_m=100,
    )

    assert data.source_date == "2026-08-26T12:00:00Z"
    assert [building.feature_id for building in data.buildings] == ["way/10"]
    assert data.buildings[0].height_m == 6
    network = data.transportation_document()
    assert [feature["id"] for feature in network["roads"]["features"]] == ["way/30"]
    assert [feature["id"] for feature in network["trails"]["features"]] == ["way/20"]
    collision = glb_json(data.collision_glb(route, None))
    evidence = collision["extras"]["godieselStructureCollision"]
    assert evidence["sourceSha256"] == data.sha256
    assert evidence["obstacles"][0]["featureId"] == "way/10"
    assert evidence["obstacles"][0]["heightSource"] == "osm-building-levels-3m"
    assert collision["accessors"][1]["count"] == 24


def test_osm_normalizer_is_byte_deterministic(tmp_path: Path):
    source = source_fixture(tmp_path)
    route = [LocalPoint(-20, 0, 2, 0), LocalPoint(-20, 20, 3, 20)]
    first = OsmWorldData.load(
        source,
        route,
        origin_latitude=51,
        origin_longitude=-115,
        exploration_radius_m=100,
    )
    second = OsmWorldData.load(
        source,
        route,
        origin_latitude=51,
        origin_longitude=-115,
        exploration_radius_m=100,
    )

    assert first.transportation_document() == second.transportation_document()
    assert first.collision_glb(route, None) == second.collision_glb(route, None)


def test_collision_excludes_buildings_inside_actor_route_clearance():
    data = OsmWorldData(
        paths=(),
        source_sha256s=(),
        source_dates=(),
        normalized_bytes=b"{}",
        sha256="0" * 64,
        source_date="2026-08-26T12:00:00Z",
        buildings=(
            OsmBuilding(
                feature_id="way/near-route",
                footprint=((0.3, -1), (1.3, -1), (1.3, 1), (0.3, 1)),
                height_m=6,
                height_source="explicit-test",
            ),
            OsmBuilding(
                feature_id="way/retained",
                footprint=((5, -1), (6, -1), (6, 1), (5, 1)),
                height_m=6,
                height_source="explicit-test",
            ),
        ),
        transport=(),
    )
    route = [LocalPoint(0, -2, 0, 0), LocalPoint(0, 2, 0, 4)]

    collision = glb_json(data.collision_glb(route, None))
    evidence = collision["extras"]["godieselStructureCollision"]

    assert evidence["excludedRouteConflictFeatureIds"] == ["way/near-route"]
    assert [obstacle["featureId"] for obstacle in evidence["obstacles"]] == [
        "way/retained"
    ]


def test_compiler_retains_osm_and_publishes_physical_capabilities(tmp_path: Path):
    route = strict_json_load(TOKYO)
    origin = route["route"][0]
    source = tmp_path / "tokyo-osm.json"
    source.write_bytes(
        canonical_json_document(
            {
                "version": 0.6,
                "osm3s": {"timestamp_osm_base": "2026-08-26T12:00:00Z"},
                "elements": [
                    {
                        "type": "way",
                        "id": 99,
                        "tags": {"building": "yes", "height": "12"},
                        "geometry": [
                            {"lat": origin["lat"], "lon": origin["lng"] + 0.0005},
                            {"lat": origin["lat"], "lon": origin["lng"] + 0.00052},
                            {"lat": origin["lat"] + 0.00002, "lon": origin["lng"] + 0.00052},
                            {"lat": origin["lat"] + 0.00002, "lon": origin["lng"] + 0.0005},
                            {"lat": origin["lat"], "lon": origin["lng"] + 0.0005},
                        ],
                    }
                ],
            }
        )
    )
    configuration = BuildConfiguration(
        world_id="tokyo-osm-test",
        acquired_at="2026-08-26T13:00:00Z",
        corridor_radius_m=100,
        exploration_radius_m=150,
        quality_cell_size_m=100,
        osm_network_path=source,
        osm_source_uri="https://overpass-api.de/api/interpreter?query=sha256:test",
        osm_licence="ODbL-1.0",
        osm_attribution="OpenStreetMap contributors",
    )

    first = WorldPackCompiler(tmp_path / "first").build_route(TOKYO, configuration)
    second = WorldPackCompiler(tmp_path / "second").build_route(TOKYO, configuration)
    runtime = strict_json_load(first.path / "runtime/world.json")
    inventory = strict_json_load(first.path / "sources/inventory.json")

    assert first.pack_id == second.pack_id
    assert runtime["physicalCapabilities"]["structuresCollision"] == "footprint-prisms"
    assert (first.path / "sources/original/osm-overpass/000.json").read_bytes() == source.read_bytes()
    assert [item["logicalName"] for item in inventory["sources"]] == [
        "strict-route-detail",
        "osm-route-world",
        "osm-overpass-shard-000",
    ]
