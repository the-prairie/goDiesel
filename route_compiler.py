"""Pure one-route compilation shared by canonical generation and Route Studio."""

from dataclasses import dataclass

from quest_meta import (
    build_quest_meta,
    build_replay_metadata,
    build_route_curation,
    elevation_gain_m,
)
from route_annotations import build_route_annotations
from route_provenance import SourceRoutePoint, build_route_provenance
from route_timezones import route_time_zone


@dataclass(frozen=True)
class RouteCompilationInput:
    route_id: str
    activity_id: str | None
    identity_kind: str
    source_kind: str
    source_format: str
    activity_name: str
    activity_type: str
    date: str
    description: str
    region: str
    lifecycle: str
    source_points: tuple[SourceRoutePoint, ...]
    spec: dict[str, object]
    elevation_status: str = "recorded"


def compile_route_contract(value, *, best_in_earth_ids=frozenset()):
    if value.identity_kind not in ("strava-activity", "imported-route"):
        raise ValueError("identity_kind must be strava-activity or imported-route")
    if value.lifecycle not in ("completed", "planned", "discovered"):
        raise ValueError("lifecycle must be completed, planned, or discovered")
    if value.elevation_status not in ("recorded", "unavailable"):
        raise ValueError("elevation_status must be recorded or unavailable")
    provenance = build_route_provenance(list(value.source_points))
    route = provenance.route
    if len(route) < 2:
        raise ValueError("route source must compile to at least two route points")
    distance_km = route[-1]["d"] / 1000
    elevation_gain = elevation_gain_m(route) if value.elevation_status == "recorded" else 0
    temporal = dict(provenance.temporal)
    time_zone = route_time_zone(value.region)
    if temporal.get("status") == "recorded" and time_zone:
        temporal["time_zone"] = time_zone
    route_meta = build_quest_meta(
        value.activity_type,
        round(distance_km, 1),
        elevation_gain,
        value.region,
        value.activity_name,
    )
    if value.elevation_status == "unavailable":
        verb = "ride" if value.activity_type == "Ride" else "run"
        route_meta["completion_rule"] = (
            f"Complete a {distance_km:.1f} km {verb} in {value.region}. "
            "Elevation is unavailable in the source."
        )
    for field, target in (
        ("theme", "theme"),
        ("difficulty", "difficulty"),
        ("completion_rule", "completion_rule"),
        ("blurb", "quest_blurb"),
    ):
        if value.spec.get(field):
            route_meta[target] = str(value.spec[field]).strip()
    lats = [point["lat"] for point in route]
    lngs = [point["lng"] for point in route]
    result = {
        "slug": value.route_id,
        "route_id": value.route_id,
        "identity_kind": value.identity_kind,
        "source_kind": value.source_kind,
        "source_format": value.source_format,
        "name": value.region,
        "subtitle": str(value.spec.get("title") or value.activity_name).strip(),
        "activity_name": value.activity_name,
        "region": value.region,
        "date": value.date,
        "distance_km": round(distance_km, 1),
        "elevation_gain_m": elevation_gain,
        "type": value.activity_type,
        "description": value.description,
        "route": route,
        "provenance": {
            "temporal": temporal,
            "elevation": {"status": value.elevation_status},
            "track": provenance.track,
            "discontinuities": provenance.discontinuities,
        },
        "center_lat": (min(lats) + max(lats)) / 2,
        "center_lng": (min(lngs) + max(lngs)) / 2,
        "mid_idx": len(route) // 2,
        "lifecycle": value.lifecycle,
        **route_meta,
    }
    if value.activity_id is not None:
        result["activity_id"] = value.activity_id
    if value.spec.get("curation") is not None:
        result["curation"] = build_route_curation(value.spec["curation"])
    if value.spec.get("annotations") is not None:
        result["annotations"] = build_route_annotations(
            value.spec["annotations"], route[-1]["d"]
        )
    result["replay"] = build_replay_metadata(
        value.route_id,
        len(route),
        best_in_earth_ids,
        value.lifecycle,
    )
    return result
