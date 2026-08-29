"""Incremental publication of one route's curation.

A curation edit changes no geometry, so nothing here re-reads a GPX or FIT file,
re-geocodes, or re-renders route art. Only the two tracked artifact tiers that
carry curation are rewritten, and the result must equal what a full `build.py`
run would produce. `test_curation_publish.py` asserts that equality.

The full generator remains the only writer of geometry (ADR-0003). This module
is a narrow, provable exception for the one field the curator edits.
"""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

from quest_meta import build_route_curation, route_guide_preview
from route_annotations import build_route_annotations


class CurationPublishError(RuntimeError):
    """A generated artifact could not be patched for this route."""


def generated_paths(checkout_root):
    """The tracked artifacts that carry curation, in write order."""
    root = Path(checkout_root)
    return {
        "detail": root / "app" / "public" / "data" / "routes",
        "manifest": root / "app" / "src" / "data" / "generated" / "routes.manifest.json",
    }


def publish_annotations(checkout_root, activity_id, annotations):
    """Rewrite the generated artifacts for one route's annotations.

    Annotations are editorial content anchored to the recorded trace. Like
    curation, they change no geometry, so the same narrow path applies. The
    anchor is validated against the route's own recorded distance, so an
    annotation can never be published off the end of the route.
    """
    activity_id = str(activity_id)
    paths = generated_paths(checkout_root)
    detail_path = paths["detail"] / f"{activity_id}.json"
    if not detail_path.is_file():
        raise CurationPublishError(
            f"route {activity_id} has no generated record; run a full rebuild first"
        )

    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    route = detail.get("route") or []
    if not route:
        raise CurationPublishError(f"route {activity_id} has no recorded geometry")
    normalized = build_route_annotations(annotations, route[-1]["d"])

    generated_at = _now()
    staged = [
        (
            detail_path,
            json.dumps(_with_annotations(detail, normalized), ensure_ascii=False),
        )
    ]

    # The manifest is the summary tier and carries no annotations (ADR-0004),
    # but its timestamp stays in step with the detail tier.
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["generated_at"] = generated_at
    staged.append((paths["manifest"], json.dumps(manifest, ensure_ascii=False)))

    _publish_staged_with_rollback(staged)
    return normalized


def publish_curation(checkout_root, activity_id, curation):
    """Rewrite the generated artifacts for one route's curation.

    Every file is staged before any file is replaced, and each replacement is
    atomic. The pair is not a transaction: a process crash between replacements
    can temporarily split the detail and manifest until the next publication or
    full rebuild.
    """
    activity_id = str(activity_id)
    normalized = build_route_curation(curation or {})
    preview = route_guide_preview(normalized)
    paths = generated_paths(checkout_root)

    detail_path = paths["detail"] / f"{activity_id}.json"
    if not detail_path.is_file():
        raise CurationPublishError(
            f"route {activity_id} has no generated record; run a full rebuild first"
        )

    staged = []

    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    staged.append(
        (detail_path, json.dumps(_with_curation(detail, normalized), ensure_ascii=False))
    )

    # A rebuild stamps both tiers with one timestamp. Match that here.
    generated_at = _now()

    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["generated_at"] = generated_at
    _replace_route(
        manifest.get("routes", []),
        activity_id,
        lambda route: route.__setitem__("guide_preview", preview),
        "routes.manifest.json",
    )
    staged.append((paths["manifest"], json.dumps(manifest, ensure_ascii=False)))

    _publish_staged_with_rollback(staged)
    return normalized


def _now():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _with_annotations(record, normalized):
    """Place annotations where a rebuild puts them: after curation, before lifecycle."""
    return _with_key_before(record, "annotations", normalized, "lifecycle")


def _with_curation(record, normalized):
    """Place curation where a rebuild puts it: immediately before lifecycle.

    build.py sets curation on the quest dict after the derived quest metadata
    and before react_route_record appends lifecycle and replay. Appending
    instead would still be valid JSON, but pipeline_verification.py
    byte-compares generated output against a fresh rebuild, so key order is
    part of the contract.
    """
    return _with_key_before(record, "curation", normalized, "lifecycle")


def _with_key_before(record, key, value, before):
    rebuilt = {}
    inserted = False
    for existing, existing_value in record.items():
        if existing == before and not inserted:
            rebuilt[key] = value
            inserted = True
        if existing != key:
            rebuilt[existing] = existing_value
    if not inserted:
        rebuilt[key] = value
    return rebuilt


def _replace_route(routes, activity_id, apply_change, artifact):
    matching = [
        route for route in routes if str(route.get("slug")) == activity_id
    ]
    if not matching:
        raise CurationPublishError(f"route {activity_id} is missing from {artifact}")
    if len(matching) > 1:
        raise CurationPublishError(f"route {activity_id} is duplicated in {artifact}")
    apply_change(matching[0])


def _publish_staged_with_rollback(staged):
    """Stage every file and roll back completed replacements on failure.

    Replacement is the only step that mutates a published artifact, and each
    replace is atomic. Staging first keeps the failure window to the replace
    loop rather than the much longer serialize-and-write step.
    """
    temporaries = []
    try:
        for path, content in staged:
            temporary = path.with_name(f".{path.name}.tmp")
            temporary.write_text(content, encoding="utf-8")
            temporaries.append((temporary, path))
    except Exception:
        for temporary, _ in temporaries:
            temporary.unlink(missing_ok=True)
        raise

    backups = []
    replaced = []
    try:
        for _, path in temporaries:
            backup = path.with_name(f".{path.name}.rollback")
            backup.write_bytes(path.read_bytes())
            backups.append((backup, path))

        for temporary, path in temporaries:
            os.replace(temporary, path)
            replaced.append(path)
    except Exception as publication_error:
        rollback_error = None
        for backup, path in reversed(backups):
            if path not in replaced:
                continue
            try:
                os.replace(backup, path)
            except Exception as error:
                rollback_error = error
        if rollback_error is not None:
            raise CurationPublishError(
                "generated publication failed and could not be fully rolled back"
            ) from publication_error
        raise
    finally:
        for temporary, _ in temporaries:
            temporary.unlink(missing_ok=True)
        for backup, _ in backups:
            backup.unlink(missing_ok=True)
