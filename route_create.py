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
import sys
import tempfile
import uuid

import gpxpy
from jsonschema import Draft202012Validator
from PIL import Image

from admin_curation import OwnerMutationBusyError, owner_mutation_lock

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
EXISTING_REQUEST_FIELDS = frozenset(
    (
        "schema_version",
        "existing_slug",
        "curation",
        "annotations",
        "media",
        "replay_mode",
        "proposed_share_name",
    )
)


class RouteCreateError(ValueError):
    """A stable, machine-readable route creation failure."""

    def __init__(self, code: str, message: str, *, exit_code: int = 1):
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code

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
    if request.get("existing_slug"):
        incompatible = sorted(set(request) - EXISTING_REQUEST_FIELDS)
        if incompatible:
            raise RouteCreateError(
                "request.mode_field",
                f"existing-route request cannot use fields: {', '.join(incompatible)}",
            )
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
        raise RouteCreateError(
            "repository.invalid_routes",
            f"quests.json is unavailable: {error.__class__.__name__}",
        ) from error
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


def _route_contract_sha256(route_spec: dict[str, object]) -> str:
    contract = copy.deepcopy(route_spec)
    contract.pop("route_share_contract_sha256", None)
    return _canonical_sha256(contract)


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
        raise RouteCreateError(
            "source.invalid_gpx",
            f"GPX could not be parsed: {error.__class__.__name__}",
        ) from error
    if len(parsed.route) < 2 or parsed.route[-1]["d"] <= 0:
        raise RouteCreateError("source.empty_geometry", "GPX must contain at least two distinct route points")
    source_points = [
        point
        for track in gpx.tracks
        for segment in track.segments
        for point in segment.points
    ]
    source_elevations = [point.elevation for point in source_points]
    recorded_elevations = [value for value in source_elevations if value is not None]
    if recorded_elevations and len(recorded_elevations) != len(source_elevations):
        raise RouteCreateError(
            "source.partial_elevation",
            "GPX elevation must be present for every positioned point or omitted entirely",
        )
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
    staging = _controlled_path(
        root,
        Path(".route-share/staging"),
        "source.unsafe_staging",
        "staging must stay inside the repository",
    )
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


def _controlled_path(
    root: Path,
    relative: Path,
    code: str,
    message: str,
    *,
    owner_relative: Path | None = None,
) -> Path:
    repository_root = root.resolve()
    ownership_path = repository_root / (owner_relative or relative)
    ownership_root = ownership_path.resolve()
    candidate = (repository_root / relative).resolve()
    if (
        ownership_root != ownership_path
        or not ownership_root.is_relative_to(repository_root)
        or not candidate.is_relative_to(ownership_root)
    ):
        raise RouteCreateError(code, message)
    return candidate


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


