"""Validated owner-curation writes for the local Admin service."""

import copy
import json
import os
from pathlib import Path

from curation_publish import CurationPublishError, CurationRecoveryError
from quest_meta import (
    CURATION_LIST_FIELDS,
    CURATION_TEXT_FIELDS,
    build_route_curation,
)

REQUIRED_CURATION_FIELDS = (*CURATION_TEXT_FIELDS, *CURATION_LIST_FIELDS)


class SourceRollbackError(RuntimeError):
    """Canonical curation source could not be restored after publication failed."""


def publish_curation_or_rebuild(publish, full_rebuild):
    """Use a full rebuild only when incremental publication is safely recoverable."""
    try:
        publish()
    except CurationRecoveryError:
        raise
    except CurationPublishError:
        full_rebuild()


def curation_readiness(value):
    """Describe whether a draft can be promoted to a reviewed guide."""
    try:
        normalized = build_route_curation(value or {})
    except ValueError as error:
        return {
            "status": "invalid",
            "complete": False,
            "missing_fields": [],
            "error": str(error),
        }

    missing = [field for field in REQUIRED_CURATION_FIELDS if field not in normalized]
    return {
        "status": normalized["review_status"],
        "complete": not missing,
        "missing_fields": missing,
        "error": None,
    }


def update_route_curation(config, activity_id, value):
    """Return a copied config with exactly one validated curation record changed."""
    normalized = build_route_curation(value)
    updated = copy.deepcopy(config)
    matching = [
        route for route in updated.get("routes", [])
        if str(route.get("activity_id")) == str(activity_id)
    ]
    if not matching:
        raise ValueError(f"route {activity_id} was not found")
    if len(matching) > 1:
        raise ValueError(f"route {activity_id} is duplicated")
    matching[0]["curation"] = normalized
    return updated


def save_curation_and_rebuild(config_path, activity_id, value, rebuild):
    """Persist one route, rebuild generated data, and roll back source on failure."""
    config_path = Path(config_path)
    recovery_path = config_path.with_name(f".{config_path.name}.rollback")
    original = config_path.read_text(encoding="utf-8")
    config = json.loads(original)
    updated = update_route_curation(config, activity_id, value)
    serialized = json.dumps(updated, indent=2) + "\n"

    write_atomic(recovery_path, original)
    try:
        write_atomic(config_path, serialized)
    except Exception:
        _unlink_best_effort(recovery_path)
        raise

    try:
        rebuild()
    except Exception as publication_error:
        try:
            os.replace(recovery_path, config_path)
        except Exception as rollback_error:
            raise SourceRollbackError(
                f"publication failed: {publication_error}; "
                f"source rollback failed: {rollback_error}; "
                f"recovery copy: {recovery_path}"
            ) from rollback_error
        raise
    else:
        _unlink_best_effort(recovery_path)

    route = next(
        route for route in updated["routes"]
        if str(route.get("activity_id")) == str(activity_id)
    )
    return route


def write_atomic(path, content):
    """Replace a text file without exposing a partially written destination."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def _unlink_best_effort(path):
    try:
        path.unlink(missing_ok=True)
    except Exception:
        return
