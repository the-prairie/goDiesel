"""Incremental publication of one route's curation.

A curation edit changes no geometry, so nothing here re-reads a GPX or FIT file,
re-geocodes, or re-renders route art. Only the three tracked artifacts that
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


class CurationPublishError(RuntimeError):
    """A generated artifact could not be patched for this route."""


def generated_paths(checkout_root):
    """The tracked artifacts that carry curation, in write order."""
    root = Path(checkout_root)
    return {
        "detail": root / "app" / "public" / "data" / "routes",
        "manifest": root / "app" / "src" / "data" / "generated" / "routes.manifest.json",
        "payload": root / "app" / "src" / "data" / "quests.generated.json",
    }


def publish_curation(checkout_root, activity_id, curation):
    """Rewrite the generated artifacts for one route's curation.

    Every file is staged before any file is replaced, so a failure part way
    through cannot leave the manifest describing a guide the detail record does
    not have.
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

    # A rebuild stamps both artifacts with one timestamp. Match that, so the
    # manifest and the payload never disagree about when they were generated.
    generated_at = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["generated_at"] = generated_at
    _replace_route(
        manifest.get("routes", []),
        activity_id,
        lambda route: route.__setitem__("guide_preview", preview),
        "routes.manifest.json",
    )
    staged.append((paths["manifest"], json.dumps(manifest, ensure_ascii=False)))

    payload = json.loads(paths["payload"].read_text(encoding="utf-8"))
    payload["generated_at"] = generated_at
    _replace_in_place(
        payload.get("routes", []),
        activity_id,
        lambda route: _with_curation(route, normalized),
        "quests.generated.json",
    )
    staged.append((paths["payload"], json.dumps(payload, ensure_ascii=False)))

    _write_all_atomic(staged)
    return normalized


def _with_curation(record, normalized):
    """Return the record with curation in the position a rebuild puts it.

    build.py sets curation on the quest dict after the derived quest metadata
    and before react_route_record appends lifecycle and replay, so the key lands
    immediately before `lifecycle`. Appending instead would still be valid JSON,
    but pipeline_verification.py byte-compares generated output against a fresh
    rebuild, so key order is part of the contract.
    """
    rebuilt = {}
    inserted = False
    for key, value in record.items():
        if key == "lifecycle" and not inserted:
            rebuilt["curation"] = normalized
            inserted = True
        if key != "curation":
            rebuilt[key] = value
    if not inserted:
        rebuilt["curation"] = normalized
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


def _replace_in_place(routes, activity_id, transform, artifact):
    """Swap one route for a transformed copy, keeping its position in the list."""
    indexes = [
        index
        for index, route in enumerate(routes)
        if str(route.get("slug")) == activity_id
    ]
    if not indexes:
        raise CurationPublishError(f"route {activity_id} is missing from {artifact}")
    if len(indexes) > 1:
        raise CurationPublishError(f"route {activity_id} is duplicated in {artifact}")
    routes[indexes[0]] = transform(routes[indexes[0]])


def _write_all_atomic(staged):
    """Stage every file, then replace every file.

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

    for temporary, path in temporaries:
        os.replace(temporary, path)