def _derived_capture_metadata(source: Path, kind: str) -> dict[str, object]:
    try:
        metadata = (
            read_photo_metadata(source) if kind == "image" else read_video_metadata(source)
        )
        return _json_capture_metadata(metadata)
    except Exception:
        return {"status": "unavailable"}


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
        if media_type == "image":
            try:
                with Image.open(source) as image:
                    image.verify()
            except Exception:
                warnings.append(
                    {
                        "code": "media.invalid_image_omitted",
                        "message": f"Unreadable image {source.name} was omitted from the proposal.",
                    }
                )
                continue
        digest = _file_sha256(source)
        staged_index = len(staged_media)
        staged_path = _stage_file(
            source,
            root,
            f"{proposal_id}-media-{staged_index}{source.suffix.lower()}",
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


def _validate_lifecycle(
    request: dict[str, object],
    activity_date: str,
) -> tuple[str, dict[str, object] | None]:
    lifecycle = str(request.get("lifecycle") or "discovered")
    evidence = request.get("completion_evidence")
    if lifecycle == "completed" and (
        not isinstance(evidence, dict) or evidence.get("kind") != "owner_recorded"
    ):
        raise RouteCreateError(
            "request.lifecycle_contradiction",
            "completed lifecycle requires owner-recorded completion evidence",
        )
    if lifecycle == "completed" and not activity_date:
        raise RouteCreateError(
            "request.missing_activity_date",
            "completed lifecycle requires activity_date",
        )
    if lifecycle == "discovered" and evidence is not None:
        raise RouteCreateError(
            "request.lifecycle_contradiction",
            "owner-recorded completion evidence conflicts with discovered lifecycle",
        )
    return lifecycle, copy.deepcopy(evidence) if isinstance(evidence, dict) else None


def _existing_route_distance(root: Path, slug: str) -> float:
    detail_path = root / "app" / "public" / "data" / "routes" / f"{slug}.json"
    try:
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        points = detail["route"]
        distance_m = float(points[-1]["d"])
    except (OSError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise RouteCreateError(
            "route.distance_unavailable",
            f"generated route distance is unavailable for {slug}",
        ) from error
    if distance_m <= 0:
        raise RouteCreateError(
            "route.distance_unavailable",
            f"generated route distance is unavailable for {slug}",
        )
    return distance_m


def _existing_route_observations(root: Path, slug: str) -> dict[str, object]:
    detail_path = root / "app" / "public" / "data" / "routes" / f"{slug}.json"
    try:
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        points = detail["route"]
        distance_m = float(points[-1]["d"])
    except (OSError, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise RouteCreateError(
            "route.observations_unavailable",
            f"generated route observations are unavailable for {slug}",
        ) from error
    elevation_status = str(detail.get("elevation_status") or "recorded")
    elevations = [
        float(point["elev"])
        for point in points
        if isinstance(point, dict) and isinstance(point.get("elev"), (int, float))
    ]
    temporal = (detail.get("provenance") or {}).get("temporal") or {}
    temporal_status = str(temporal.get("status") or "unavailable")
    observations: dict[str, object] = {
        "distance_m": round(distance_m, 3),
        "temporal": {"status": temporal_status},
        "elevation": {"status": elevation_status},
    }
    if elevation_status == "recorded" and elevations:
        observations["elevation"] = {
            "status": "recorded",
            "minimum_m": min(elevations),
            "maximum_m": max(elevations),
        }
    return observations


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
            merged_curation = copy.deepcopy(existing.get("curation", {}))
            merged_curation.update(copy.deepcopy(request["curation"]))
            route_spec["curation"] = _curation(merged_curation)
        if "annotations" in request:
            try:
                route_spec["annotations"] = build_route_annotations(
                    copy.deepcopy(request["annotations"]),
                    _existing_route_distance(root, slug),
                    allow_unpublished_image=True,
                )
            except ValueError as error:
                raise RouteCreateError("request.invalid_annotations", str(error)) from error
        if "replay_mode" in request:
            route_spec["replay_mode"] = request["replay_mode"]
        proposal_id = uuid.uuid4().hex
        staged_media, media_warnings = _stage_media(
            request.get("media", []),
            root,
            proposal_id,
            {str(item.get("id")) for item in route_spec.get("annotations", [])},
        )
        staged_image_annotations = {
            str(item["association"].get("annotation_id"))
            for item in staged_media
            if item["kind"] == "image" and item["association"]["kind"] == "annotation"
        }
        filtered_annotations = [
            annotation
            for annotation in route_spec.get("annotations", [])
            if annotation["kind"] != "image"
            or annotation.get("media") is not None
            or annotation["id"] in staged_image_annotations
        ]
        if len(filtered_annotations) != len(route_spec.get("annotations", [])):
            if filtered_annotations:
                route_spec["annotations"] = filtered_annotations
            else:
                route_spec.pop("annotations", None)
            media_warnings.append(
                {
                    "code": "annotation.image_omitted",
                    "message": "Image annotations without usable staged images were omitted.",
                }
            )
        proposal_core = {
            "schema_version": SCHEMA_VERSION,
            "document_type": "route-share-proposal",
            "operation": "update",
            "source": {"mode": "existing-route", "existing_slug": slug},
            "base_route_sha256": _canonical_sha256(existing),
            "route_spec": route_spec,
            "observations": _existing_route_observations(root, slug),
            "media": staged_media,
            "proposed_share_name": request.get("proposed_share_name"),
            "warnings": media_warnings,
            "blocking_errors": [],
        }
        proposal_core["proposal_id"] = proposal_id
        return proposal_core

    source = _safe_source_path(request.get("gpx_path"))
    try:
        source_sha256 = _file_sha256(source)
    except OSError as error:
        raise RouteCreateError(
            "source.unreadable",
            f"GPX source is unreadable: {error.__class__.__name__}",
        ) from error
    observations, distance_m = _inspect_gpx(source)
    activity_date = _activity_date(request.get("activity_date"))
    lifecycle, evidence = _validate_lifecycle(request, activity_date)
    requested_id = request.get("desired_route_id")
    slug = str(requested_id or f"gpx-{uuid.uuid4().hex}")
    if not IMPORTED_SLUG.fullmatch(slug):
        raise RouteCreateError("request.invalid_route_id", "desired_route_id is not a safe imported route id")
    if _route_by_slug(config, slug) is not None:
        raise RouteCreateError("route.identity_conflict", f"route id {slug} already exists")

    route_name = str(request["route_name"]).strip()
    region = str(request["region"]).strip()
    if not route_name:
        raise RouteCreateError("request.missing_route_name", "route_name must contain visible text")
    if not region:
        raise RouteCreateError("request.missing_region", "region must contain visible text")
    curation = _curation(request.get("curation"))
    description = str(request.get("source_description") or "").strip()
    if not description and not curation.get("vibe"):
        raise RouteCreateError(
            "request.missing_description",
            "a source_description or curated vibe is required",
        )
    annotations = copy.deepcopy(request.get("annotations", []))
    try:
        annotations = build_route_annotations(
            annotations,
            distance_m,
            allow_unpublished_image=True,
        )
    except ValueError as error:
        raise RouteCreateError("request.invalid_annotations", str(error)) from error

    route_spec: dict[str, object] = {
        "activity_id": slug,
        "status": "approved",
        "source_gpx": f"route_sources/imported/{slug}.gpx",
        "source_sha256": source_sha256,
        "activity_name": route_name,
        "activity_type": request["activity_type"],
        "date": activity_date,
        "region": region,
        "title": route_name,
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
    staged_image_annotations = {
        str(item["association"].get("annotation_id"))
        for item in staged_media
        if item["kind"] == "image" and item["association"]["kind"] == "annotation"
    }
    omitted_image_annotations = [
        annotation
        for annotation in annotations
        if annotation["kind"] == "image" and annotation["id"] not in staged_image_annotations
    ]
    if omitted_image_annotations:
        omitted_ids = {annotation["id"] for annotation in omitted_image_annotations}
        annotations = [annotation for annotation in annotations if annotation["id"] not in omitted_ids]
        if annotations:
            route_spec["annotations"] = annotations
        else:
            route_spec.pop("annotations", None)
        warnings.append(
            {
                "code": "annotation.image_omitted",
                "message": "Image annotations without usable staged images were omitted.",
            }
        )
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


def _validated_source_path(
    proposal: dict[str, object],
    root: Path,
    *,
    durable: bool,
) -> Path:
    source = proposal["source"]
    relative = source["durable_path" if durable else "staged_path"]
    candidate = (root / relative).resolve()
    allowed_root = _controlled_path(
        root,
        Path("route_sources/imported" if durable else ".route-share/staging"),
        "source.unsafe_destination" if durable else "source.unsafe_staging",
        "approved GPX path must stay inside the repository",
    )
    if not candidate.is_relative_to(allowed_root) or not candidate.is_file():
        code = "source.missing_durable" if durable else "source.missing_staged"
        label = "durable" if durable else "staged"
        raise RouteCreateError(code, f"approved proposal's {label} GPX is unavailable")
    try:
        actual = _file_sha256(candidate)
    except OSError as error:
        raise RouteCreateError(
            "source.unreadable",
            f"approved GPX is unreadable: {error.__class__.__name__}",
        ) from error
    if actual != source["sha256"]:
        code = "source.durable_checksum_mismatch" if durable else "source.checksum_mismatch"
        raise RouteCreateError(code, f"{('durable' if durable else 'staged')} GPX checksum changed")
    return candidate


def _validated_staged_media(
    proposal: dict[str, object],
    root: Path,
    annotation_ids: set[str],
) -> None:
    staging_root = _controlled_path(
        root,
        Path(".route-share/staging"),
        "source.unsafe_staging",
        "staging must stay inside the repository",
    )
    slug = str(proposal["route_spec"]["activity_id"])
    for index, item in enumerate(proposal.get("media", [])):
        association = item["association"]
        annotation_id = association.get("annotation_id")
        if association["kind"] == "annotation" and annotation_id not in annotation_ids:
            raise RouteCreateError(
                "media.association_missing",
                f"annotation {annotation_id} no longer exists in the proposal",
            )
        extension = Path(str(item["filename"])).suffix.lower()
        expected_kind = (
            "image"
            if extension in IMAGE_EXTENSIONS
            else "video"
            if extension in VIDEO_EXTENSIONS
            else None
        )
        expected_staged = f".route-share/staging/{proposal['proposal_id']}-media-{index}{extension}"
        if (
            Path(str(item["filename"])).name != item["filename"]
            or expected_kind is None
            or item["kind"] != expected_kind
            or item["staged_path"] != expected_staged
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "proposal media identity changed after approval",
            )
        staged = (root / expected_staged).resolve()
        if not staged.is_relative_to(staging_root) or not staged.is_file():
            raise RouteCreateError("media.missing_staged", "approved proposal media is unavailable")
        try:
            actual = _file_sha256(staged)
        except OSError as error:
            raise RouteCreateError(
                "media.unreadable",
                f"approved media is unreadable: {error.__class__.__name__}",
            ) from error
        if actual != item["sha256"]:
            raise RouteCreateError("media.checksum_mismatch", "staged media changed after proposal")
        derived_metadata = _derived_capture_metadata(staged, item["kind"])
        if item["capture_metadata"] != derived_metadata:
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "proposal media capture metadata changed after approval",
            )
        if item["kind"] == "image":
            try:
                with tempfile.TemporaryDirectory() as directory:
                    publish_photo(
                        staged,
                        Path(directory),
                        slug,
                        item["sha256"][:16],
                    )
            except Exception as error:
                raise RouteCreateError(
                    "media.invalid_image",
                    f"approved image cannot produce a public derivative: {error.__class__.__name__}",
                ) from error


def _register_source(proposal: dict[str, object], root: Path) -> Path:
    source = proposal["source"]
    staged = _validated_source_path(proposal, root, durable=False)
    expected = source["sha256"]
    durable = (root / source["durable_path"]).resolve()
    durable_root = _controlled_path(
        root,
        Path("route_sources/imported"),
        "source.unsafe_destination",
        "durable source must stay inside the repository",
    )
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


def _media_destination_roots(root: Path, slug: str) -> tuple[Path, Path]:
    durable = _controlled_path(
        root,
        Path("route_sources") / "media" / slug,
        "media.unsafe_destination",
        "durable media must stay inside the repository",
        owner_relative=Path("route_sources/media"),
    )
    public = _controlled_path(
        root,
        Path("app/public") / "media" / slug,
        "media.unsafe_destination",
        "public media must stay inside the repository",
        owner_relative=Path("app/public/media"),
    )
    return durable, public


def _route_spec_with_registered_media(
    proposal: dict[str, object],
    root: Path,
) -> dict[str, object]:
    route_spec = copy.deepcopy(proposal["route_spec"])
    slug = str(route_spec["activity_id"])
    registered = copy.deepcopy(route_spec.get("source_media", []))
    staging_root = _controlled_path(
        root,
        Path(".route-share/staging"),
        "source.unsafe_staging",
        "staging must stay inside the repository",
    )
    durable_media_root, public_media_root = _media_destination_roots(root, slug)
    for item in proposal.get("media", []):
        staged = (root / item["staged_path"]).resolve()
        if not staged.is_relative_to(staging_root) or not staged.is_file():
            raise RouteCreateError("media.missing_staged", "approved proposal media is unavailable")
        if _file_sha256(staged) != item["sha256"]:
            raise RouteCreateError("media.checksum_mismatch", "staged media changed after proposal")
        extension = staged.suffix.lower()
        durable_relative = Path("route_sources") / "media" / slug / f"{item['sha256']}{extension}"
        durable = (root / durable_relative).resolve()
        if not durable.is_relative_to(durable_media_root):
            raise RouteCreateError(
                "media.unsafe_destination",
                "durable media must stay inside the route media directory",
            )
        _copy_verified_source(staged, durable, item["sha256"])
        record = {
            "path": durable_relative.as_posix(),
            "sha256": item["sha256"],
            "kind": item["kind"],
            "association": copy.deepcopy(item["association"]),
            "capture_metadata": copy.deepcopy(item["capture_metadata"]),
        }
        if not any(
            existing.get("path") == record["path"]
            and existing.get("sha256") == record["sha256"]
            and existing.get("association") == record["association"]
            for existing in registered
        ):
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
            public_media_root,
            slug,
            item["sha256"][:16],
        )
    if registered:
        route_spec["source_media"] = registered
    route_spec["route_share_proposal_id"] = proposal["proposal_id"]
    route_spec["route_share_contract_sha256"] = _route_contract_sha256(route_spec)
    return route_spec


def _without_applied_media(route_spec: dict[str, object]) -> dict[str, object]:
    normalized = copy.deepcopy(route_spec)
    normalized.pop("source_media", None)
    normalized.pop("route_share_proposal_id", None)
    normalized.pop("route_share_contract_sha256", None)
    for annotation in normalized.get("annotations", []):
        annotation.pop("media", None)
    return normalized


def _validate_applied_files(
    proposal: dict[str, object],
    existing: dict[str, object],
    root: Path,
) -> None:
    if _without_applied_media(existing) != _without_applied_media(proposal["route_spec"]):
        raise RouteCreateError(
            "route.changed_since_apply",
            "canonical route differs from the approved proposal",
        )
    if proposal["operation"] == "create":
        _validated_source_path(proposal, root, durable=True)
    registered = existing.get("source_media", [])
    slug = str(existing["activity_id"])
    media_root, public_media_root = _media_destination_roots(root, slug)
    annotation_ids = {
        str(annotation.get("id"))
        for annotation in existing.get("annotations", [])
        if isinstance(annotation, dict)
    }
    if not isinstance(registered, list):
        raise RouteCreateError("media.invalid_durable", "registered route media is invalid")
    for record in registered:
        if not isinstance(record, dict):
            raise RouteCreateError("media.invalid_durable", "registered route media is invalid")
        relative = str(record.get("path") or "")
        sha256 = str(record.get("sha256") or "")
        kind = record.get("kind")
        association = record.get("association")
        extension = Path(relative).suffix.lower()
        expected_kind = (
            "image"
            if extension in IMAGE_EXTENSIONS
            else "video"
            if extension in VIDEO_EXTENSIONS
            else None
        )
        expected_path = f"route_sources/media/{slug}/{sha256}{extension}"
        route_association = (
            isinstance(association, dict)
            and set(association) == {"kind"}
            and association.get("kind") == "route"
        )
        annotation_association = (
            isinstance(association, dict)
            and set(association) == {"kind", "annotation_id"}
            and association.get("kind") == "annotation"
            and str(association.get("annotation_id")) in annotation_ids
        )
        durable = (root / relative).resolve()
        if (
            not re.fullmatch(r"[0-9a-f]{64}", sha256)
            or kind != expected_kind
            or relative != expected_path
            or not (route_association or annotation_association)
            or not durable.is_relative_to(media_root)
            or not durable.is_file()
        ):
            raise RouteCreateError(
                "media.missing_durable",
                "registered route media is unavailable or invalid",
            )
        try:
            actual_sha256 = _file_sha256(durable)
        except OSError as error:
            raise RouteCreateError(
                "media.unreadable",
                f"registered route media is unreadable: {error.__class__.__name__}",
            ) from error
        if (
            actual_sha256 != sha256
            or record.get("capture_metadata") != _derived_capture_metadata(durable, kind)
        ):
            raise RouteCreateError(
                "media.missing_durable",
                "registered route media is unavailable or changed",
            )
    for item in proposal.get("media", []):
        extension = Path(item["staged_path"]).suffix.lower()
        expected_path = f"route_sources/media/{slug}/{item['sha256']}{extension}"
        record = next(
            (
                candidate
                for candidate in registered
                if candidate.get("path") == expected_path
                and candidate.get("sha256") == item["sha256"]
                and candidate.get("kind") == item["kind"]
                and candidate.get("association") == item["association"]
            ),
            None,
        )
        durable = (root / expected_path).resolve()
        if record is None or not durable.is_file() or _file_sha256(durable) != item["sha256"]:
            raise RouteCreateError(
                "media.missing_durable",
                "registered route media is unavailable or changed",
            )
    for annotation in existing.get("annotations", []):
        media = annotation.get("media")
        if not isinstance(media, dict):
            continue
        for field in ("url", "thumb_url"):
            relative = str(media.get(field) or "")
            published = (root / "app" / "public" / relative).resolve()
            if (
                not published.is_relative_to(public_media_root)
                or not published.is_file()
            ):
                raise RouteCreateError(
                    "media.missing_derivative",
                    "registered public media derivative is unavailable",
                )


def _validate_proposal_semantics(
    proposal: dict[str, object],
    existing: dict[str, object] | None,
    root: Path,
    *,
    require_staging: bool = True,
) -> None:
    operation = proposal["operation"]
    source = proposal["source"]
    route_spec = proposal["route_spec"]
    slug = str(route_spec["activity_id"])
    if proposal.get("media"):
        _media_destination_roots(root, slug)

    if operation == "create":
        if source.get("mode") != "gpx" or existing is not None:
            raise RouteCreateError("proposal.semantic_mismatch", "create proposal source is inconsistent")
        if not IMPORTED_SLUG.fullmatch(slug):
            raise RouteCreateError("proposal.semantic_mismatch", "created route id must use the gpx- contract")
        expected_durable = f"route_sources/imported/{slug}.gpx"
        expected_staged = f".route-share/staging/{proposal['proposal_id']}.gpx"
        if (
            route_spec.get("status") != "approved"
            or route_spec.get("source_gpx") != expected_durable
            or source.get("durable_path") != expected_durable
            or route_spec.get("source_sha256") != source.get("sha256")
            or source.get("staged_path") != expected_staged
        ):
            raise RouteCreateError("proposal.semantic_mismatch", "created route source contract changed after approval")
        source_path = _validated_source_path(proposal, root, durable=not require_staging)
        observed, distance_m = _inspect_gpx(source_path)
        if proposal.get("observations") != observed:
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "source observations changed after approval",
            )
        required_text = ("activity_name", "region", "title")
        if any(not str(route_spec.get(field) or "").strip() for field in required_text):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route name, title, and region must contain visible text",
            )
        if route_spec.get("activity_name") != route_spec.get("title"):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route title must match the approved route name",
            )
        if route_spec.get("activity_type") not in {"Run", "Ride"}:
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route activity type must be Run or Ride",
            )
        try:
            normalized_curation = _curation(route_spec.get("curation"))
        except RouteCreateError as error:
            raise RouteCreateError("proposal.semantic_mismatch", str(error)) from error
        if normalized_curation != route_spec.get("curation"):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route curation is not normalized",
            )
        if not (
            str(route_spec.get("description") or "").strip()
            or str(normalized_curation.get("vibe") or "").strip()
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route needs a description or curated vibe",
            )
        raw_annotations = route_spec.get("annotations", [])
        if any(annotation.get("media") is not None for annotation in raw_annotations):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "public annotation media must come from staged proposal media",
            )
        try:
            normalized_annotations = build_route_annotations(
                raw_annotations,
                distance_m,
                allow_unpublished_image=True,
            )
        except ValueError as error:
            raise RouteCreateError("proposal.semantic_mismatch", str(error)) from error
        if normalized_annotations != raw_annotations:
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route annotations are not normalized",
            )
        annotation_ids = {str(annotation["id"]) for annotation in normalized_annotations}
        image_associations = {
            str(item["association"].get("annotation_id"))
            for item in proposal.get("media", [])
            if item.get("kind") == "image" and item.get("association", {}).get("kind") == "annotation"
        }
        if any(
            annotation["kind"] == "image" and annotation["id"] not in image_associations
            for annotation in normalized_annotations
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "image annotations require staged image media",
            )
        if route_spec.get("source_media") or route_spec.get("route_share_proposal_id"):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created proposal cannot contain already-published route media",
            )
        if require_staging:
            _validated_staged_media(proposal, root, annotation_ids)
        lifecycle = route_spec.get("lifecycle")
        try:
            activity_date = _activity_date(route_spec.get("date"))
        except RouteCreateError as error:
            raise RouteCreateError("proposal.semantic_mismatch", str(error)) from error
        evidence = route_spec.get("lifecycle_evidence")
        if lifecycle == "completed":
            if (
                not activity_date
                or not isinstance(evidence, dict)
                or evidence.get("kind") != "owner_recorded"
                or not str(evidence.get("description") or "").strip()
            ):
                raise RouteCreateError(
                    "proposal.semantic_mismatch",
                    "completed route requires a date and owner-recorded evidence",
                )
        elif lifecycle == "discovered":
            if evidence is not None:
                raise RouteCreateError(
                    "proposal.semantic_mismatch",
                    "discovered route cannot carry completion evidence",
                )
        else:
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "created route lifecycle must be completed or discovered",
            )
        return

    if source.get("mode") != "existing-route" or existing is None:
        raise RouteCreateError("proposal.semantic_mismatch", "update proposal source is inconsistent")
    if source.get("existing_slug") != slug or not proposal.get("base_route_sha256"):
        raise RouteCreateError("proposal.semantic_mismatch", "updated route identity changed after approval")
    expected_observations = _existing_route_observations(root, slug)
    if proposal.get("observations") != expected_observations:
        raise RouteCreateError(
            "proposal.semantic_mismatch",
            "existing-route observations changed after approval",
        )
    distance_m = float(expected_observations["distance_m"])
    raw_annotations = route_spec.get("annotations", [])
    try:
        normalized_annotations = build_route_annotations(
            raw_annotations,
            distance_m,
            allow_unpublished_image=True,
        )
    except ValueError as error:
        raise RouteCreateError("proposal.semantic_mismatch", str(error)) from error
    if normalized_annotations != raw_annotations:
        raise RouteCreateError(
            "proposal.semantic_mismatch",
            "updated route annotations are not normalized",
        )
    existing_media = {
        str(annotation.get("id")): annotation.get("media")
        for annotation in existing.get("annotations", [])
        if isinstance(annotation, dict) and annotation.get("media") is not None
    }
    staged_image_annotations = {
        str(item["association"].get("annotation_id"))
        for item in proposal.get("media", [])
        if item.get("kind") == "image" and item.get("association", {}).get("kind") == "annotation"
    }
    for annotation in normalized_annotations:
        if annotation.get("media") is not None and annotation.get("media") != existing_media.get(
            str(annotation["id"])
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "updated annotation media must come from registered proposal media",
            )
        if (
            annotation["kind"] == "image"
            and annotation.get("media") is None
            and annotation["id"] not in staged_image_annotations
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "image annotations require staged image media",
            )
    if "curation" in route_spec:
        try:
            normalized_curation = _curation(route_spec.get("curation"))
        except RouteCreateError as error:
            raise RouteCreateError("proposal.semantic_mismatch", str(error)) from error
        if normalized_curation != route_spec.get("curation"):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "updated route curation is not normalized",
            )
    if require_staging:
        _validated_staged_media(
            proposal,
            root,
            {str(annotation["id"]) for annotation in normalized_annotations},
        )
    editable_fields = {"annotations", "curation", "replay_mode"}
    for field in set(existing) | set(route_spec):
        if field in editable_fields:
            continue
        if existing.get(field) != route_spec.get(field):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                f"updated route field {field} changed outside the approved edit surface",
            )


