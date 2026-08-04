"""Validated metadata for route files that are not recorded Strava activities."""

from dataclasses import dataclass
from pathlib import Path


SUPPORTED_ACTIVITY_TYPES = frozenset(("Run", "Ride"))


@dataclass(frozen=True)
class ImportedRoute:
    path: Path
    name: str
    activity_type: str
    date: str
    description: str


def imported_route_from_spec(spec: dict[str, object], checkout_root: Path) -> ImportedRoute | None:
    source_value = spec.get("source_gpx")
    if source_value is None:
        return None
    if not isinstance(source_value, str) or not source_value.strip():
        raise ValueError("source_gpx must be a non-empty relative path")

    source_root = (checkout_root / "route_sources").resolve()
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
        date=_optional_string(spec, "date"),
        description=_optional_string(spec, "description"),
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
