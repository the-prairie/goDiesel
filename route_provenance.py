"""Source-backed route timing and track-boundary provenance."""

from dataclasses import dataclass
from datetime import UTC, datetime
import gzip
import math
from pathlib import Path

import gpxpy
from fitparse import FitFile


@dataclass(frozen=True)
class SourceRoutePoint:
    lat: float | None
    lng: float | None
    elevation: float | None
    timestamp: datetime | None = None
    segment_index: int = 0


@dataclass(frozen=True)
class RouteProvenanceResult:
    route: list[dict[str, float | None]]
    temporal: dict[str, object]
    elevation: dict[str, str]
    track: dict[str, int]
    discontinuities: list[dict[str, object]]


def _recorded_timestamp(value: object) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def source_point_from_fit_fields(
    fields: dict[str, object],
    *,
    segment_index: int = 0,
) -> SourceRoutePoint | None:
    lat = fields.get("position_lat")
    lng = fields.get("position_long")
    has_position = isinstance(lat, (int, float)) and isinstance(lng, (int, float))
    timestamp = _recorded_timestamp(fields.get("timestamp"))
    if not has_position and timestamp is None:
        return None
    if has_position and isinstance(lat, int):
        lat = lat * (180 / 2**31)
    if has_position and isinstance(lng, int):
        lng = lng * (180 / 2**31)
    enhanced_altitude = fields.get("enhanced_altitude")
    altitude = (
        enhanced_altitude
        if isinstance(enhanced_altitude, (int, float))
        else fields.get("altitude")
    )
    return SourceRoutePoint(
        lat=float(lat) if has_position else None,
        lng=float(lng) if has_position else None,
        elevation=float(altitude) if isinstance(altitude, (int, float)) else None,
        timestamp=timestamp,
        segment_index=segment_index,
    )


def load_source_route_points(path: str | Path) -> list[SourceRoutePoint]:
    """Read source records without flattening away time or GPX segments."""
    source_path = Path(path)
    if source_path.suffix.lower() == ".gpx":
        with source_path.open() as source_file:
            gpx = gpxpy.parse(source_file)
        points: list[SourceRoutePoint] = []
        segment_index = 0
        for track in gpx.tracks:
            for segment in track.segments:
                points.extend(
                    SourceRoutePoint(
                        lat=point.latitude,
                        lng=point.longitude,
                        elevation=(
                            float(point.elevation)
                            if point.elevation is not None
                            else None
                        ),
                        timestamp=_recorded_timestamp(point.time),
                        segment_index=segment_index,
                    )
                    for point in segment.points
                )
                segment_index += 1
        return points

    if source_path.name.endswith(".fit.gz"):
        with gzip.open(source_path, "rb") as source_file:
            fit = FitFile(source_file)
            return _fit_source_points(fit)
    if source_path.suffix.lower() == ".fit":
        return _fit_source_points(FitFile(source_path))
    raise ValueError(f"Unsupported route source: {source_path.name}")


def _fit_source_points(fit: FitFile) -> list[SourceRoutePoint]:
    points: list[SourceRoutePoint] = []
    for message in fit.get_messages("record"):
        fields = {field.name: field.value for field in message}
        point = source_point_from_fit_fields(fields)
        if point is not None:
            points.append(point)
    return points


def _distance_m(start: SourceRoutePoint, end: SourceRoutePoint) -> float:
    if start.lat is None or start.lng is None or end.lat is None or end.lng is None:
        raise ValueError("Distance requires two recorded positions")
    radius_m = 6_371_000
    delta_lat = math.radians(end.lat - start.lat)
    delta_lng = math.radians(end.lng - start.lng)
    start_lat = math.radians(start.lat)
    end_lat = math.radians(end.lat)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(start_lat) * math.cos(end_lat) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * radius_m * math.asin(math.sqrt(value))


def _utc_iso(timestamp: datetime) -> str:
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    return timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _elapsed_seconds(start: datetime, end: datetime) -> int:
    if start.tzinfo is None:
        start = start.replace(tzinfo=UTC)
    if end.tzinfo is None:
        end = end.replace(tzinfo=UTC)
    return max(0, round((end - start).total_seconds()))


