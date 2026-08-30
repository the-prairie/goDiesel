"""Deterministic plan/apply workflow for route share creation."""

from __future__ import annotations

import copy
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

import gpxpy
from jsonschema import Draft202012Validator

from quest_meta import build_route_curation
from route_annotations import build_route_annotations
from route_media import publish_photo, read_photo_metadata, read_video_metadata
from route_provenance import build_route_provenance, load_source_route_points


SCHEMA_VERSION = 1
SAFE_SLUG = re.compile(r"^[A-Za-z0-9._-]+$")
IMPORTED_SLUG = re.compile(r"^gpx-[a-z0-9][a-z0-9-]{2,59}[a-z0-9]$")
IMAGE_EXTENSIONS = frozenset((".heic", ".heif", ".jpeg", ".jpg", ".png", ".webp"))
VIDEO_EXTENSIONS = frozenset((".mov", ".mp4", ".m4v"))
REQUEST_FIELDS = frozenset(
    (
        "schema_version",
        "existing_slug",
        "gpx_path",
        "activity_type",
        "route_name",
        "region",
        "source_description",
        "activity_date",
        "desired_route_id",
        "lifecycle",
        "completion_evidence",
        "curation",
        "annotations",
        "media",
        "replay_mode",
        "proposed_share_name",
    )
)


