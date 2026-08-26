"""Deterministic local-coordinate GLB geometry for Core World Packs."""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from typing import Iterable, Sequence


EARTH_RADIUS_M = 6_378_137.0
GLB_MAGIC = 0x46546C67
GLB_VERSION = 2
JSON_CHUNK = 0x4E4F534A
BINARY_CHUNK = 0x004E4942


@dataclass(frozen=True)
class LocalPoint:
    x: float
    y: float
    z: float
    distance_m: float


def route_local_points(canonical_route: dict[str, object]) -> list[LocalPoint]:
    raw_coordinates = canonical_route["coordinates"]
    if not isinstance(raw_coordinates, list) or len(raw_coordinates) < 2:
        raise ValueError("canonical route needs at least two coordinates")
    origin = raw_coordinates[0]
    if not isinstance(origin, dict):
        raise ValueError("canonical route origin is invalid")
    origin_latitude = float(origin["latitude"])
    origin_longitude = float(origin["longitude"])
    origin_elevation = float(origin["elevationM"])
    latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
    longitude_scale = latitude_scale * math.cos(math.radians(origin_latitude))
    result = []
    for raw_coordinate in raw_coordinates:
        if not isinstance(raw_coordinate, dict):
            raise ValueError("canonical route coordinate is invalid")
        result.append(
            LocalPoint(
                x=(float(raw_coordinate["longitude"]) - origin_longitude)
                * longitude_scale,
                y=(float(raw_coordinate["latitude"]) - origin_latitude)
                * latitude_scale,
                z=float(raw_coordinate["elevationM"]) - origin_elevation,
                distance_m=float(raw_coordinate["distanceM"]),
            )
        )
    return result


def _padded(value: bytes, fill: bytes) -> bytes:
    remainder = len(value) % 4
    return value if remainder == 0 else value + fill * (4 - remainder)


