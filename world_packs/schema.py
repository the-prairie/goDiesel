"""Strict JSON Schema validation for versioned World Pack documents."""

from __future__ import annotations

from datetime import datetime
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from .canonical import strict_json_load
from .errors import ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_ROOT = ROOT / "schemas/world-pack/v1"
FORMAT_CHECKER = FormatChecker()


@FORMAT_CHECKER.checks("date-time", raises=ValueError)
def _is_timezone_aware_datetime(value: object) -> bool:
    if not isinstance(value, str):
        return True
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.tzinfo is not None


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict[str, object]:
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise ValidationError(f"invalid schema name: {name!r}")
    path = SCHEMA_ROOT / f"{name}.schema.json"
    if not path.is_file():
        raise ValidationError(f"unknown World Pack schema: {name}")
    value = strict_json_load(path)
    if not isinstance(value, dict):
        raise ValidationError(f"schema {name} is not an object")
    Draft202012Validator.check_schema(value)
    return value


def validate_document(name: str, value: object) -> None:
    validator = Draft202012Validator(
        load_schema(name), format_checker=FORMAT_CHECKER
    )
    failures = sorted(
        validator.iter_errors(value),
        key=lambda failure: tuple(str(part) for part in failure.absolute_path),
    )
    if not failures:
        return
    details = []
    for failure in failures[:12]:
        location = "/".join(str(part) for part in failure.absolute_path) or "$"
        details.append(f"{location}: {failure.message}")
    if len(failures) > 12:
        details.append(f"... {len(failures) - 12} more validation errors")
    raise ValidationError(f"{name} failed validation: " + "; ".join(details))
