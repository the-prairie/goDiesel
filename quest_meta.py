"""Route metadata helpers for generated goDiesel application data."""


CURATION_TEXT_FIELDS = (
    "vibe",
    "ideal_use",
    "difficulty",
    "seasonality",
    "editorial_note",
)
CURATION_LIST_FIELDS = ("terrain", "highlights", "caveats")
CURATION_REVIEW_STATUSES = ("draft", "reviewed", "published")
CURATION_FIELDS = frozenset((*CURATION_TEXT_FIELDS, *CURATION_LIST_FIELDS, "review_status"))


def build_route_curation(value):
    """Validate owner-authored route curation for generated route details."""
    if not isinstance(value, dict):
        raise ValueError("curation must be an object")

    unknown_fields = sorted(set(value) - CURATION_FIELDS)
    if unknown_fields:
        raise ValueError(f"curation has unknown fields: {', '.join(unknown_fields)}")

    status = value.get("review_status", "draft")
    if status not in CURATION_REVIEW_STATUSES:
        raise ValueError("curation review_status must be draft, reviewed, or published")

    curation = {}
    for field in CURATION_TEXT_FIELDS:
        field_value = value.get(field)
        if field_value is None or field_value == "":
            continue
        if not isinstance(field_value, str) or not field_value.strip():
            raise ValueError(f"curation {field} must be a non-empty string")
        curation[field] = field_value.strip()

    for field in CURATION_LIST_FIELDS:
        field_value = value.get(field)
        if field_value is None or field_value == []:
            continue
        if (
            not isinstance(field_value, list)
            or not field_value
            or any(not isinstance(item, str) or not item.strip() for item in field_value)
        ):
            raise ValueError(f"curation {field} must be a list of non-empty strings")
        curation[field] = [item.strip() for item in field_value]

    if status != "draft":
        for field in (*CURATION_TEXT_FIELDS, *CURATION_LIST_FIELDS):
            if field not in curation:
                raise ValueError(f"{status} curation is missing {field}")

    curation["review_status"] = status
    return curation


def build_replay_metadata(
    activity_id,
    point_count,
    best_in_earth_ids,
    lifecycle="completed",
    preferred_mode=None,
):
    """Build replay metadata without contradicting validated route geometry."""
    if not isinstance(point_count, int) or point_count < 0:
        raise ValueError("replay point_count must be a non-negative integer")
    if lifecycle not in ("completed", "planned", "discovered"):
        raise ValueError("replay lifecycle must be completed, planned, or discovered")
    if preferred_mode not in (None, "atlas", "earth"):
        raise ValueError("replay preferred mode must be atlas or earth")

    geometry_ready = point_count > 1
    replay_eligible = geometry_ready and lifecycle in ("completed", "discovered")
    best_in_earth = replay_eligible and str(activity_id) in best_in_earth_ids
    return {
        "mode": preferred_mode or ("earth" if best_in_earth else "atlas"),
        "replay_eligible": replay_eligible,
        "best_in_earth": best_in_earth,
        "geometry_status": "ready" if geometry_ready else "missing",
        "point_count": point_count,
    }


def elevation_gain_m(route):
    """Return positive elevation gain in meters for a route."""
    gain = 0
    previous = None
    for point in route:
        elev = point.get("elev") if isinstance(point, dict) else point[2]
        if elev is None:
            continue
        elev = float(elev)
        if previous is not None and elev > previous:
            gain += elev - previous
        previous = elev
    return int(round(gain))


def _round_to_10(value):
    return int(round(value / 10.0) * 10)


def _difficulty(activity_type, distance_km, elevation_gain):
    if activity_type == "Ride":
        if distance_km >= 75 or elevation_gain >= 1000:
            return "Epic"
        if distance_km >= 35 or elevation_gain >= 450:
            return "Moderate"
        return "Easy"

    if distance_km >= 18 or elevation_gain >= 650:
        return "Epic"
    if distance_km >= 8 or elevation_gain >= 200:
        return "Moderate"
    return "Easy"


def _theme(activity_type, distance_km, elevation_gain, region_label, activity_name):
    text = f"{region_label} {activity_name}".lower()
    if distance_km >= 20 or elevation_gain >= 900:
        return "Big Day"
    if any(word in text for word in ("banff", "kananaskis", "highwood", "crete", "bali", "islands")):
        return "Trail Myth"
    if activity_type == "Ride":
        return "Scenic Spin"
    if any(word in text for word in ("tokyo", "kyoto", "madrid", "city", "crosswalk")):
        return "Local Spark"
    return "Wander Run"


def build_quest_meta(activity_type, distance_km, elevation_gain, region_label, activity_name):
    recorded_elevation = elevation_gain is not None
    scoring_elevation = elevation_gain if recorded_elevation else 0
    difficulty = _difficulty(activity_type, distance_km, scoring_elevation)
    theme = _theme(activity_type, distance_km, scoring_elevation, region_label, activity_name)
    verb = "ride" if activity_type == "Ride" else "run"
    xp = _round_to_10(
        (120 if activity_type == "Ride" else 50)
        + distance_km * (7 if activity_type == "Ride" else 8)
        + scoring_elevation * (0.43 if activity_type == "Ride" else 0.25)
    )
    completion_rule = f"Complete a {distance_km:.1f} km {verb} in {region_label}."
    if recorded_elevation:
        completion_rule = (
            f"Complete a {distance_km:.1f} km {verb} in {region_label} "
            f"with about {elevation_gain:,} m of climbing."
        )

    return {
        "difficulty": difficulty,
        "theme": theme,
        "xp": xp,
        "elevation_gain_m": int(elevation_gain) if recorded_elevation else None,
        "completion_rule": completion_rule,
    }


def route_guide_preview(curation):
    """Reduce a curation record to the summary tier's guide preview.

    ADR-0004 keeps the manifest lightweight, so the summary carries only the
    review status and the vibe. This is the single definition, shared by the
    full generator and the incremental curation publisher, so the two cannot
    disagree about what a saved guide looks like.
    """
    curation = curation or {}
    preview = {"review_status": curation.get("review_status", "draft")}
    if curation.get("vibe"):
        preview["vibe"] = curation["vibe"]
    return preview


def simplify_route_for_manifest(points, max_points=96):
    """Project full route geometry into the deterministic summary trace."""
    if len(points) <= max_points:
        simplified = points
    else:
        last = len(points) - 1
        indices = [round(index * last / (max_points - 1)) for index in range(max_points)]
        simplified = [points[index] for index in indices]
    return [
        [point["lat"], point["lng"], point.get("elev"), point.get("d", 0)]
        for point in simplified
    ]


def route_manifest_record(record):
    """Return the exact public summary projection for one generated detail record."""
    return {
        "slug": record["slug"],
        "activity_id": record["activity_id"],
        "source_kind": record.get("source_kind", "strava-export"),
        "lifecycle": record["lifecycle"],
        "name": record["name"],
        "subtitle": record["subtitle"],
        "activity_name": record["activity_name"],
        "region": record["region"],
        "date": record["date"],
        "distance_km": record["distance_km"],
        "elevation_gain_m": record["elevation_gain_m"],
        "elevation_status": record["elevation_status"],
        "type": record["type"],
        "description": record["description"],
        "completion_rule": record["completion_rule"],
        "difficulty": record["difficulty"],
        "theme": record["theme"],
        "xp": record["xp"],
        "center_lat": record["center_lat"],
        "center_lng": record["center_lng"],
        "trace": simplify_route_for_manifest(record.get("route", [])),
        "replay": record["replay"],
        "guide_preview": route_guide_preview(record.get("curation")),
    }
