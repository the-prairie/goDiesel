"""Quest metadata helpers for the static goDiesel build."""


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
    difficulty = _difficulty(activity_type, distance_km, elevation_gain)
    theme = _theme(activity_type, distance_km, elevation_gain, region_label, activity_name)
    verb = "ride" if activity_type == "Ride" else "run"
    xp = _round_to_10(
        (120 if activity_type == "Ride" else 50)
        + distance_km * (7 if activity_type == "Ride" else 8)
        + elevation_gain * (0.43 if activity_type == "Ride" else 0.25)
    )
    climbing = f"{elevation_gain:,} m of climbing"

    return {
        "difficulty": difficulty,
        "theme": theme,
        "xp": xp,
        "elevation_gain_m": int(elevation_gain),
        "completion_rule": (
            f"Complete a {distance_km:.1f} km {verb} in {region_label} "
            f"with about {climbing}."
        ),
        "quest_blurb": (
            f"A {difficulty.lower()} {theme.lower()} quest built from Lauren's "
            f"{activity_name or region_label} route."
        ),
    }