def build_route_provenance(
    points: list[SourceRoutePoint],
    *,
    sample_interval_m: float = 50,
    recording_gap_seconds: int = 120,
    missing_position_gap_seconds: int = 30,
) -> RouteProvenanceResult:
    """Build sampled geometry without inferring evidence from sampled point spacing."""
    if not points:
        return RouteProvenanceResult(
            route=[],
            temporal={"status": "unavailable"},
            elevation={"status": "unavailable"},
            track={"segment_count": 0},
            discontinuities=[],
        )

    timestamps = [point.timestamp for point in points if point.timestamp is not None]
    start_time = timestamps[0] if timestamps else None
    end_time = timestamps[-1] if timestamps else None
    temporal: dict[str, object] = {"status": "unavailable"}
    if start_time is not None and end_time is not None:
        temporal = {
            "status": "recorded",
            "start_time_utc": _utc_iso(start_time),
            "elapsed_time_s": _elapsed_seconds(start_time, end_time),
        }
    positioned_elevations = [
        point.elevation
        for point in points
        if point.lat is not None and point.lng is not None
    ]
    elevation = {
        "status": "recorded"
        if positioned_elevations and all(value is not None for value in positioned_elevations)
        else "unavailable"
    }

    positioned = [
        (source_index, point)
        for source_index, point in enumerate(points)
        if point.lat is not None and point.lng is not None
    ]
    if not positioned:
        return RouteProvenanceResult(
            route=[],
            temporal=temporal,
            elevation=elevation,
            track={"segment_count": len({point.segment_index for point in points})},
            discontinuities=[],
        )

    route: list[dict[str, float | None]] = []
    source_distances = [0.0]
    cumulative_m = 0.0
    positioned_points = [point for _, point in positioned]
    for previous, current in zip(positioned_points, positioned_points[1:]):
        cumulative_m += _distance_m(previous, current)
        source_distances.append(cumulative_m)

    last_sampled_distance = -math.inf
    for index, point in enumerate(positioned_points):
        distance = source_distances[index]
        is_endpoint = index == 0 or index == len(positioned_points) - 1
        if not is_endpoint and distance - last_sampled_distance < sample_interval_m:
            continue
        route_point: dict[str, float | None] = {
            "lat": float(point.lat),
            "lng": float(point.lng),
            "elev": point.elevation if elevation["status"] == "recorded" else None,
            "d": distance,
        }
        if start_time is not None and point.timestamp is not None:
            route_point["elapsed_s"] = _elapsed_seconds(start_time, point.timestamp)
        route.append(route_point)
        last_sampled_distance = distance

    discontinuities: list[dict[str, object]] = []
    for index, ((previous_source_index, previous), (current_source_index, current)) in enumerate(
        zip(positioned, positioned[1:])
    ):
        elapsed = (
            _elapsed_seconds(previous.timestamp, current.timestamp)
            if previous.timestamp is not None and current.timestamp is not None
            else None
        )
        evidence: dict[str, object] | None = None
        missing_record_count = current_source_index - previous_source_index - 1
        if current.segment_index != previous.segment_index:
            evidence = {
                "kind": "segment_boundary",
                "source": "recorded_track_segment",
            }
        elif missing_record_count >= 2 or (
            missing_record_count > 0
            and elapsed is not None
            and elapsed >= missing_position_gap_seconds
        ):
            evidence = {
                "kind": "missing_position_records",
                "source": "recorded_position_absence",
                "missing_record_count": missing_record_count,
            }
        elif elapsed is not None and elapsed >= recording_gap_seconds:
            evidence = {
                "kind": "recording_gap",
                "source": "recorded_timestamps",
            }
        if evidence is None:
            continue
        evidence.update(
            {
                "start_d": source_distances[index],
                "end_d": source_distances[index + 1],
            }
        )
        if elapsed is not None:
            evidence["elapsed_time_s"] = elapsed
        discontinuities.append(evidence)

    segment_count = len({point.segment_index for point in points})
    return RouteProvenanceResult(
        route=route,
        temporal=temporal,
        elevation=elevation,
        track={"segment_count": segment_count},
        discontinuities=discontinuities,
    )
