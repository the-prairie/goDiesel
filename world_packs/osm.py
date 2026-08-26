"""Deterministic OSM road, trail, and building-footprint normalization."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from .canonical import (
    canonical_json_document,
    sha256_bytes,
    sha256_file,
    strict_json_load,
)
from .errors import ValidationError
from .geometry import EARTH_RADIUS_M, LocalPoint, build_glb
from .terrain import NormalizedTerrain


@dataclass(frozen=True)
class OsmBuilding:
    feature_id: str
    footprint: tuple[tuple[float, float], ...]
    height_m: float
    height_source: str


@dataclass(frozen=True)
class OsmTransportFeature:
    feature_id: str
    kind: str
    highway: str
    positions: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class OsmWorldData:
    paths: tuple[Path, ...]
    source_sha256s: tuple[str, ...]
    source_dates: tuple[str, ...]
    normalized_bytes: bytes
    sha256: str
    source_date: str
    buildings: tuple[OsmBuilding, ...]
    transport: tuple[OsmTransportFeature, ...]

    @classmethod
    def load(
        cls,
        path: Path,
        route_points: list[LocalPoint],
        *,
        origin_latitude: float,
        origin_longitude: float,
        exploration_radius_m: float,
    ) -> "OsmWorldData":
        return cls.load_many(
            (path,),
            route_points,
            origin_latitude=origin_latitude,
            origin_longitude=origin_longitude,
            exploration_radius_m=exploration_radius_m,
        )

    @classmethod
    def load_many(
        cls,
        paths: tuple[Path, ...],
        route_points: list[LocalPoint],
        *,
        origin_latitude: float,
        origin_longitude: float,
        exploration_radius_m: float,
    ) -> "OsmWorldData":
        if not paths:
            raise ValidationError("OSM source list is empty")
        source_sha256s: list[str] = []
        source_dates: list[str] = []
        elements_by_id: dict[int, dict[str, object]] = {}
        for path in paths:
            if path.is_symlink() or not path.is_file():
                raise ValidationError(f"OSM source is not a regular file: {path}")
            value = strict_json_load(path)
            if not isinstance(value, dict) or value.get("version") != 0.6:
                raise ValidationError("OSM source is not an Overpass JSON 0.6 document")
            metadata = value.get("osm3s")
            if not isinstance(metadata, dict):
                raise ValidationError("OSM source metadata is missing")
            source_date = metadata.get("timestamp_osm_base")
            if not isinstance(source_date, str) or not source_date:
                raise ValidationError("OSM source snapshot date is missing")
            elements = value.get("elements")
            if not isinstance(elements, list):
                raise ValidationError("OSM source elements are missing")
            source_sha256s.append(sha256_file(path))
            source_dates.append(source_date)
            for raw_element in elements:
                if (
                    not isinstance(raw_element, dict)
                    or raw_element.get("type") != "way"
                ):
                    raise ValidationError("OSM source may contain only ways")
                way_id = raw_element.get("id")
                if (
                    isinstance(way_id, bool)
                    or not isinstance(way_id, int)
                    or way_id <= 0
                ):
                    raise ValidationError("OSM way ID is invalid")
                existing = elements_by_id.get(way_id)
                if existing is not None and existing != raw_element:
                    raise ValidationError(f"OSM way {way_id} differs across source shards")
                elements_by_id[way_id] = raw_element
        elements = [elements_by_id[way_id] for way_id in sorted(elements_by_id)]

        latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
        longitude_scale = latitude_scale * math.cos(math.radians(origin_latitude))

        def local_position(raw: object) -> tuple[float, float]:
            if not isinstance(raw, dict):
                raise ValidationError("OSM way geometry position is invalid")
            latitude = raw.get("lat")
            longitude = raw.get("lon")
            if (
                isinstance(latitude, bool)
                or not isinstance(latitude, (int, float))
                or isinstance(longitude, bool)
                or not isinstance(longitude, (int, float))
                or not -90 <= float(latitude) <= 90
                or not -180 <= float(longitude) <= 180
            ):
                raise ValidationError("OSM way geometry coordinate is invalid")
            return (
                (float(longitude) - origin_longitude) * longitude_scale,
                (float(latitude) - origin_latitude) * latitude_scale,
            )

        def in_scope(positions: tuple[tuple[float, float], ...]) -> bool:
            radius_squared = exploration_radius_m**2
            return any(
                (x - route.x) ** 2 + (y - route.y) ** 2 <= radius_squared
                for x, y in positions
                for route in route_points
            )

        buildings: list[OsmBuilding] = []
        transport: list[OsmTransportFeature] = []
        for raw_element in elements:
            if (
                not isinstance(raw_element, dict)
                or raw_element.get("type") != "way"
            ):
                raise ValidationError("OSM source may contain only ways")
            way_id = raw_element.get("id")
            if (
                isinstance(way_id, bool)
                or not isinstance(way_id, int)
                or way_id <= 0
            ):
                raise ValidationError("OSM way ID is invalid")
            tags = raw_element.get("tags")
            geometry = raw_element.get("geometry")
            if not isinstance(tags, dict) or not isinstance(geometry, list):
                raise ValidationError(f"OSM way {way_id} lacks tags or geometry")
            positions = tuple(local_position(position) for position in geometry)
            if len(positions) < 2 or not in_scope(positions):
                continue
            feature_id = f"way/{way_id}"
            if (
                "building" in tags
                and len(positions) >= 4
                and positions[0] == positions[-1]
            ):
                raw_height = tags.get("height")
                raw_levels = tags.get("building:levels")
                height_source = "default-core-v1"
                height_m = 9.0
                try:
                    if isinstance(raw_height, str):
                        height_m = float(raw_height.removesuffix(" m"))
                        height_source = "osm-height"
                    elif isinstance(raw_levels, str):
                        height_m = float(raw_levels) * 3.0
                        height_source = "osm-building-levels-3m"
                except ValueError:
                    height_m = 9.0
                    height_source = "default-core-v1"
                if not math.isfinite(height_m) or not 1 <= height_m <= 1_000:
                    height_m = 9.0
                    height_source = "default-core-v1"
                footprint = positions[:-1]
                if len(set(footprint)) >= 3:
                    buildings.append(
                        OsmBuilding(feature_id, footprint, height_m, height_source)
                    )
            highway = tags.get("highway")
            if isinstance(highway, str) and highway:
                kind = (
                    "trails"
                    if highway in {"bridleway", "path", "track"}
                    else "paths"
                    if highway in {"cycleway", "footway", "pedestrian", "steps"}
                    else "roads"
                )
                transport.append(
                    OsmTransportFeature(feature_id, kind, highway, positions)
                )
        sorted_buildings = tuple(sorted(buildings, key=lambda item: item.feature_id))
        sorted_transport = tuple(sorted(transport, key=lambda item: item.feature_id))
        normalized_bytes = canonical_json_document(
            {
                "schemaVersion": 1,
                "coordinateReference": "route-local-enu-v1",
                "sourceSha256s": source_sha256s,
                "sourceDates": source_dates,
                "buildings": [
                    {
                        "featureId": building.feature_id,
                        "footprint": [list(point) for point in building.footprint],
                        "heightM": building.height_m,
                        "heightSource": building.height_source,
                    }
                    for building in sorted_buildings
                ],
                "transport": [
                    {
                        "featureId": feature.feature_id,
                        "kind": feature.kind,
                        "highway": feature.highway,
                        "positions": [list(position) for position in feature.positions],
                    }
                    for feature in sorted_transport
                ],
            }
        )
        return cls(
            paths=paths,
            source_sha256s=tuple(source_sha256s),
            source_dates=tuple(source_dates),
            normalized_bytes=normalized_bytes,
            sha256=sha256_bytes(normalized_bytes),
            source_date=max(source_dates),
            buildings=sorted_buildings,
            transport=sorted_transport,
        )

    def transportation_document(self) -> dict[str, object]:
        def group(kind: str) -> dict[str, object]:
            features = [
                {
                    "id": feature.feature_id,
                    "highway": feature.highway,
                    "positions": [list(position) for position in feature.positions],
                    "evidenceClass": "recorded",
                }
                for feature in self.transport
                if feature.kind == kind
            ]
            return {
                "class": "recorded" if features else "unavailable",
                "features": features,
            }

        return {
            "schemaVersion": 1,
            "coordinateReference": "route-local-enu-v1",
            "sourceSha256": self.sha256,
            "roads": group("roads"),
            "paths": group("paths"),
            "trails": group("trails"),
        }

    def collision_glb(
        self,
        route_points: list[LocalPoint],
        terrain: NormalizedTerrain | None,
    ) -> bytes:
        positions: list[tuple[float, float, float]] = []
        indices: list[int] = []
        obstacles: list[dict[str, object]] = []

        def ground_height(x: float, y: float) -> float:
            if terrain is not None:
                column = round((x - terrain.minimum_x_m) / terrain.step_m)
                row = round((y - terrain.minimum_y_m) / terrain.step_m)
                if 0 <= column < terrain.columns and 0 <= row < terrain.rows:
                    return terrain.heights_m[row * terrain.columns + column]
            return min(
                route_points,
                key=lambda point: (point.x - x) ** 2 + (point.y - y) ** 2,
            ).z

        for building in self.buildings:
            centre_x = sum(point[0] for point in building.footprint) / len(
                building.footprint
            )
            centre_y = sum(point[1] for point in building.footprint) / len(
                building.footprint
            )
            minimum_z = ground_height(centre_x, centre_y) - 1.0
            maximum_z = minimum_z + building.height_m + 1.0
            footprint = [list(point) for point in building.footprint]
            obstacles.append(
                {
                    "featureId": building.feature_id,
                    "footprint": footprint,
                    "minimumZ": minimum_z,
                    "maximumZ": maximum_z,
                    "horizontalSource": "osm-building-footprint",
                    "heightSource": building.height_source,
                }
            )
            for index, point in enumerate(building.footprint):
                next_point = building.footprint[
                    (index + 1) % len(building.footprint)
                ]
                offset = len(positions)
                positions.extend(
                    [
                        (point[0], point[1], minimum_z),
                        (next_point[0], next_point[1], minimum_z),
                        (point[0], point[1], maximum_z),
                        (next_point[0], next_point[1], maximum_z),
                    ]
                )
                indices.extend(
                    [
                        offset,
                        offset + 1,
                        offset + 2,
                        offset + 1,
                        offset + 3,
                        offset + 2,
                    ]
                )
        if not positions:
            raise ValidationError(
                "OSM source has no building collision in the exploration corridor"
            )
        return build_glb(
            positions,
            indices=indices,
            mode=4,
            name="OSM building-footprint collision prisms",
            extras={
                "godieselStructureCollision": {
                    "schemaVersion": 1,
                    "coordinateReference": "route-local-enu-v1",
                    "sourceSha256": self.sha256,
                    "obstacles": obstacles,
                }
            },
        )
