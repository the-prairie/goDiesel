"""Strict readiness checks for generated route summary and detail records."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from quest_meta import (
    BEST_IN_EARTH_IDS,
    build_quest_meta,
    build_replay_metadata,
    build_route_curation,
    elevation_gain_m,
    route_manifest_record,
)
from route_annotations import build_route_annotations


LIFECYCLES = {"completed", "planned", "discovered"}
ELEVATION_STATUSES = {"recorded", "unavailable"}
COMMON_STRING_FIELDS = (
    "slug",
    "activity_id",
    "source_kind",
    "name",
    "subtitle",
    "activity_name",
    "region",
    "date",
    "type",
    "description",
    "completion_rule",
    "difficulty",
    "theme",
)
COMMON_NUMBER_FIELDS = ("distance_km", "xp", "center_lat", "center_lng")
NONEMPTY_STRING_FIELDS = {
    "slug",
    "activity_id",
    "source_kind",
    "name",
    "region",
    "type",
    "difficulty",
    "theme",
}
SHARED_FIELDS = (
    *COMMON_STRING_FIELDS,
    *COMMON_NUMBER_FIELDS,
    "lifecycle",
    "elevation_gain_m",
    "elevation_status",
    "replay",
)


def _finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _valid_common(record: Mapping[str, object]) -> bool:
    if any(not isinstance(record.get(field), str) for field in COMMON_STRING_FIELDS):
        return False
    if any(not _finite_number(record.get(field)) for field in COMMON_NUMBER_FIELDS):
        return False
    if any(not str(record[field]).strip() for field in NONEMPTY_STRING_FIELDS):
        return False
    if record.get("lifecycle") not in LIFECYCLES:
        return False
    elevation_status = record.get("elevation_status")
    elevation_gain = record.get("elevation_gain_m")
    if elevation_status not in ELEVATION_STATUSES:
        return False
    if elevation_status == "unavailable":
        if elevation_gain is not None:
            return False
    elif not _finite_number(elevation_gain) or float(elevation_gain) < 0:
        return False
    return (
        float(record["distance_km"]) >= 0
        and float(record["xp"]) >= 0
        and -90 <= float(record["center_lat"]) <= 90
        and -180 <= float(record["center_lng"]) <= 180
    )


def _point_values(point: object) -> tuple[object, object, object, object, object] | None:
    if isinstance(point, list):
        if len(point) < 4:
            return None
        return point[0], point[1], point[2], point[3], None
    if isinstance(point, Mapping):
        return (
            point.get("lat"),
            point.get("lng"),
            point.get("elev"),
            point.get("d"),
            point.get("elapsed_s"),
        )
    return None


def _valid_points(points: object, elevation_status: object) -> bool:
    if not isinstance(points, list) or len(points) < 2:
        return False
    previous_distance = -1.0
    previous_elapsed = -1.0
    for point in points:
        values = _point_values(point)
        if values is None:
            return False
        lat, lng, elevation, distance, elapsed = values
        if (
            not _finite_number(lat)
            or not _finite_number(lng)
            or not _finite_number(distance)
            or not -90 <= float(lat) <= 90
            or not -180 <= float(lng) <= 180
            or float(distance) < previous_distance
            or float(distance) < 0
        ):
            return False
        if elevation_status == "unavailable":
            if elevation is not None:
                return False
        elif not _finite_number(elevation):
            return False
        if elapsed is not None:
            if (
                not _finite_number(elapsed)
                or float(elapsed) < previous_elapsed
                or float(elapsed) < 0
            ):
                return False
            previous_elapsed = float(elapsed)
        previous_distance = float(distance)
    return True


def _valid_replay(record: Mapping[str, object], point_count: int) -> bool:
    replay = record.get("replay")
    if not isinstance(replay, Mapping):
        return False
    mode = replay.get("mode")
    eligible = replay.get("replay_eligible")
    best = replay.get("best_in_earth")
    geometry = replay.get("geometry_status")
    return (
        mode in {"atlas", "earth"}
        and isinstance(eligible, bool)
        and isinstance(best, bool)
        and geometry == "ready"
        and replay.get("point_count") == point_count
        and (not best or mode == "earth")
        and eligible == (record.get("lifecycle") != "planned")
    )


def _valid_provenance(
    provenance: object,
    *,
    elevation_status: object,
    total_distance: float,
) -> bool:
    if not isinstance(provenance, Mapping):
        return False
    temporal = provenance.get("temporal")
    elevation = provenance.get("elevation")
    track = provenance.get("track")
    discontinuities = provenance.get("discontinuities")
    if (
        not isinstance(temporal, Mapping)
        or temporal.get("status") not in {"recorded", "unavailable"}
        or not isinstance(elevation, Mapping)
        or elevation.get("status") != elevation_status
        or not isinstance(track, Mapping)
        or not isinstance(track.get("segment_count"), int)
        or isinstance(track.get("segment_count"), bool)
        or int(track["segment_count"]) < 0
        or not isinstance(discontinuities, list)
    ):
        return False
    if temporal["status"] == "recorded":
        start_time = temporal.get("start_time_utc")
        if (
            not isinstance(start_time, str)
            or not start_time.endswith("Z")
            or not _finite_number(temporal.get("elapsed_time_s"))
            or float(temporal["elapsed_time_s"]) < 0
        ):
            return False
        try:
            datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            if temporal.get("time_zone") is not None:
                ZoneInfo(str(temporal["time_zone"]))
        except (ValueError, ZoneInfoNotFoundError):
            return False
    expected_sources = {
        "segment_boundary": "recorded_track_segment",
        "recording_gap": "recorded_timestamps",
        "missing_position_records": "recorded_position_absence",
    }
    for item in discontinuities:
        if not isinstance(item, Mapping):
            return False
        start = item.get("start_d")
        end = item.get("end_d")
        if (
            expected_sources.get(item.get("kind")) != item.get("source")
            or not _finite_number(start)
            or not _finite_number(end)
            or float(start) < 0
            or float(end) < float(start)
            or float(end) > total_distance
        ):
            return False
        elapsed = item.get("elapsed_time_s")
        missing_count = item.get("missing_record_count")
        if elapsed is not None and (
            not _finite_number(elapsed) or float(elapsed) < 0
        ):
            return False
        if missing_count is not None and (
            not isinstance(missing_count, int)
            or isinstance(missing_count, bool)
            or missing_count < 1
        ):
            return False
    return True


def valid_generated_projection(
    canonical: Mapping[str, object],
    summary: Mapping[str, object],
    detail: Mapping[str, object],
) -> bool:
    if not _valid_common(summary) or not _valid_common(detail):
        return False
    if any(summary.get(field) != detail.get(field) for field in SHARED_FIELDS):
        return False
    route = detail.get("route")
    trace = summary.get("trace")
    elevation_status = detail.get("elevation_status")
    if not _valid_points(route, elevation_status) or not _valid_points(
        trace, elevation_status
    ):
        return False
    assert isinstance(route, list)
    assert isinstance(trace, list)
    route_last = _point_values(route[-1])
    if route_last is None:
        return False
    total_distance = float(route_last[3])
    route_lats = [float(_point_values(point)[0]) for point in route]
    route_lngs = [float(_point_values(point)[1]) for point in route]
    if (
        detail.get("center_lat") != (min(route_lats) + max(route_lats)) / 2
        or detail.get("center_lng") != (min(route_lngs) + max(route_lngs)) / 2
    ):
        return False
    mid_idx = detail.get("mid_idx")
    if (
        not isinstance(mid_idx, int)
        or isinstance(mid_idx, bool)
        or mid_idx != len(route) // 2
        or not _valid_replay(detail, len(route))
        or not _valid_replay(summary, len(route))
        or not _valid_provenance(
            detail.get("provenance"),
            elevation_status=elevation_status,
            total_distance=total_distance,
        )
    ):
        return False
    if round(total_distance / 1000, 1) != detail.get("distance_km"):
        return False
    canonical_id = str(canonical.get("activity_id", ""))
    if canonical_id != detail.get("activity_id") or canonical_id != detail.get("slug"):
        return False
    expected_replay = build_replay_metadata(
        canonical_id,
        len(route),
        BEST_IN_EARTH_IDS,
        str(detail["lifecycle"]),
        canonical.get("replay_mode"),
    )
    if detail.get("replay") != expected_replay:
        return False
    expected_meta = build_quest_meta(
        activity_type=str(detail["type"]),
        distance_km=float(detail["distance_km"]),
        elevation_gain=(
            elevation_gain_m(route) if elevation_status == "recorded" else None
        ),
        region_label=str(detail["region"]),
        activity_name=str(detail["activity_name"]),
    )
    for field in ("theme", "difficulty", "completion_rule"):
        if canonical.get(field):
            expected_meta[field] = str(canonical[field]).strip()
    if any(detail.get(field) != value for field, value in expected_meta.items()):
        return False
    try:
        expected_curation = build_route_curation(canonical.get("curation") or {})
        expected_annotations = build_route_annotations(
            canonical.get("annotations") or [], total_distance
        )
    except ValueError:
        return False
    if (
        detail.get("curation", {"review_status": "draft"}) != expected_curation
        or detail.get("annotations", []) != expected_annotations
    ):
        return False
    try:
        return dict(summary) == route_manifest_record(detail)
    except (KeyError, TypeError):
        return False


def completed_distance_km(details: Sequence[Mapping[str, object]]) -> float | None:
    distances = [
        detail.get("distance_km")
        for detail in details
        if detail.get("lifecycle") == "completed"
    ]
    if any(not _finite_number(value) or float(value) < 0 for value in distances):
        return None
    return round(sum(float(value) for value in distances), 1)
