import json
import struct
from pathlib import Path

import pytest

from world_packs.canonical import canonical_json_bytes, strict_json_load
from world_packs.errors import ValidationError
from world_packs.geometry import (
    BINARY_CHUNK,
    GLB_MAGIC,
    JSON_CHUNK,
    glb_json,
    route_local_points,
    route_ribbon_glb,
    route_thread_glb,
    terrain_glb,
)
from world_packs.route import load_canonical_route, normalize_route_detail


ROOT = Path(__file__).resolve().parent
TOKYO = ROOT / "app/public/data/routes/17665674778.json"


def test_canonical_route_preserves_exact_route_numbers():
    source = strict_json_load(TOKYO)
    assert isinstance(source, dict)
    canonical = load_canonical_route(TOKYO)

    assert canonical["routeId"] == source["activity_id"]
    assert canonical["segmentCount"] == source["provenance"]["track"]["segment_count"]
    assert len(canonical["coordinates"]) == len(source["route"])
    for actual, expected in zip(canonical["coordinates"], source["route"]):
        assert actual == {
            "latitude": expected["lat"],
            "longitude": expected["lng"],
            "elevationM": expected["elev"],
            "distanceM": expected["d"],
            "elapsedS": expected.get("elapsed_s"),
        }
    assert json.loads(canonical_json_bytes(canonical)) == canonical


def test_canonical_route_rejects_non_monotonic_distance():
    source = strict_json_load(TOKYO)
    assert isinstance(source, dict)
    source["route"][1]["d"] = -1

    with pytest.raises(ValidationError, match="at least 0|monotonic"):
        normalize_route_detail(source)


def assert_valid_glb(value: bytes, expected_mode: int):
    magic, version, total_length = struct.unpack_from("<III", value, 0)
    assert magic == GLB_MAGIC
    assert version == 2
    assert total_length == len(value)
    json_length, json_chunk_type = struct.unpack_from("<II", value, 12)
    assert json_chunk_type == JSON_CHUNK
    binary_offset = 20 + json_length
    binary_length, binary_chunk_type = struct.unpack_from("<II", value, binary_offset)
    assert binary_chunk_type == BINARY_CHUNK
    assert binary_offset + 8 + binary_length == len(value)
    document = glb_json(value)
    assert document["asset"]["version"] == "2.0"
    assert document["meshes"][0]["primitives"][0]["mode"] == expected_mode


def test_route_and_physical_glbs_are_deterministic_and_valid():
    route = load_canonical_route(TOKYO)
    points = route_local_points(route)

    thread = route_thread_glb(points)
    ribbon = route_ribbon_glb(points)
    terrain = terrain_glb(
        points,
        exploration_radius_m=100,
        cell_size_m=250,
        name="Procedural terrain",
    )

    assert thread == route_thread_glb(points)
    assert ribbon == route_ribbon_glb(points)
    assert_valid_glb(thread, 3)
    assert_valid_glb(ribbon, 4)
    assert_valid_glb(terrain, 4)
    assert len(glb_json(ribbon)["accessors"]) == 2
    assert len(glb_json(terrain)["accessors"]) == 2
