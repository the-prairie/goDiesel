"""Validated metadata for route files that are not recorded Strava activities."""

from dataclasses import dataclass
from datetime import date
from pathlib import Path


SUPPORTED_ACTIVITY_TYPES = frozenset(("Run", "Ride"))


@dataclass(frozen=True)
class ImportedRoute:
    path: Path
    name: str
    activity_type: str
    date: str
    description: str
    source_kind: str
    source_format: str


def imported_route_from_spec(spec: dict[str, object], checkout_root: Path) -> ImportedRoute | None:
    source_value = spec.get("source_gpx")
    if source_value is None:
        return None
    if not isinstance(source_value, str) or not source_value.strip():
        raise ValueError("source_gpx must be a non-empty relative path")

    source_root = (checkout_root / "route_sources").resolve()
    if Path(source_value).is_absolute():
        raise ValueError("source_gpx must be a relative path inside route_sources")
    source_path = (checkout_root / source_value).resolve()
    if not source_path.is_relative_to(source_root):
        raise ValueError("source_gpx must resolve inside route_sources")
    if source_path.suffix.lower() != ".gpx" or not source_path.is_file():
        raise ValueError(f"source_gpx does not identify a GPX file: {source_value}")

    name = _required_string(spec, "activity_name")
    activity_type = _required_string(spec, "activity_type")
    if activity_type not in SUPPORTED_ACTIVITY_TYPES:
        raise ValueError("activity_type must be Run or Ride")

    return ImportedRoute(
        path=source_path,
        name=name,
        activity_type=activity_type,
        date=_optional_iso_date(spec, "date"),
        description=_optional_string(spec, "description"),
        source_kind=route_source_kind(spec),
        source_format=route_source_format(spec),
    )


def _required_string(spec: dict[str, object], field: str) -> str:
    value = spec.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _optional_string(spec: dict[str, object], field: str) -> str:
    value = spec.get(field, "")
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value.strip()


def _optional_iso_date(spec: dict[str, object], field: str) -> str:
    value = _optional_string(spec, field)
    if not value:
        return ""
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{field} must use a valid YYYY-MM-DD date") from error
    if parsed.isoformat() != value:
        raise ValueError(f"{field} must use a valid YYYY-MM-DD date")
    return value


STRAVA_EXPORT = "strava-export"
IMPORTED_GPX = "imported-gpx"
OWNER_IMPORT = "owner-import"
SOURCE_KINDS = frozenset((STRAVA_EXPORT, IMPORTED_GPX, OWNER_IMPORT))
SOURCE_FORMATS = frozenset(("gpx", "kml", "kmz", "fit"))


def route_source_kind(spec: dict[str, object]) -> str:
    """Name where a route's geometry and metadata come from.

    A route with `source_gpx` was imported from a standalone file. Every other
    route comes from the Strava export. An explicit kind is accepted for
    canonical owner imports and validated against the presence of source_gpx.
    """
    explicit = spec.get("source_kind")
    derived = IMPORTED_GPX if spec.get("source_gpx") else STRAVA_EXPORT
    if explicit is not None:
        if explicit not in SOURCE_KINDS:
            raise ValueError(f"source_kind must be one of: {', '.join(sorted(SOURCE_KINDS))}")
        if derived == IMPORTED_GPX and explicit == STRAVA_EXPORT:
            raise ValueError("source_gpx cannot use source_kind strava-export")
        if derived == STRAVA_EXPORT and explicit != STRAVA_EXPORT:
            raise ValueError("owner import source_kind requires a canonical source file")
        return str(explicit)
    return derived


def route_source_format(spec: dict[str, object], source_path: Path | None = None) -> str:
    """Name the original source container independently from source ownership."""
    explicit = spec.get("source_format")
    if explicit is not None:
        if explicit not in SOURCE_FORMATS:
            raise ValueError(f"source_format must be one of: {', '.join(sorted(SOURCE_FORMATS))}")
        return str(explicit)
    path = source_path
    if path is None and isinstance(spec.get("source_gpx"), str):
        path = Path(str(spec["source_gpx"]))
    if path is not None:
        if path.name.endswith(".fit.gz"):
            return "fit"
        suffix = path.suffix.lower().lstrip(".")
        if suffix in SOURCE_FORMATS:
            return suffix
    return "gpx" if spec.get("source_gpx") else "fit"


def route_identity(spec: dict[str, object]) -> tuple[str, str | None, str]:
    """Return stable route id, optional Strava activity id, and identity kind."""
    route_id = spec.get("route_id")
    activity_id = spec.get("activity_id")
    if route_id is not None:
        if not isinstance(route_id, str) or not route_id.strip():
            raise ValueError("route_id must be a non-empty string")
        if activity_id is not None:
            raise ValueError("an imported route_id must not also claim a Strava activity_id")
        return route_id.strip(), None, "imported-route"
    if not isinstance(activity_id, str) or not activity_id.strip():
        raise ValueError("route must contain activity_id or route_id")
    return activity_id.strip(), activity_id.strip(), "strava-activity"


@dataclass(frozen=True)
class RouteMetadata:
    """Display metadata for a route, from whichever source owns it."""

    source_kind: str
    name: str
    activity_type: str
    date: str
    description: str
    source_path: Path | None
    source_format: str


def route_metadata(
    spec: dict[str, object],
    checkout_root: Path,
    activity_row: object = None,
) -> RouteMetadata | None:
    """Resolve metadata for one route.

    An imported route describes itself in `quests.json`. A Strava route
    describes itself in the export row. Returns None only when a Strava route
    has no row, which is the one case a caller cannot render.
    """
    imported = imported_route_from_spec(spec, checkout_root)
    if imported is not None:
        return RouteMetadata(
            source_kind=imported.source_kind,
            name=imported.name,
            activity_type=imported.activity_type,
            date=imported.date,
            description=imported.description,
            source_path=imported.path,
            source_format=imported.source_format,
        )

    if activity_row is None:
        return None

    return RouteMetadata(
        source_kind=STRAVA_EXPORT,
        name=_activity_name(activity_row),
        activity_type=_activity_text(activity_row, "Activity Type"),
        date=_activity_date(activity_row),
        description=_activity_text(activity_row, "Activity Description"),
        source_path=None,
        source_format=route_source_format(spec),
    )


def _activity_name(row: object) -> str:
    value = row.get("Activity Name")
    return value if isinstance(value, str) and value.strip() else "(unnamed)"


def _activity_text(row: object, field: str) -> str:
    value = row.get(field, "")
    if value is None:
        return ""
    text = str(value)
    return "" if not text or text == "nan" else text


def _activity_date(row: object) -> str:
    value = row.get("date")
    return value.strftime("%Y-%m-%d") if value is not None else ""
