"""Exact normalization of strict goDiesel route detail into pack route truth."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .canonical import strict_json_load
from .errors import ValidationError
from .schema import validate_document


def _record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be an object")
    return value


def _number(value: object, label: str, *, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{label} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise ValidationError(f"{label} must be finite")
    if minimum is not None and result < minimum:
        raise ValidationError(f"{label} must be at least {minimum}")
    return result


def _nullable_number(value: object, label: str) -> float | None:
    if value is None:
        return None
    return _number(value, label, minimum=0)


def normalize_route_detail(value: object) -> dict[str, object]:
    detail = _record(value, "route detail")
    route_id = detail.get("activity_id")
    slug = detail.get("slug")
    if not isinstance(route_id, str) or not route_id:
        raise ValidationError("route detail activity_id must have content")
    if not isinstance(slug, str) or not slug:
        raise ValidationError("route detail slug must have content")
    if route_id != slug:
        raise ValidationError("route detail activity_id and slug must match")

    raw_coordinates = detail.get("route")
    if not isinstance(raw_coordinates, list) or len(raw_coordinates) < 2:
        raise ValidationError("route detail needs at least two coordinates")
    coordinates: list[dict[str, object]] = []
    previous_distance = -1.0
    for index, raw_coordinate in enumerate(raw_coordinates):
        coordinate = _record(raw_coordinate, f"route coordinate {index}")
        latitude = _number(coordinate.get("lat"), f"coordinate {index} latitude")
        longitude = _number(
            coordinate.get("lng"), f"coordinate {index} longitude"
        )
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise ValidationError(f"route coordinate {index} is outside WGS84")
        distance = _number(
            coordinate.get("d"), f"coordinate {index} distance", minimum=0
        )
        if index == 0 and distance != 0:
            raise ValidationError("canonical route must begin at zero distance")
        if distance < previous_distance:
            raise ValidationError("canonical route distance must be monotonic")
        previous_distance = distance
        coordinates.append(
            {
                "latitude": latitude,
                "longitude": longitude,
                "elevationM": _number(
                    coordinate.get("elev"), f"coordinate {index} elevation"
                ),
                "distanceM": distance,
                "elapsedS": _nullable_number(
                    coordinate.get("elapsed_s"), f"coordinate {index} elapsed"
                ),
            }
        )

    provenance = _record(detail.get("provenance"), "route provenance")
    track = _record(provenance.get("track"), "route track provenance")
    segment_count = track.get("segment_count")
    if (
        isinstance(segment_count, bool)
        or not isinstance(segment_count, int)
        or segment_count < 1
    ):
        raise ValidationError("route segment_count must be a positive integer")
    raw_discontinuities = provenance.get("discontinuities")
    if not isinstance(raw_discontinuities, list):
        raise ValidationError("route discontinuities must be an array")
    discontinuities = []
    for index, raw_discontinuity in enumerate(raw_discontinuities):
        discontinuity = _record(
            raw_discontinuity, f"route discontinuity {index}"
        )
        kind = discontinuity.get("kind")
        source = discontinuity.get("source")
        if not isinstance(kind, str) or not kind:
            raise ValidationError(f"route discontinuity {index} kind is invalid")
        if not isinstance(source, str) or not source:
            raise ValidationError(f"route discontinuity {index} source is invalid")
        discontinuities.append(
            {
                "kind": kind,
                "source": source,
                "startDistanceM": _number(
                    discontinuity.get("start_d"),
                    f"route discontinuity {index} start",
                    minimum=0,
                ),
                "endDistanceM": _number(
                    discontinuity.get("end_d"),
                    f"route discontinuity {index} end",
                    minimum=0,
                ),
                "elapsedS": _nullable_number(
                    discontinuity.get("elapsed_time_s"),
                    f"route discontinuity {index} elapsed",
                ),
                "missingRecordCount": (
                    None
                    if discontinuity.get("missing_record_count") is None
                    else int(
                        _number(
                            discontinuity["missing_record_count"],
                            f"route discontinuity {index} missing records",
                            minimum=0,
                        )
                    )
                ),
            }
        )

    result = {
        "schemaVersion": 1,
        "routeId": route_id,
        "slug": slug,
        "name": detail.get("name") if isinstance(detail.get("name"), str) else None,
        "region": (
            detail.get("region") if isinstance(detail.get("region"), str) else None
        ),
        "activityType": (
            detail.get("type") if isinstance(detail.get("type"), str) else None
        ),
        "lifecycle": detail.get("lifecycle"),
        "sourceKind": (
            detail.get("source_kind")
            if isinstance(detail.get("source_kind"), str)
            else None
        ),
        "coordinates": coordinates,
        "segmentCount": segment_count,
        "discontinuities": discontinuities,
    }
    validate_document("canonical-route", result)
    return result


def load_canonical_route(path: Path) -> dict[str, object]:
    return normalize_route_detail(strict_json_load(path))
