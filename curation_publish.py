"""Incremental publication of one route's curation.

A curation edit changes no geometry, so nothing here re-reads a GPX or FIT file,
re-geocodes, or re-renders route art. Only the two tracked artifact tiers that
carry curation are rewritten, and the result must equal what a full `build.py`
run would produce. `test_curation_publish.py` asserts that equality.

The full generator remains the only writer of geometry (ADR-0003). This module
is a narrow, provable exception for the one field the curator edits.
"""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

from godiesel_evidence import (
    read_local_bytes,
    replace_local_file,
    unlink_local_file,
    write_local_bytes_atomic,
    write_local_text_atomic,
)

from quest_meta import build_route_curation, route_guide_preview
from route_annotations import build_route_annotations


class CurationPublishError(RuntimeError):
    """A generated artifact could not be patched for this route."""


class CurationRecoveryError(CurationPublishError):
    """Publication failed and at least one prior artifact needs recovery."""

    def __init__(self, message, *, recovery_paths=()):
        super().__init__(message)
        self.recovery_paths = tuple(Path(path) for path in recovery_paths)


def generated_paths(checkout_root):
    """The tracked artifacts that carry curation, in write order."""
    root = Path(checkout_root).absolute()
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
    try:
        detail = _read_generated_json(checkout_root, detail_path)
    except (FileNotFoundError, NotADirectoryError):
        raise CurationPublishError(
            f"route {activity_id} has no generated record; run a full rebuild first"
        ) from None
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
    manifest = _read_generated_json(checkout_root, paths["manifest"])
    manifest["generated_at"] = generated_at
    staged.append((paths["manifest"], json.dumps(manifest, ensure_ascii=False)))

    _publish_staged_with_rollback(checkout_root, staged)
    return normalized


def publish_curation(checkout_root, activity_id, curation, *, postcondition=None):
    """Rewrite the generated artifacts for one route's curation.

    Every file is staged before any file is replaced, and each replacement is
    atomic. The pair is not a transaction: a process crash between replacements
    can temporarily split the detail and manifest until curation is republished
    for that route or a full rebuild runs.
    """
    activity_id = str(activity_id)
    normalized = build_route_curation(curation or {})
    preview = route_guide_preview(normalized)
    paths = generated_paths(checkout_root)

    detail_path = paths["detail"] / f"{activity_id}.json"
    try:
        detail = _read_generated_json(checkout_root, detail_path)
    except (FileNotFoundError, NotADirectoryError):
        raise CurationPublishError(
            f"route {activity_id} has no generated record; run a full rebuild first"
        ) from None

    staged = []

    staged.append(
        (detail_path, json.dumps(_with_curation(detail, normalized), ensure_ascii=False))
    )

    # A rebuild stamps both tiers with one timestamp. Match that here.
    generated_at = _now()

    manifest = _read_generated_json(checkout_root, paths["manifest"])
    manifest["generated_at"] = generated_at
    _replace_route(
        manifest.get("routes", []),
        activity_id,
        lambda route: route.__setitem__("guide_preview", preview),
        "routes.manifest.json",
    )
    staged.append((paths["manifest"], json.dumps(manifest, ensure_ascii=False)))

    _publish_staged_with_rollback(
        checkout_root,
        staged,
        postcondition=postcondition,
    )
    return normalized


def _now():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_generated_json(checkout_root, path):
    root = Path(checkout_root).absolute()
    relative_directory = path.parent.relative_to(root)
    return json.loads(
        read_local_bytes(root, relative_directory, path.name).decode("utf-8")
    )


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


def _publish_staged_with_rollback(checkout_root, staged, *, postcondition=None):
    """Stage every file and roll back completed replacements on failure.

    Replacement is the only step that mutates a published artifact, and each
    replace is atomic. Staging first keeps the failure window to the replace
    loop rather than the much longer serialize-and-write step.
    """
    root = Path(checkout_root).absolute()
    temporaries = []
    try:
        for path, content in staged:
            relative_directory = path.parent.relative_to(root)
            temporary_name = f".{path.name}.{uuid.uuid4().hex}.tmp"
            temporaries.append((relative_directory, temporary_name, path))
            write_local_text_atomic(
                root,
                relative_directory,
                temporary_name,
                content,
            )
    except Exception:
        _cleanup_files(root, [(directory, name) for directory, name, _ in temporaries])
        raise

    backups = []
    replaced = []
    preserved_backups = set()
    try:
        for relative_directory, _, path in temporaries:
            backup_name = f".{path.name}.{uuid.uuid4().hex}.rollback"
            backups.append((relative_directory, backup_name, path))
            write_local_bytes_atomic(
                root,
                relative_directory,
                backup_name,
                read_local_bytes(root, relative_directory, path.name),
            )

        for relative_directory, temporary_name, path in temporaries:
            replace_local_file(root, relative_directory, temporary_name, path.name)
            replaced.append(path)
        if postcondition is not None:
            postcondition()
    except Exception as publication_error:
        rollback_failures = []
        for relative_directory, backup_name, path in reversed(backups):
            if path not in replaced:
                continue
            try:
                replace_local_file(root, relative_directory, backup_name, path.name)
            except Exception as error:
                backup = root / relative_directory / backup_name
                rollback_failures.append((backup, path, error))
                preserved_backups.add((relative_directory, backup_name))
        if rollback_failures:
            failure_details = "; ".join(
                f"{path}: {error}" for _, path, error in rollback_failures
            )
            recovery_paths = ", ".join(
                str(backup) for backup, _, _ in rollback_failures
            )
            raise CurationRecoveryError(
                f"generated publication failed: {publication_error}; "
                f"rollback failed: {failure_details}; "
                f"recovery copies: {recovery_paths}",
                recovery_paths=[backup for backup, _, _ in rollback_failures],
            ) from rollback_failures[0][2]
        raise
    finally:
        _cleanup_files(
            root,
            [(directory, name) for directory, name, _ in temporaries]
            + [
                (directory, name)
                for directory, name, _ in backups
                if (directory, name) not in preserved_backups
            ],
        )


def _cleanup_files(root, paths):
    """Remove every disposable file without changing publication outcome."""
    for directory, name in paths:
        try:
            unlink_local_file(root, directory, name, missing_ok=True)
        except Exception:
            # Cleanup cannot turn a committed publication into a reported
            # failure or hide the exception that triggered rollback.
            continue