def build_glb(
    positions: Sequence[tuple[float, float, float]],
    *,
    indices: Sequence[int] | None,
    mode: int,
    name: str,
    normals: Sequence[tuple[float, float, float]] | None = None,
    colors: Sequence[tuple[float, float, float, float]] | None = None,
    material: dict[str, object] | None = None,
) -> bytes:
    if not positions:
        raise ValueError("GLB needs at least one position")
    if normals is not None and len(normals) != len(positions):
        raise ValueError("GLB normal count does not match positions")
    if colors is not None and len(colors) != len(positions):
        raise ValueError("GLB color count does not match positions")
    position_bytes = b"".join(struct.pack("<fff", *position) for position in positions)
    binary = bytearray(position_bytes)
    buffer_views = [
        {
            "buffer": 0,
            "byteOffset": 0,
            "byteLength": len(position_bytes),
            "target": 34962,
        }
    ]
    accessors = [
        {
            "bufferView": 0,
            "componentType": 5126,
            "count": len(positions),
            "type": "VEC3",
            "min": [min(position[axis] for position in positions) for axis in range(3)],
            "max": [max(position[axis] for position in positions) for axis in range(3)],
        }
    ]
    primitive: dict[str, object] = {"attributes": {"POSITION": 0}, "mode": mode}
    if indices is not None:
        while len(binary) % 4:
            binary.append(0)
        index_offset = len(binary)
        index_bytes = b"".join(struct.pack("<I", index) for index in indices)
        binary.extend(index_bytes)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": index_offset,
                "byteLength": len(index_bytes),
                "target": 34963,
            }
        )
        accessors.append(
            {
                "bufferView": 1,
                "componentType": 5125,
                "count": len(indices),
                "type": "SCALAR",
                "min": [min(indices)],
                "max": [max(indices)],
            }
        )
        primitive["indices"] = 1
    if normals is not None:
        while len(binary) % 4:
            binary.append(0)
        normal_offset = len(binary)
        normal_bytes = b"".join(struct.pack("<fff", *normal) for normal in normals)
        binary.extend(normal_bytes)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": normal_offset,
                "byteLength": len(normal_bytes),
                "target": 34962,
            }
        )
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
            }
        )
        primitive["attributes"]["NORMAL"] = len(accessors) - 1
    if colors is not None:
        while len(binary) % 4:
            binary.append(0)
        color_offset = len(binary)
        color_bytes = b"".join(struct.pack("<ffff", *color) for color in colors)
        binary.extend(color_bytes)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": color_offset,
                "byteLength": len(color_bytes),
                "target": 34962,
            }
        )
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(colors),
                "type": "VEC4",
            }
        )
        primitive["attributes"]["COLOR_0"] = len(accessors) - 1
    if material is not None:
        primitive["material"] = 0
    document = {
        "asset": {"version": "2.0", "generator": "godiesel-world-compiler/1"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [primitive]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    if material is not None:
        document["materials"] = [material]
    json_bytes = _padded(
        json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        b" ",
    )
    binary_bytes = _padded(bytes(binary), b"\0")
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    return b"".join(
        [
            struct.pack("<III", GLB_MAGIC, GLB_VERSION, total_length),
            struct.pack("<II", len(json_bytes), JSON_CHUNK),
            json_bytes,
            struct.pack("<II", len(binary_bytes), BINARY_CHUNK),
            binary_bytes,
        ]
    )


def empty_glb(name: str) -> bytes:
    document = {
        "asset": {"version": "2.0", "generator": "godiesel-world-compiler/1"},
        "scene": 0,
        "scenes": [{"nodes": []}],
        "nodes": [],
        "extras": {"name": name, "evidenceClass": "unavailable"},
    }
    json_bytes = _padded(
        json.dumps(document, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        b" ",
    )
    total_length = 12 + 8 + len(json_bytes)
    return b"".join(
        [
            struct.pack("<III", GLB_MAGIC, GLB_VERSION, total_length),
            struct.pack("<II", len(json_bytes), JSON_CHUNK),
            json_bytes,
        ]
    )


def route_thread_glb(
    points: Sequence[LocalPoint],
    *,
    lift_m: float = 1.5,
    disconnected_after: frozenset[int] = frozenset(),
) -> bytes:
    indices = None
    mode = 3
    if disconnected_after:
        indices = [
            endpoint
            for index in range(len(points) - 1)
            if index not in disconnected_after
            for endpoint in (index, index + 1)
        ]
        mode = 1
    return build_glb(
        [(point.x, point.y, point.z + lift_m) for point in points],
        indices=indices,
        mode=mode,
        name="Recorded route thread",
    )


def route_ribbon_glb(
    points: Sequence[LocalPoint],
    *,
    width_m: float = 4.0,
    disconnected_after: frozenset[int] = frozenset(),
) -> bytes:
    if len(points) < 2:
        raise ValueError("route ribbon needs at least two points")
    half_width = width_m / 2.0
    positions: list[tuple[float, float, float]] = []
    for index, point in enumerate(points):
        before = points[max(0, index - 1)]
        after = points[min(len(points) - 1, index + 1)]
        direction_x = after.x - before.x
        direction_y = after.y - before.y
        magnitude = math.hypot(direction_x, direction_y) or 1.0
        perpendicular_x = -direction_y / magnitude * half_width
        perpendicular_y = direction_x / magnitude * half_width
        positions.extend(
            [
                (point.x + perpendicular_x, point.y + perpendicular_y, point.z),
                (point.x - perpendicular_x, point.y - perpendicular_y, point.z),
            ]
        )
    indices = []
    for index in range(len(points) - 1):
        if index in disconnected_after:
            continue
        left = index * 2
        next_left = left + 2
        indices.extend([left, left + 1, next_left, left + 1, next_left + 1, next_left])
    component_starts = [0, *(index + 1 for index in sorted(disconnected_after))]
    component_ends = [*sorted(disconnected_after), len(points) - 1]
    for start, end in zip(component_starts, component_ends):
        if end <= start:
            continue
        for point_index, direction in ((start, -1.0), (end, 1.0)):
            neighbour_index = point_index + 1 if point_index == start else point_index - 1
            point = points[point_index]
            neighbour = points[neighbour_index]
            tangent_x = point.x - neighbour.x
            tangent_y = point.y - neighbour.y
            if point_index == start:
                tangent_x *= -1
                tangent_y *= -1
            magnitude = math.hypot(tangent_x, tangent_y) or 1.0
            extension_x = tangent_x / magnitude * half_width * direction
            extension_y = tangent_y / magnitude * half_width * direction
            cap_left = len(positions)
            positions.extend(
                [
                    (
                        positions[point_index * 2][0] + extension_x,
                        positions[point_index * 2][1] + extension_y,
                        point.z,
                    ),
                    (
                        positions[point_index * 2 + 1][0] + extension_x,
                        positions[point_index * 2 + 1][1] + extension_y,
                        point.z,
                    ),
                ]
            )
            route_left = point_index * 2
            if point_index == start:
                indices.extend(
                    [cap_left, cap_left + 1, route_left, cap_left + 1, route_left + 1, route_left]
                )
            else:
                indices.extend(
                    [route_left, route_left + 1, cap_left, route_left + 1, cap_left + 1, cap_left]
                )
    return build_glb(
        positions,
        indices=indices,
        mode=4,
        name="Procedural traversable route surface",
    )


def terrain_grid(
    points: Sequence[LocalPoint],
    *,
    exploration_radius_m: float,
    cell_size_m: float,
    maximum_axis_cells: int = 192,
) -> tuple[list[tuple[float, float, float]], list[int]]:
    minimum_x = min(point.x for point in points) - exploration_radius_m
    maximum_x = max(point.x for point in points) + exploration_radius_m
    minimum_y = min(point.y for point in points) - exploration_radius_m
    maximum_y = max(point.y for point in points) + exploration_radius_m
    x_cells = max(1, math.ceil((maximum_x - minimum_x) / cell_size_m))
    y_cells = max(1, math.ceil((maximum_y - minimum_y) / cell_size_m))
    scale = max(x_cells / maximum_axis_cells, y_cells / maximum_axis_cells, 1)
    x_cells = math.ceil(x_cells / scale)
    y_cells = math.ceil(y_cells / scale)
    x_step = (maximum_x - minimum_x) / x_cells
    y_step = (maximum_y - minimum_y) / y_cells

    positions = []
    for y_index in range(y_cells + 1):
        y_value = minimum_y + y_index * y_step
        for x_index in range(x_cells + 1):
            x_value = minimum_x + x_index * x_step
            nearest = min(
                points,
                key=lambda point: (point.x - x_value) ** 2 + (point.y - y_value) ** 2,
            )
            positions.append((x_value, y_value, nearest.z))
    row_width = x_cells + 1
    indices = []
    for y_index in range(y_cells):
        for x_index in range(x_cells):
            lower_left = y_index * row_width + x_index
            upper_left = lower_left + row_width
            indices.extend(
                [
                    lower_left,
                    lower_left + 1,
                    upper_left,
                    lower_left + 1,
                    upper_left + 1,
                    upper_left,
                ]
            )
    return positions, indices


def terrain_glb(
    points: Sequence[LocalPoint],
    *,
    exploration_radius_m: float,
    cell_size_m: float,
    name: str,
) -> bytes:
    positions, indices = terrain_grid(
        points,
        exploration_radius_m=exploration_radius_m,
        cell_size_m=cell_size_m,
    )
    return build_glb(positions, indices=indices, mode=4, name=name)


def glb_json(glb: bytes) -> dict[str, object]:
    magic, version, total_length = struct.unpack_from("<III", glb, 0)
    if (magic, version, total_length) != (GLB_MAGIC, GLB_VERSION, len(glb)):
        raise ValueError("invalid GLB header")
    json_length, chunk_type = struct.unpack_from("<II", glb, 12)
    if chunk_type != JSON_CHUNK:
        raise ValueError("GLB first chunk is not JSON")
    return json.loads(glb[20 : 20 + json_length].decode("utf-8"))
