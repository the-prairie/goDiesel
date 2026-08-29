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
        element_variants: dict[tuple[int, str], tuple[int, dict[str, object]]] = {}
        way_variant_counts: dict[int, int] = {}
        node_coordinates: dict[int, dict[str, float]] = {}
        for shard_index, path in enumerate(paths):
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
                if not isinstance(raw_element, dict):
                    raise ValidationError("OSM source element is invalid")
                if raw_element.get("type") == "node":
                    node_id = raw_element.get("id")
                    latitude = raw_element.get("lat")
                    longitude = raw_element.get("lon")
                    if (
                        isinstance(node_id, bool)
                        or not isinstance(node_id, int)
                        or isinstance(latitude, bool)
                        or not isinstance(latitude, (int, float))
                        or isinstance(longitude, bool)
                        or not isinstance(longitude, (int, float))
                    ):
                        raise ValidationError("OSM node is invalid")
                    coordinate = {"lat": float(latitude), "lon": float(longitude)}
                    existing_coordinate = node_coordinates.get(node_id)
                    if (
                        existing_coordinate is not None
                        and existing_coordinate != coordinate
                    ):
                        raise ValidationError(
                            f"OSM node {node_id} differs across source shards"
                        )
                    node_coordinates[node_id] = coordinate
                    continue
                if raw_element.get("type") != "way":
                    raise ValidationError("OSM source may contain only ways and nodes")
                way_id = raw_element.get("id")
                if (
                    isinstance(way_id, bool)
                    or not isinstance(way_id, int)
                    or way_id <= 0
                ):
                    raise ValidationError("OSM way ID is invalid")
                variant_digest = sha256_bytes(
                    canonical_json_document(raw_element)
                )
                key = (way_id, variant_digest)
                if key not in element_variants:
                    element_variants[key] = (shard_index, raw_element)
                    way_variant_counts[way_id] = way_variant_counts.get(way_id, 0) + 1
        elements = [
            (shard_index, raw_element)
            for _, (shard_index, raw_element) in sorted(element_variants.items())
        ]

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
        for shard_index, raw_element in elements:
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
            if not isinstance(tags, dict):
                raise ValidationError(f"OSM way {way_id} lacks tags")
            if not isinstance(geometry, list):
                raw_nodes = raw_element.get("nodes")
                if not isinstance(raw_nodes, list) or any(
                    isinstance(node_id, bool) or not isinstance(node_id, int)
                    for node_id in raw_nodes
                ):
                    raise ValidationError(f"OSM way {way_id} lacks geometry")
                try:
                    geometry = [node_coordinates[node_id] for node_id in raw_nodes]
                except KeyError as error:
                    raise ValidationError(
                        f"OSM way {way_id} references a missing node"
                    ) from error
            positions = tuple(
                local_position(position) for position in geometry if position is not None
            )
            if len(positions) < 2 or not in_scope(positions):
                continue
            feature_id = (
                f"way/{way_id}@shard/{shard_index:03d}"
                if way_variant_counts[way_id] > 1
                else f"way/{way_id}"
            )
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
        *,
        disconnected_after: frozenset[int] = frozenset(),
        route_clearance_m: float = 0.35,
    ) -> bytes:
        if route_clearance_m < 0:
            raise ValidationError("route collision clearance cannot be negative")
        positions: list[tuple[float, float, float]] = []
        indices: list[int] = []
        obstacles: list[dict[str, object]] = []
        excluded_route_conflicts: list[str] = []

        def point_in_polygon(
            footprint: tuple[tuple[float, float], ...],
            x: float,
            y: float,
        ) -> bool:
            inside = False
            previous = len(footprint) - 1
            for index, (current_x, current_y) in enumerate(footprint):
                previous_x, previous_y = footprint[previous]
                if (
                    (current_y > y) != (previous_y > y)
                    and x
                    < (previous_x - current_x)
                    * (y - current_y)
                    / (previous_y - current_y)
                    + current_x
                ):
                    inside = not inside
                previous = index
            return inside

        def orientation(
            first: tuple[float, float],
            second: tuple[float, float],
            third: tuple[float, float],
        ) -> float:
            return (second[0] - first[0]) * (third[1] - first[1]) - (
                second[1] - first[1]
            ) * (third[0] - first[0])

        def segments_cross(
            first_start: tuple[float, float],
            first_end: tuple[float, float],
            second_start: tuple[float, float],
            second_end: tuple[float, float],
        ) -> bool:
            if (
                max(first_start[0], first_end[0])
                < min(second_start[0], second_end[0])
                or min(first_start[0], first_end[0])
                > max(second_start[0], second_end[0])
                or max(first_start[1], first_end[1])
                < min(second_start[1], second_end[1])
                or min(first_start[1], first_end[1])
                > max(second_start[1], second_end[1])
            ):
                return False
            first_a = orientation(first_start, first_end, second_start)
            first_b = orientation(first_start, first_end, second_end)
            second_a = orientation(second_start, second_end, first_start)
            second_b = orientation(second_start, second_end, first_end)
            return first_a * first_b <= 0 and second_a * second_b <= 0

        def point_segment_distance_squared(
            point: tuple[float, float],
            segment_start: tuple[float, float],
            segment_end: tuple[float, float],
        ) -> float:
            delta_x = segment_end[0] - segment_start[0]
            delta_y = segment_end[1] - segment_start[1]
            length_squared = delta_x**2 + delta_y**2
            ratio = (
                0.0
                if length_squared == 0
                else max(
                    0.0,
                    min(
                        1.0,
                        (
                            (point[0] - segment_start[0]) * delta_x
                            + (point[1] - segment_start[1]) * delta_y
                        )
                        / length_squared,
                    ),
                )
            )
            nearest_x = segment_start[0] + ratio * delta_x
            nearest_y = segment_start[1] + ratio * delta_y
            return (point[0] - nearest_x) ** 2 + (point[1] - nearest_y) ** 2

        def conflicts_with_route(building: OsmBuilding) -> bool:
            minimum_x = min(point[0] for point in building.footprint)
            maximum_x = max(point[0] for point in building.footprint)
            minimum_y = min(point[1] for point in building.footprint)
            maximum_y = max(point[1] for point in building.footprint)
            if any(
                minimum_x <= point.x <= maximum_x
                and minimum_y <= point.y <= maximum_y
                and point_in_polygon(building.footprint, point.x, point.y)
                for point in route_points
            ):
                return True
            for route_index, route_start in enumerate(route_points[:-1]):
                if route_index in disconnected_after:
                    continue
                route_end = route_points[route_index + 1]
                if (
                    max(route_start.x, route_end.x)
                    < minimum_x - route_clearance_m
                    or min(route_start.x, route_end.x)
                    > maximum_x + route_clearance_m
                    or max(route_start.y, route_end.y)
                    < minimum_y - route_clearance_m
                    or min(route_start.y, route_end.y)
                    > maximum_y + route_clearance_m
                ):
                    continue
                route_segment_start = (route_start.x, route_start.y)
                route_segment_end = (route_end.x, route_end.y)
                clearance_squared = route_clearance_m**2
                for footprint_index, footprint_start in enumerate(
                    building.footprint
                ):
                    footprint_end = building.footprint[
                        (footprint_index + 1) % len(building.footprint)
                    ]
                    if segments_cross(
                        route_segment_start,
                        route_segment_end,
                        footprint_start,
                        footprint_end,
                    ):
                        return True
                    if min(
                        point_segment_distance_squared(
                            route_segment_start, footprint_start, footprint_end
                        ),
                        point_segment_distance_squared(
                            route_segment_end, footprint_start, footprint_end
                        ),
                        point_segment_distance_squared(
                            footprint_start,
                            route_segment_start,
                            route_segment_end,
                        ),
                        point_segment_distance_squared(
                            footprint_end, route_segment_start, route_segment_end
                        ),
                    ) <= clearance_squared:
                        return True
            return False

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
            if conflicts_with_route(building):
                excluded_route_conflicts.append(building.feature_id)
                continue
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
                    "excludedRouteConflictFeatureIds": excluded_route_conflicts,
                    "obstacles": obstacles,
                }
            },
        )
