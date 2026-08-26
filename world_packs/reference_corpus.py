"""Validate and capture the fixed Sovereign Adventure Worlds reference corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DECLARATION_PATH = Path("docs/world-packs/reference-corpus.json")
DEFAULT_OUTPUT_PATH = Path("docs/world-packs/baseline/reference-corpus.json")
REFERENCE_CLASSES = {
    "dense-urban",
    "high-relief-mountain",
    "remote-coastal",
}


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _integer(value: object, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{label} must be an integer at least {minimum}")
    return value


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    return float(value)


def _local_path(root: Path, relative_path: object, label: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        raise ValueError(f"{label} must be a repository-relative path")
    root_resolved = root.resolve()
    resolved = (root / relative_path).resolve()
    if not resolved.is_relative_to(root_resolved):
        raise ValueError(f"{label} escapes the repository")
    if not resolved.is_file():
        raise ValueError(f"{label} does not exist: {relative_path}")
    return resolved


def _route_point(value: object, label: str) -> dict[str, float]:
    point = _record(value, label)
    result = {
        "lat": _number(point.get("lat"), f"{label}.lat"),
        "lng": _number(point.get("lng"), f"{label}.lng"),
        "elev": _number(point.get("elev"), f"{label}.elev"),
        "d": _number(point.get("d"), f"{label}.d"),
    }
    if not -90 <= result["lat"] <= 90:
        raise ValueError(f"{label}.lat is outside the valid range")
    if not -180 <= result["lng"] <= 180:
        raise ValueError(f"{label}.lng is outside the valid range")
    if "elapsed_s" in point:
        result["elapsedS"] = _number(point["elapsed_s"], f"{label}.elapsed_s")
    return result


def _control_point(index: int, point: dict[str, float], role: str) -> dict[str, object]:
    return {
        "role": role,
        "pointIndex": index,
        "evidence": "recorded",
        "position": point,
    }


def _capture_route(root: Path, declaration: dict[str, Any]) -> dict[str, object]:
    route_id = declaration.get("id")
    route_class = declaration.get("class")
    slug = declaration.get("slug")
    if not isinstance(route_id, str) or not route_id:
        raise ValueError("reference route id must have content")
    if route_class not in REFERENCE_CLASSES:
        raise ValueError(f"reference route {route_id} has an unsupported class")
    if not isinstance(slug, str) or not slug:
        raise ValueError(f"reference route {route_id} slug must have content")

    route_path = _local_path(root, declaration.get("routeDetail"), "routeDetail")
    source_bytes = route_path.read_bytes()
    detail = _record(json.loads(source_bytes), f"reference route {route_id} detail")
    if detail.get("slug") != slug or detail.get("activity_id") != slug:
        raise ValueError(f"reference route {route_id} identity does not match its detail")
    if detail.get("lifecycle") != "completed":
        raise ValueError(f"reference route {route_id} must be a completed route")
    replay = _record(detail.get("replay"), f"reference route {route_id} replay")
    if replay.get("geometry_status") != "ready" or replay.get("replay_eligible") is not True:
        raise ValueError(f"reference route {route_id} geometry is not replay ready")

    raw_points = detail.get("route")
    if not isinstance(raw_points, list) or len(raw_points) < 2:
        raise ValueError(f"reference route {route_id} needs at least two points")
    points = [
        _route_point(point, f"reference route {route_id} point {index}")
        for index, point in enumerate(raw_points)
    ]
    distances = [point["d"] for point in points]
    if distances[0] != 0 or any(after < before for before, after in zip(distances, distances[1:])):
        raise ValueError(f"reference route {route_id} distance is not monotonic from zero")

    midpoint_index = _integer(detail.get("mid_idx"), f"reference route {route_id} mid_idx")
    if midpoint_index >= len(points):
        raise ValueError(f"reference route {route_id} midpoint is outside its geometry")
    provenance = _record(detail.get("provenance"), f"reference route {route_id} provenance")
    discontinuities = provenance.get("discontinuities")
    if not isinstance(discontinuities, list):
        raise ValueError(f"reference route {route_id} discontinuities must be an array")

    cell_size = _integer(
        declaration.get("qualityCellSizeM"),
        f"reference route {route_id} qualityCellSizeM",
        minimum=1,
    )
    missing_offsets = declaration.get("deliberateMissingCellOffsets")
    if not isinstance(missing_offsets, list) or not missing_offsets:
        raise ValueError(f"reference route {route_id} needs deliberate missing cells")
    normalized_offsets: list[list[int]] = []
    for index, offset in enumerate(missing_offsets):
        if not isinstance(offset, list) or len(offset) != 2:
            raise ValueError(f"reference route {route_id} missing cell {index} is invalid")
        normalized_offsets.append(
            [
                _integer(abs(offset[0]), f"missing cell {index} easting")
                * (-1 if offset[0] < 0 else 1),
                _integer(abs(offset[1]), f"missing cell {index} northing")
                * (-1 if offset[1] < 0 else 1),
            ]
        )

    return {
        "id": route_id,
        "class": route_class,
        "slug": slug,
        "source": {
            "path": route_path.relative_to(root.resolve()).as_posix(),
            "sha256": sha256_bytes(source_bytes),
            "byteSize": len(source_bytes),
            "mediaType": "application/json",
            "evidence": "derived",
            "sourceKind": detail.get("source_kind"),
        },
        "route": {
            "name": detail.get("name"),
            "region": detail.get("region"),
            "activityType": detail.get("type"),
            "distanceM": points[-1]["d"],
            "declaredDistanceKm": detail.get("distance_km"),
            "declaredElevationGainM": detail.get("elevation_gain_m"),
            "pointCount": len(points),
            "annotationCount": len(detail.get("annotations", [])),
            "discontinuityCount": len(discontinuities),
            "bounds": {
                "south": min(point["lat"] for point in points),
                "west": min(point["lng"] for point in points),
                "north": max(point["lat"] for point in points),
                "east": max(point["lng"] for point in points),
                "minimumRecordedElevationM": min(point["elev"] for point in points),
                "maximumRecordedElevationM": max(point["elev"] for point in points),
            },
            "controls": [
                _control_point(0, points[0], "start"),
                _control_point(midpoint_index, points[midpoint_index], "midpoint"),
                _control_point(len(points) - 1, points[-1], "end"),
            ],
        },
        "world": {
            "corridorRadiusM": _integer(
                declaration.get("corridorRadiusM"),
                f"reference route {route_id} corridorRadiusM",
                minimum=1,
            ),
            "explorationRadiusM": _integer(
                declaration.get("explorationRadiusM"),
                f"reference route {route_id} explorationRadiusM",
                minimum=1,
            ),
            "qualityCellSizeM": cell_size,
            "deliberateMissingCellOffsets": normalized_offsets,
            "requiredCases": declaration.get("requiredCases"),
        },
    }


def capture_reference_corpus(root: Path = ROOT) -> dict[str, object]:
    declaration_path = _local_path(root, DECLARATION_PATH.as_posix(), "declaration")
    declaration_bytes = declaration_path.read_bytes()
    declaration = _record(json.loads(declaration_bytes), "reference corpus")
    routes = declaration.get("routes")
    if not isinstance(routes, list) or len(routes) != 3:
        raise ValueError("reference corpus must contain exactly three routes")
    captured_routes = [
        _capture_route(root.resolve(), _record(route, "reference route"))
        for route in routes
    ]
    if {route["class"] for route in captured_routes} != REFERENCE_CLASSES:
        raise ValueError("reference corpus must cover urban, mountain, and coastal classes")
    return {
        "schemaVersion": _integer(declaration.get("schemaVersion"), "schemaVersion", minimum=1),
        "sourceCommit": declaration.get("sourceCommit"),
        "declaration": {
            "path": DECLARATION_PATH.as_posix(),
            "sha256": sha256_bytes(declaration_bytes),
        },
        "routes": captured_routes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()
    result = capture_reference_corpus(args.root.resolve())
    output_path = args.output
    if not output_path.is_absolute():
        output_path = args.root / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json_bytes(result))


if __name__ == "__main__":
    main()
