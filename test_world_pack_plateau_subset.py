import json
import struct
from pathlib import Path

import pytest

from world_packs.canonical import canonical_json_document, sha256_file, strict_json_load
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.errors import IntegrityError, ValidationError
from world_packs.geometry import empty_glb
from world_packs.plateau_subset import build_plateau_tileset_subset
from world_packs.verification import verify_pack


def b3dm(batch_payload: bytes) -> bytes:
    feature = b'{"BATCH_LENGTH":1}'
    feature += b" " * ((8 - len(feature) % 8) % 8)
    batch = canonical_json_document({"large": batch_payload.decode("ascii")})
    batch += b" " * ((8 - len(batch) % 8) % 8)
    glb = empty_glb("synthetic building")
    length = 28 + len(feature) + len(batch) + len(glb)
    return struct.pack(
        "<4s6I", b"b3dm", 1, length, len(feature), 0, len(batch), 0
    ) + feature + batch + glb


def test_plateau_subset_selects_corridor_and_strips_batch_metadata(tmp_path: Path):
    route = tmp_path / "route.json"
    route.write_bytes(
        canonical_json_document(
            {
                "activity_id": "route-1",
                "slug": "route-1",
                "lifecycle": "completed",
                "route": [
                    {"lat": 35.0, "lng": 139.0, "elev": 10, "d": 0},
                    {"lat": 35.001, "lng": 139.001, "elev": 11, "d": 150},
                ],
                "provenance": {"track": {"segment_count": 1}, "discontinuities": []},
            }
        )
    )
    source = tmp_path / "source"
    (source / "data").mkdir(parents=True)
    near_region = [
        139.0 * 3.141592653589793 / 180,
        35.0 * 3.141592653589793 / 180,
        139.002 * 3.141592653589793 / 180,
        35.002 * 3.141592653589793 / 180,
        0,
        100,
    ]
    far_region = [
        140.0 * 3.141592653589793 / 180,
        36.0 * 3.141592653589793 / 180,
        140.002 * 3.141592653589793 / 180,
        36.002 * 3.141592653589793 / 180,
        0,
        100,
    ]
    source_tileset = {
        "asset": {"version": "1.0"},
        "geometricError": 100,
        "root": {
            "boundingVolume": {"region": near_region},
            "geometricError": 50,
            "children": [
                {
                    "boundingVolume": {"region": near_region},
                    "geometricError": 0,
                    "content": {"uri": "data/near.b3dm"},
                },
                {
                    "boundingVolume": {"region": far_region},
                    "geometricError": 0,
                    "content": {"uri": "data/far.b3dm"},
                },
            ],
        },
    }
    (source / "tileset.json").write_bytes(canonical_json_document(source_tileset))
    original = b3dm(b"metadata" * 100)
    (source / "data/near.b3dm").write_bytes(original)
    (source / "data/far.b3dm").write_bytes(original)
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_result = build_plateau_tileset_subset(
        route,
        (source / "tileset.json").as_uri(),
        first,
        corridor_radius_m=350,
        dataset_id="synthetic-bldg-lod1",
        source_year=2025,
    )
    second_result = build_plateau_tileset_subset(
        route,
        (source / "tileset.json").as_uri(),
        second,
        corridor_radius_m=350,
        dataset_id="synthetic-bldg-lod1",
        source_year=2025,
    )

    assert first_result == second_result
    assert (first / "data/near.b3dm").is_file()
    assert not (first / "data/far.b3dm").exists()
    assert (first / "data/near.b3dm").stat().st_size < len(original)
    assert sha256_file(first / "data/near.b3dm") == sha256_file(
        second / "data/near.b3dm"
    )
    subset = strict_json_load(first / "tileset.json")
    assert subset["geometricError"] > 0
    assert subset["root"]["geometricError"] > 0
    assert len(subset["root"]["children"]) == 1
    manifest = strict_json_load(first / "source-manifest.json")
    assert manifest["verticalAlignment"]["method"] == "route-to-region-lower-bound-median-v1"
    assert manifest["verticalAlignment"]["sampleCount"] == 2
    assert manifest["contents"][0]["sourceSha256"] == sha256_file(
        source / "data/near.b3dm"
    )
    assert manifest["contents"][0]["derivedByteSize"] < manifest["contents"][0]["sourceByteSize"]

    built = WorldPackCompiler(tmp_path / "repository").build_route(
        route,
        BuildConfiguration(
            world_id="synthetic-urban",
            acquired_at="2026-08-26T12:00:00Z",
            structure_tileset_paths=(first,),
            structure_licence="CC-BY-4.0",
            structure_attribution="Synthetic PLATEAU fixture",
        ),
    )
    assert verify_pack(built.path).status == "complete"
    runtime = strict_json_load(built.path / "runtime/world.json")
    assert runtime["assets"]["structureTilesets"] == [
        {
            "path": "structures/tilesets/synthetic-bldg-lod1/tileset.json",
            "verticalAlignmentOffsetM": -10.5,
        }
    ]
    pack_manifest = strict_json_load(built.path / "manifest.json")
    required_paths = {
        artifact["logicalPath"]
        for artifact in pack_manifest["artifacts"]
        if artifact["requiredRuntime"]
    }
    assert "structures/tilesets/synthetic-bldg-lod1/data/near.b3dm" in required_paths

    altered = bytearray((first / "data/near.b3dm").read_bytes())
    altered[-1] ^= 1
    (first / "data/near.b3dm").write_bytes(altered)
    with pytest.raises(IntegrityError, match="identity mismatch"):
        WorldPackCompiler(tmp_path / "tampered-repository").build_route(
            route,
            BuildConfiguration(
                world_id="tampered-urban",
                acquired_at="2026-08-26T12:00:00Z",
                structure_tileset_paths=(first,),
                structure_licence="CC-BY-4.0",
                structure_attribution="Synthetic PLATEAU fixture",
            ),
        )