def _default_rebuild(root: Path, slug: str) -> dict[str, object]:
    subprocess.run(
        [sys.executable, str(root / "build.py")],
        cwd=root,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["node", "scripts/validate-route-microsite.mjs", slug, "source"],
        cwd=root,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    from route_status import route_status

    status = route_status(root, slug)
    if not status["publishable"]:
        raise RuntimeError("route status is blocked: " + "; ".join(status["problems"]))
    return status


def _run_rebuild_validation(
    proposal: dict[str, object],
    root: Path,
    slug: str,
    rebuild_callback,
) -> object:
    recovery_report = (
        root
        / ".route-share"
        / "recovery"
        / f"{proposal.get('proposal_id', slug)}.json"
    )
    try:
        validation = rebuild_callback()
    except Exception as error:
        recovery_report.parent.mkdir(parents=True, exist_ok=True)
        report = {
            "proposal_id": proposal.get("proposal_id"),
            "slug": slug,
            "status": "canonical_writes_complete_validation_failed",
            "error_type": error.__class__.__name__,
        }
        if isinstance(error, subprocess.CalledProcessError):
            report["downstream_exit_code"] = error.returncode
        _write_atomic(recovery_report, json.dumps(report, indent=2) + "\n")
        raise RouteCreateError(
            "create.validation_failed",
            "canonical route and source were written, but rebuild validation failed; see .route-share/recovery",
            exit_code=(
                error.returncode
                if isinstance(error, subprocess.CalledProcessError)
                and 1 <= error.returncode <= 255
                else 1
            ),
        ) from error
    recovery_report.unlink(missing_ok=True)
    return validation


def _apply_proposal_unlocked(
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
    rebuild_callback = rebuild or (lambda: _default_rebuild(root, slug))
    if existing is not None and existing.get("route_share_proposal_id") == proposal.get("proposal_id"):
        if operation == "create":
            _validate_proposal_semantics(
                proposal,
                None,
                root,
                require_staging=False,
            )
        elif (
            operation != "update"
            or proposal.get("source", {}).get("mode") != "existing-route"
            or proposal.get("source", {}).get("existing_slug") != slug
        ):
            raise RouteCreateError(
                "proposal.semantic_mismatch",
                "update proposal source is inconsistent",
            )
        expected_contract = existing.get("route_share_contract_sha256")
        if not expected_contract or _route_contract_sha256(existing) != expected_contract:
            raise RouteCreateError(
                "route.changed_since_apply",
                f"route {slug} differs from the approved proposal",
            )
        _validate_applied_files(proposal, existing, root)
        validation = _run_rebuild_validation(
            proposal,
            root,
            slug,
            rebuild_callback,
        )
        return _creation_report(proposal, "already_applied", validation)
    if operation == "create" and existing is not None:
        raise RouteCreateError("route.identity_conflict", f"route id {slug} now has different content")
    if operation == "update":
        if existing is None:
            raise RouteCreateError("route.not_found", f"route {slug} no longer exists")
        if _canonical_sha256(existing) != proposal.get("base_route_sha256"):
            raise RouteCreateError("route.changed_since_proposal", f"route {slug} changed after proposal")
    elif operation != "create":
        raise RouteCreateError("proposal.invalid", "proposal operation must be create or update")

    _validate_proposal_semantics(proposal, existing, root)

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
    validation = _run_rebuild_validation(
        proposal,
        root,
        slug,
        rebuild_callback,
    )
    return _creation_report(proposal, result, validation)


def apply_proposal(
    proposal: object,
    root: str | Path,
    *,
    rebuild=None,
) -> dict[str, object]:
    """Apply an approved proposal while owning the catalogue mutation boundary."""

    resolved_root = Path(root).resolve()
    try:
        with owner_mutation_lock(resolved_root):
            return _apply_proposal_unlocked(
                proposal,
                resolved_root,
                rebuild=rebuild,
            )
    except OwnerMutationBusyError as error:
        raise RouteCreateError(
            "repository.mutation_busy",
            "another catalogue mutation is in progress",
            exit_code=2,
        ) from error


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
        safe_name = Path(path).name or "JSON input"
        raise RouteCreateError(
            code,
            f"could not read {safe_name}: {error.__class__.__name__}",
        ) from error


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
        return error.exit_code
    except Exception as error:
        report = RouteCreateError(
            "workflow.unexpected",
            f"route workflow failed: {error.__class__.__name__}",
        )
        print(json.dumps(report.as_report(), indent=2), file=__import__("sys").stderr)
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