class RouteCreateError(ValueError):
    """A stable, machine-readable route creation failure."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

    def as_report(self) -> dict[str, object]:
        return {"ok": False, "error": {"code": self.code, "message": str(self)}}


def _schema(root: Path) -> dict[str, object]:
    path = root / "route_create.schema.json"
    if not path.is_file():
        path = Path(__file__).with_name("route_create.schema.json")
    return json.loads(path.read_text(encoding="utf-8"))


def _definition_validator(root: Path, definition: str) -> Draft202012Validator:
    schema = _schema(root)
    return Draft202012Validator(
        {
            "$schema": schema["$schema"],
            "$defs": schema["$defs"],
            "$ref": f"#/$defs/{definition}",
        }
    )


def _validate_request(request: object, root: Path) -> dict[str, object]:
    if not isinstance(request, dict):
        raise RouteCreateError("request.invalid", "request must be a JSON object")
    unknown = sorted(set(request) - REQUEST_FIELDS)
    if unknown:
        raise RouteCreateError(
            "request.unknown_field",
            f"request has unknown fields: {', '.join(unknown)}",
        )
    errors = sorted(
        _definition_validator(root, "request").iter_errors(request),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        error = errors[0]
        if error.validator == "enum" and list(error.absolute_path) == ["activity_type"]:
            code = "request.invalid_activity_type"
        else:
            code = "request.schema"
        location = ".".join(str(part) for part in error.absolute_path)
        prefix = f"{location}: " if location else ""
        raise RouteCreateError(code, prefix + error.message)
    return copy.deepcopy(request)


def _validate_proposal(proposal: object, root: Path) -> dict[str, object]:
    if not isinstance(proposal, dict):
        raise RouteCreateError("proposal.invalid", "proposal must be a JSON object")
    errors = sorted(
        _definition_validator(root, "proposal").iter_errors(proposal),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path)
        prefix = f"{location}: " if location else ""
        raise RouteCreateError("proposal.schema", prefix + error.message)
    return copy.deepcopy(proposal)


def _load_config(root: Path) -> dict[str, object]:
    try:
        config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RouteCreateError("repository.invalid_routes", f"quests.json is unavailable: {error}") from error
    if not isinstance(config, dict) or not isinstance(config.get("routes"), list):
        raise RouteCreateError("repository.invalid_routes", "quests.json must contain a routes list")
    return config


def _route_by_slug(config: dict[str, object], slug: str) -> dict[str, object] | None:
    matches = [
        route
        for route in config["routes"]
        if isinstance(route, dict) and str(route.get("activity_id")) == slug
    ]
    if len(matches) > 1:
        raise RouteCreateError("route.identity_conflict", f"route {slug} is duplicated")
    return matches[0] if matches else None


def _canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_local_file(raw_path: object, *, extensions: frozenset[str], label: str) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise RouteCreateError(f"request.missing_{label}", f"{label} path must identify a file")
    candidate = Path(raw_path).expanduser()
    # macOS exposes /var as a system symlink, so rejecting every symlinked
    # ancestor would reject ordinary temporary files. The supplied file itself
    # must be a regular, directly addressed source rather than an indirection.
    if candidate.is_symlink():
        raise RouteCreateError("request.unsafe_path", f"{label} path must not traverse a symbolic link")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise RouteCreateError(f"request.missing_{label}", f"{label} path is not readable") from error
    if resolved.suffix.lower() not in extensions or not resolved.is_file():
        raise RouteCreateError(f"request.invalid_{label}", f"{label} path has an unsupported file type")
    return resolved


def _safe_source_path(raw_path: object) -> Path:
    return _safe_local_file(raw_path, extensions=frozenset((".gpx",)), label="source")


def _activity_date(value: object) -> str:
    if value in (None, ""):
        return ""
    if not isinstance(value, str):
        raise RouteCreateError("request.invalid_date", "activity_date must use YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise RouteCreateError("request.invalid_date", "activity_date must use a valid YYYY-MM-DD date") from error
    if parsed.isoformat() != value:
        raise RouteCreateError("request.invalid_date", "activity_date must use a valid YYYY-MM-DD date")
    return value


def _curation(value: object) -> dict[str, object]:
    try:
        normalized = build_route_curation(value or {})
    except ValueError as error:
        raise RouteCreateError("request.invalid_curation", str(error)) from error
    return normalized


def _inspect_gpx(path: Path) -> tuple[dict[str, object], float]:
    try:
        points = load_source_route_points(path)
        parsed = build_route_provenance(points)
        with path.open(encoding="utf-8") as source:
            gpx = gpxpy.parse(source)
    except Exception as error:
        raise RouteCreateError("source.invalid_gpx", f"GPX could not be parsed: {error}") from error
    if len(parsed.route) < 2 or parsed.route[-1]["d"] <= 0:
        raise RouteCreateError("source.empty_geometry", "GPX must contain at least two distinct route points")
    source_points = [
        point
        for track in gpx.tracks
        for segment in track.segments
        for point in segment.points
    ]
    recorded_elevations = [point.elevation for point in source_points if point.elevation is not None]
    observations: dict[str, object] = {
        "distance_m": round(parsed.route[-1]["d"], 3),
        "temporal": {
            "status": "recorded"
            if any(point.time is not None for point in source_points)
            else "unavailable"
        },
        "elevation": (
            {
                "status": "recorded",
                "minimum_m": min(recorded_elevations),
                "maximum_m": max(recorded_elevations),
            }
            if recorded_elevations
            else {"status": "unavailable"}
        ),
    }
    return observations, parsed.route[-1]["d"]


def _stage_file(
    source: Path,
    root: Path,
    staged_name: str,
    expected_sha256: str,
) -> str:
    staging = root / ".route-share" / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    destination = staging / staged_name
    if destination.exists():
        if _file_sha256(destination) != expected_sha256:
            raise RouteCreateError("source.staging_conflict", "staged GPX checksum does not match")
        return destination.relative_to(root).as_posix()
    temporary = destination.with_suffix(".gpx.tmp")
    shutil.copyfile(source, temporary)
    if _file_sha256(temporary) != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise RouteCreateError("source.checksum_mismatch", "staged GPX checksum does not match")
    os.replace(temporary, destination)
    return destination.relative_to(root).as_posix()


def _stage_source(source: Path, root: Path, proposal_id: str, expected_sha256: str) -> str:
    return _stage_file(source, root, f"{proposal_id}.gpx", expected_sha256)


def _json_capture_metadata(value: dict[str, object]) -> dict[str, object]:
    return {
        key: (
            item.isoformat().replace("+00:00", "Z")
            if hasattr(item, "isoformat")
            else list(item)
            if isinstance(item, tuple)
            else item
        )
        for key, item in value.items()
    }


def _stage_media(
    media_requests: object,
    root: Path,
    proposal_id: str,
    annotation_ids: set[str],
) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    staged_media = []
    warnings = []
    for index, item in enumerate(media_requests or []):
        association = item["association"]
        annotation_id = association.get("annotation_id")
        if association["kind"] == "annotation" and annotation_id not in annotation_ids:
            raise RouteCreateError(
                "request.media_association_missing",
                f"media {index} references unknown annotation {annotation_id}",
            )
        extensions = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
        source = _safe_local_file(item["path"], extensions=extensions, label="media")
        media_type = "image" if source.suffix.lower() in IMAGE_EXTENSIONS else "video"
        if media_type == "video" and association["kind"] == "annotation":
            raise RouteCreateError(
                "request.video_annotation_unsupported",
                "video may be associated with the route; select a still before attaching it to an annotation",
            )
        digest = _file_sha256(source)
        staged_path = _stage_file(
            source,
            root,
            f"{proposal_id}-media-{index}{source.suffix.lower()}",
            digest,
        )
        try:
            metadata = (
                read_photo_metadata(source)
                if media_type == "image"
                else read_video_metadata(source)
            )
            capture_metadata = _json_capture_metadata(metadata)
        except Exception:
            capture_metadata = {"status": "unavailable"}
            warnings.append(
                {
                    "code": "media.capture_metadata_unavailable",
                    "message": f"Capture metadata is unavailable for {source.name}.",
                }
            )
        staged_media.append(
            {
                "filename": source.name,
                "kind": media_type,
                "sha256": digest,
                "staged_path": staged_path,
                "association": copy.deepcopy(association),
                "capture_metadata": capture_metadata,
            }
        )
    return staged_media, warnings


def _validate_lifecycle(request: dict[str, object]) -> tuple[str, dict[str, object] | None]:
    lifecycle = str(request.get("lifecycle") or "discovered")
    evidence = request.get("completion_evidence")
    if lifecycle == "completed" and (
        not isinstance(evidence, dict) or evidence.get("kind") != "owner_recorded"
    ):
        raise RouteCreateError(
            "request.lifecycle_contradiction",
            "completed lifecycle requires owner-recorded completion evidence",
        )
    if lifecycle == "discovered" and evidence is not None:
        raise RouteCreateError(
            "request.lifecycle_contradiction",
            "owner-recorded completion evidence conflicts with discovered lifecycle",
        )
    return lifecycle, copy.deepcopy(evidence) if isinstance(evidence, dict) else None


def propose_request(request: object, root: str | Path) -> dict[str, object]:
    """Normalize one request into a redacted, reviewable proposal."""
    root = Path(root).resolve()
    request = _validate_request(request, root)
    config = _load_config(root)

    if request.get("existing_slug"):
        slug = str(request["existing_slug"])
        existing = _route_by_slug(config, slug)
        if existing is None:
            raise RouteCreateError("route.not_found", f"existing route {slug} was not found")
        route_spec = copy.deepcopy(existing)
        if "curation" in request:
            route_spec["curation"] = _curation(request["curation"])
        if "annotations" in request:
            route_spec["annotations"] = copy.deepcopy(request["annotations"])
        if "replay_mode" in request:
            route_spec["replay_mode"] = request["replay_mode"]
        proposal_id = uuid.uuid4().hex
        staged_media, media_warnings = _stage_media(
            request.get("media", []),
            root,
            proposal_id,
            {str(item.get("id")) for item in route_spec.get("annotations", [])},
        )
        proposal_core = {
            "schema_version": SCHEMA_VERSION,
            "document_type": "route-share-proposal",
            "operation": "update",
            "source": {"mode": "existing-route", "existing_slug": slug},
            "base_route_sha256": _canonical_sha256(existing),
            "route_spec": route_spec,
            "observations": {},
            "media": staged_media,
            "proposed_share_name": request.get("proposed_share_name"),
            "warnings": media_warnings,
            "blocking_errors": [],
        }
        proposal_core["proposal_id"] = proposal_id
        return proposal_core

    source = _safe_source_path(request.get("gpx_path"))
    source_sha256 = _file_sha256(source)
    observations, distance_m = _inspect_gpx(source)
    lifecycle, evidence = _validate_lifecycle(request)
    requested_id = request.get("desired_route_id")
    slug = str(requested_id or f"gpx-{uuid.uuid4().hex}")
    if not IMPORTED_SLUG.fullmatch(slug):
        raise RouteCreateError("request.invalid_route_id", "desired_route_id is not a safe imported route id")
    if _route_by_slug(config, slug) is not None:
        raise RouteCreateError("route.identity_conflict", f"route id {slug} already exists")

    curation = _curation(request.get("curation"))
    description = str(request.get("source_description") or "").strip()
    if not description and not curation.get("vibe"):
        raise RouteCreateError(
            "request.missing_description",
            "a source_description or curated vibe is required",
        )
    annotations = copy.deepcopy(request.get("annotations", []))
    try:
        annotations = build_route_annotations(annotations, distance_m)
    except ValueError as error:
        raise RouteCreateError("request.invalid_annotations", str(error)) from error

    route_spec: dict[str, object] = {
        "activity_id": slug,
        "status": "approved",
        "source_gpx": f"route_sources/imported/{slug}.gpx",
        "source_sha256": source_sha256,
        "activity_name": str(request["route_name"]).strip(),
        "activity_type": request["activity_type"],
        "date": _activity_date(request.get("activity_date")),
        "region": str(request["region"]).strip(),
        "title": str(request["route_name"]).strip(),
        "lifecycle": lifecycle,
        "description": description,
        "curation": curation,
    }
    if evidence is not None:
        route_spec["lifecycle_evidence"] = evidence
    if annotations:
        route_spec["annotations"] = annotations
    if request.get("replay_mode"):
        route_spec["replay_mode"] = request["replay_mode"]

    proposal_id = uuid.uuid4().hex
    staged_path = _stage_source(source, root, proposal_id, source_sha256)
    warnings = []
    if observations["temporal"]["status"] == "recorded" and lifecycle == "discovered":
        warnings.append(
            {
                "code": "source.timestamps_not_owner_time",
                "message": "Source timestamps will not be published as owner elapsed time or pace.",
            }
        )
    if observations["elevation"]["status"] == "unavailable":
        warnings.append(
            {
                "code": "source.elevation_unavailable",
                "message": "Elevation will remain unavailable and use mesh-relative rendering.",
            }
        )
    staged_media, media_warnings = _stage_media(
        request.get("media", []),
        root,
        proposal_id,
        {str(item["id"]) for item in annotations},
    )
    warnings.extend(media_warnings)
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "route-share-proposal",
        "proposal_id": proposal_id,
        "operation": "create",
        "source": {
            "mode": "gpx",
            "filename": source.name,
            "sha256": source_sha256,
            "staged_path": staged_path,
            "durable_path": route_spec["source_gpx"],
        },
        "route_spec": route_spec,
        "observations": observations,
        "media": staged_media,
        "proposed_share_name": request.get("proposed_share_name"),
        "warnings": warnings,
        "blocking_errors": [],
    }


def _write_atomic(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def _register_source(proposal: dict[str, object], root: Path) -> Path:
    source = proposal["source"]
    staged = (root / source["staged_path"]).resolve()
    staging_root = (root / ".route-share" / "staging").resolve()
    if not staged.is_relative_to(staging_root) or not staged.is_file():
        raise RouteCreateError("source.missing_staged", "approved proposal's staged GPX is unavailable")
    expected = source["sha256"]
    if _file_sha256(staged) != expected:
        raise RouteCreateError("source.checksum_mismatch", "staged GPX checksum changed after proposal")
    durable = (root / source["durable_path"]).resolve()
    durable_root = (root / "route_sources").resolve()
    if not durable.is_relative_to(durable_root):
        raise RouteCreateError("source.unsafe_destination", "durable source must stay inside route_sources")
    durable.parent.mkdir(parents=True, exist_ok=True)
    if durable.exists():
        if _file_sha256(durable) != expected:
            raise RouteCreateError("source.destination_conflict", "durable GPX exists with a different checksum")
        return durable
    temporary = durable.with_suffix(".gpx.tmp")
    shutil.copyfile(staged, temporary)
    if _file_sha256(temporary) != expected:
        temporary.unlink(missing_ok=True)
        raise RouteCreateError("source.checksum_mismatch", "durable GPX checksum does not match")
    os.replace(temporary, durable)
    return durable


def _copy_verified_source(
    staged: Path,
    durable: Path,
    expected_sha256: str,
) -> None:
    if durable.exists():
        if _file_sha256(durable) != expected_sha256:
            raise RouteCreateError(
                "media.destination_conflict",
                "durable media exists with a different checksum",
            )
        return
    durable.parent.mkdir(parents=True, exist_ok=True)
    temporary = durable.with_suffix(durable.suffix + ".tmp")
    shutil.copyfile(staged, temporary)
    if _file_sha256(temporary) != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise RouteCreateError("media.checksum_mismatch", "durable media checksum does not match")
    os.replace(temporary, durable)


def _route_spec_with_registered_media(
    proposal: dict[str, object],
    root: Path,
) -> dict[str, object]:
    route_spec = copy.deepcopy(proposal["route_spec"])
    slug = str(route_spec["activity_id"])
    registered = []
    staging_root = (root / ".route-share" / "staging").resolve()
    for item in proposal.get("media", []):
        staged = (root / item["staged_path"]).resolve()
        if not staged.is_relative_to(staging_root) or not staged.is_file():
            raise RouteCreateError("media.missing_staged", "approved proposal media is unavailable")
        if _file_sha256(staged) != item["sha256"]:
            raise RouteCreateError("media.checksum_mismatch", "staged media changed after proposal")
        extension = staged.suffix.lower()
        durable_relative = Path("route_sources") / "media" / slug / f"{item['sha256']}{extension}"
        durable = (root / durable_relative).resolve()
        _copy_verified_source(staged, durable, item["sha256"])
        record = {
            "path": durable_relative.as_posix(),
            "sha256": item["sha256"],
            "kind": item["kind"],
            "association": copy.deepcopy(item["association"]),
            "capture_metadata": copy.deepcopy(item["capture_metadata"]),
        }
        registered.append(record)

        if item["kind"] != "image" or item["association"]["kind"] != "annotation":
            continue
        annotation_id = item["association"]["annotation_id"]
        annotations = route_spec.get("annotations", [])
        annotation = next(
            (candidate for candidate in annotations if candidate.get("id") == annotation_id),
            None,
        )
        if annotation is None:
            raise RouteCreateError(
                "media.association_missing",
                f"annotation {annotation_id} no longer exists in the proposal",
            )
        annotation["media"] = publish_photo(
            durable,
            root / "app" / "public" / "media" / slug,
            slug,
            item["sha256"][:16],
        )
    if registered:
        route_spec["source_media"] = registered
    route_spec["route_share_proposal_id"] = proposal["proposal_id"]
    return route_spec


def _default_rebuild(root: Path, slug: str) -> dict[str, object]:
    subprocess.run([str(root / "rebuild.sh")], cwd=root, check=True)
    subprocess.run(
        ["node", "scripts/validate-route-microsite.mjs", slug, "source"],
        cwd=root,
        check=True,
    )
    from route_status import route_status

    status = route_status(root, slug)
    if not status["publishable"]:
        raise RuntimeError("route status is blocked: " + "; ".join(status["problems"]))
    return status


def apply_proposal(
    proposal: object,
    root: str | Path,
    *,
    rebuild=None,
) -> dict[str, object]:
    """Apply an approved proposal without duplicating or partially writing a route."""
    root = Path(root).resolve()
    proposal = _validate_proposal(proposal, root)
    if proposal.get("blocking_errors"):
        raise RouteCreateError("proposal.blocked", "proposal contains blocking errors")
    proposal_route_spec = proposal.get("route_spec")
    if not isinstance(proposal_route_spec, dict):
        raise RouteCreateError("proposal.invalid", "proposal route_spec must be an object")
    slug = str(proposal_route_spec.get("activity_id") or "")
    if not SAFE_SLUG.fullmatch(slug):
        raise RouteCreateError("proposal.invalid", "proposal route identity is unsafe")

    config = _load_config(root)
    existing = _route_by_slug(config, slug)
    operation = proposal.get("operation")
    if existing is not None and existing.get("route_share_proposal_id") == proposal.get("proposal_id"):
        if operation == "create":
            _register_source(proposal, root)
        _route_spec_with_registered_media(proposal, root)
        return _creation_report(proposal, "already_applied")
    if operation == "create" and existing is not None:
        raise RouteCreateError("route.identity_conflict", f"route id {slug} now has different content")
    if operation == "update":
        if existing is None:
            raise RouteCreateError("route.not_found", f"route {slug} no longer exists")
        if _canonical_sha256(existing) != proposal.get("base_route_sha256"):
            raise RouteCreateError("route.changed_since_proposal", f"route {slug} changed after proposal")
    elif operation != "create":
        raise RouteCreateError("proposal.invalid", "proposal operation must be create or update")

    if operation == "create":
        _register_source(proposal, root)
        route_spec = _route_spec_with_registered_media(proposal, root)
        config["routes"].append(route_spec)
        result = "created"
    else:
        route_spec = _route_spec_with_registered_media(proposal, root)
        index = config["routes"].index(existing)
        config["routes"][index] = route_spec
        result = "updated"

    serialized = json.dumps(config, indent=2, ensure_ascii=False) + "\n"
    _write_atomic(root / "quests.json", serialized)
    rebuild_callback = rebuild or (lambda: _default_rebuild(root, slug))
    try:
        validation = rebuild_callback()
    except Exception as error:
        recovery = root / ".route-share" / "recovery"
        recovery.mkdir(parents=True, exist_ok=True)
        report = {
            "proposal_id": proposal.get("proposal_id"),
            "slug": slug,
            "status": "canonical_writes_complete_validation_failed",
            "error": str(error),
        }
        _write_atomic(recovery / f"{proposal.get('proposal_id', slug)}.json", json.dumps(report, indent=2) + "\n")
        raise RouteCreateError(
            "create.validation_failed",
            "canonical route and source were written, but rebuild validation failed; see .route-share/recovery",
        ) from error
    return _creation_report(proposal, result, validation)


def _creation_report(
    proposal: dict[str, object],
    result: str,
    validation: object = None,
) -> dict[str, object]:
    slug = proposal["route_spec"]["activity_id"]
    return {
        "ok": True,
        "document_type": "route-share-creation-report",
        "proposal_id": proposal.get("proposal_id"),
        "slug": slug,
        "result": result,
        "source": {
            "sha256": proposal.get("source", {}).get("sha256"),
            "durable_path": proposal.get("source", {}).get("durable_path"),
        },
        "validation": validation,
        "next_command": f"./scripts/route.sh preview {slug}",
    }


def _read_json(path: str | Path, code: str) -> object:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RouteCreateError(code, f"could not read JSON input: {error}") from error


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    propose = subcommands.add_parser("propose")
    propose.add_argument("--request", required=True)
    create = subcommands.add_parser("create")
    create.add_argument("--proposal", required=True)
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent
    try:
        if args.command == "propose":
            report = propose_request(_read_json(args.request, "request.unreadable"), root)
        else:
            report = apply_proposal(_read_json(args.proposal, "proposal.unreadable"), root)
    except RouteCreateError as error:
        print(json.dumps(error.as_report(), indent=2), file=__import__("sys").stderr)
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
