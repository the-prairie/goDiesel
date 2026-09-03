"""Validated metadata for route files that are not recorded Strava activities."""

from dataclasses import dataclass
from datetime import date, datetime
import csv
import hashlib
from pathlib import Path
import re


SUPPORTED_ACTIVITY_TYPES = frozenset(("Run", "Ride"))
DEFAULT_DIESEL_DIARIES_ROOT = Path("/Users/laurenzary/Desktop/DieselDiaries")
STRAVA_ACTIVITY_SUFFIXES = (".gpx", ".fit.gz", ".fit")


@dataclass(frozen=True)
class ImportedRoute:
    path: Path
    name: str
    activity_type: str
    date: str
    description: str
    source_sha256: str | None


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
    expected_sha256 = spec.get("source_sha256")
    if expected_sha256 is not None:
        if not isinstance(expected_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
            raise ValueError("source_sha256 must be a lowercase SHA-256 digest")
        try:
            actual_sha256 = hashlib.sha256(source_path.read_bytes()).hexdigest()
        except OSError as error:
            raise ValueError(
                f"source_gpx is unreadable: {error.__class__.__name__}"
            ) from error
        if actual_sha256 != expected_sha256:
            raise ValueError("source_gpx checksum does not match source_sha256")

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
        source_sha256=expected_sha256,
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
SOURCE_KINDS = frozenset((STRAVA_EXPORT, IMPORTED_GPX))


def route_source_kind(spec: dict[str, object]) -> str:
    """Name where a route's geometry and metadata come from.

    A route with `source_gpx` was imported from a standalone file. Every other
    route comes from the Strava export. The kind is derived, never stored, so it
    cannot drift away from the data it describes.
    """
    return IMPORTED_GPX if spec.get("source_gpx") else STRAVA_EXPORT


def find_strava_activity_file(
    activity_id: str,
    data_root: Path = DEFAULT_DIESEL_DIARIES_ROOT,
) -> Path | None:
    """Resolve the exact exported geometry file used by the route generator."""
    source_root = data_root / "strava_export" / "activities"
    for suffix in STRAVA_ACTIVITY_SUFFIXES:
        candidate = source_root / f"{activity_id}{suffix}"
        if candidate.is_file():
            return candidate
    return None


@dataclass(frozen=True)
class RouteMetadata:
    """Display metadata for a route, from whichever source owns it."""

    source_kind: str
    name: str
    activity_type: str
    date: str
    description: str
    source_path: Path | None


def load_strava_route_metadata(
    metadata_path: Path = DEFAULT_DIESEL_DIARIES_ROOT / "activities.csv",
) -> dict[str, RouteMetadata]:
    """Read the Strava export metadata used by generation and verification."""
    metadata: dict[str, RouteMetadata] = {}
    with metadata_path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            match = re.search(r"(?:^|/)(\d+)", row.get("Filename", ""))
            if not match:
                continue
            raw_date = row.get("Activity Date", "").rsplit(", ", 1)[0]
            parsed_date = None
            for date_format in ("%b %d, %Y", "%B %d, %Y"):
                try:
                    parsed_date = datetime.strptime(raw_date, date_format)
                    break
                except ValueError:
                    continue
            metadata[match.group(1)] = RouteMetadata(
                source_kind=STRAVA_EXPORT,
                name=row.get("Activity Name") or "(unnamed)",
                activity_type=row.get("Activity Type") or "",
                date=parsed_date.strftime("%Y-%m-%d") if parsed_date else "",
                description=row.get("Activity Description") or "",
                source_path=None,
            )
    return metadata


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
            source_kind=IMPORTED_GPX,
            name=imported.name,
            activity_type=imported.activity_type,
            date=imported.date,
            description=imported.description,
            source_path=imported.path,
        )

    if activity_row is None:
        return None

    if isinstance(activity_row, RouteMetadata):
        return activity_row

    return RouteMetadata(
        source_kind=STRAVA_EXPORT,
        name=_activity_name(activity_row),
        activity_type=_activity_text(activity_row, "Activity Type"),
        date=_activity_date(activity_row),
        description=_activity_text(activity_row, "Activity Description"),
        source_path=None,
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