def test_plateau_subset_rejects_content_path_escape(tmp_path: Path):
    route = tmp_path / "route.json"
    route.write_bytes(
        canonical_json_document(
            {
                "activity_id": "route-1",
                "slug": "route-1",
                "lifecycle": "completed",
                "route": [
                    {"lat": 35, "lng": 139, "elev": 10, "d": 0},
                    {"lat": 35.001, "lng": 139.001, "elev": 11, "d": 150},
                ],
                "provenance": {"track": {"segment_count": 1}, "discontinuities": []},
            }
        )
    )
    region = [2.42, 0.61, 2.44, 0.63, 0, 100]
    tileset = tmp_path / "tileset.json"
    tileset.write_bytes(
        canonical_json_document(
            {
                "asset": {"version": "1.0"},
                "geometricError": 100,
                "root": {
                    "boundingVolume": {"region": region},
                    "geometricError": 100,
                    "content": {"uri": "../escape.b3dm"},
                },
            }
        )
    )
    with pytest.raises(ValidationError, match="unsafe"):
        build_plateau_tileset_subset(
            route,
            tileset.as_uri(),
            tmp_path / "output",
            corridor_radius_m=350,
            dataset_id="synthetic",
            source_year=2025,
        )


def test_plateau_subset_rejects_invalid_b3dm_length(tmp_path: Path):
    route = tmp_path / "route.json"
    route.write_bytes(
        canonical_json_document(
            {
                "activity_id": "route-1",
                "slug": "route-1",
                "lifecycle": "completed",
                "route": [
                    {"lat": 35, "lng": 139, "elev": 10, "d": 0},
                    {"lat": 35.001, "lng": 139.001, "elev": 11, "d": 150},
                ],
                "provenance": {"track": {"segment_count": 1}, "discontinuities": []},
            }
        )
    )
    source = tmp_path / "source"
    source.mkdir()
    near_region = [
        139 * 3.141592653589793 / 180,
        35 * 3.141592653589793 / 180,
        139.002 * 3.141592653589793 / 180,
        35.002 * 3.141592653589793 / 180,
        0,
        100,
    ]
    (source / "tileset.json").write_bytes(
        canonical_json_document(
            {
                "asset": {"version": "1.0"},
                "geometricError": 100,
                "root": {
                    "boundingVolume": {"region": near_region},
                    "geometricError": 100,
                    "content": {"uri": "bad.b3dm"},
                },
            }
        )
    )
    invalid = bytearray(b3dm(b"metadata"))
    struct.pack_into("<I", invalid, 8, len(invalid) + 1)
    (source / "bad.b3dm").write_bytes(invalid)
    with pytest.raises(IntegrityError, match="header"):
        build_plateau_tileset_subset(
            route,
            (source / "tileset.json").as_uri(),
            tmp_path / "output",
            corridor_radius_m=350,
            dataset_id="synthetic",
            source_year=2025,
        )
