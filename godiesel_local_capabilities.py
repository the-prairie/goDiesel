"""Canonical local capability adapters over goDiesel's existing writers."""

from __future__ import annotations

import csv
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

from jsonschema import Draft202012Validator
from fitparse import FitParseError
from gpxpy.gpx import GPXException

from admin_curation import (
    OwnerMutationBusyError,
    SourceRollbackError,
    owner_mutation_lock,
    save_owner_curation,
    write_atomic,
)
from curation_publish import CurationRecoveryError
from generated_route_contract import (
    completed_distance_km,
    valid_generated_projection,
)
from godiesel_evidence import (
    canonical_digest,
    repository_snapshot,
    write_evidence_receipt,
)
from godiesel_verification import (
    ProofInputMonitor,
    build_proof_snapshot,
    proof_snapshot_stability_issues,
    read_target_build_identity,
    verified_provider_build_identity,
)
from quest_meta import build_route_curation, infer_route_region, route_guide_preview
from route_imports import (
    DEFAULT_DIESEL_DIARIES_ROOT,
    find_strava_activity_file,
    imported_route_from_spec,
)
from route_provenance import build_route_provenance, load_source_route_points


SCHEMA_VERSION = 1
Runner = Callable[..., subprocess.CompletedProcess[str]]
TargetIdentityReader = Callable[[str], Mapping[str, object]]
RepositoryReader = Callable[[Path], Mapping[str, object]]
GENERATION_AUTHORITY = {
    "inspect": "read-only",
    "apply": "canonical-local",
    "verify": "ephemeral-local",
}
CURATION_AUTHORITY = {
    "inspect": "read-only",
    "plan": "ephemeral-local",
    "apply": "canonical-local",
    "verify": "ephemeral-local",
}
PROVIDER_AUTHORITY = {"inspect": "read-only", "verify": "ephemeral-local"}
PROVIDER_CHECKS = {
    "atlas": {
        "configuration": "GOOGLE_MAPS_API_KEY",
        "loader": "app/src/surfaces/atlas/cesium-atlas-world-engine.ts",
        "command": ["./scripts/verify-provider-readiness.sh", "atlas"],
    },
    "earth-replay": {
        "configuration": "GOOGLE_MAPS_API_KEY",
        "loader": "app/src/surfaces/replay/renderers/cesium-replay-engine.ts",
        "command": ["./scripts/verify-provider-readiness.sh", "earth-replay"],
    },
    "google-3d": {
        "configuration": "GOOGLE_MAPS_API_KEY",
        "loader": "app/src/providers/google-maps-loader.ts",
        "command": ["./scripts/verify-provider-readiness.sh", "google-3d"],
    },
}


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def _envelope(
    capability: str,
    verb: str,
    authority: str,
    *,
    status: str,
    authorized: bool,
    result: object,
    result_contract: str,
    blockers: list[dict[str, str]] | None = None,
    warnings: list[dict[str, str]] | None = None,
    exit_code: int | None = None,
) -> dict[str, Any]:
    blockers = blockers or []
    warnings = warnings or []
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-capability-result",
        "capability": capability,
        "verb": verb,
        "status": status,
        "authority": authority,
        "authorized": authorized,
        "exit_code": (2 if status == "blocked" else 0) if exit_code is None else exit_code,
        "result": result,
        "result_contract": result_contract,
        "blockers": blockers,
        "warnings": warnings,
        "receipt": None,
        "evidence": None,
    }


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _strava_metadata() -> dict[str, dict[str, str]]:
    metadata: dict[str, dict[str, str]] = {}
    metadata_path = DEFAULT_DIESEL_DIARIES_ROOT / "activities.csv"
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
            metadata[match.group(1)] = {
                "activity_name": row.get("Activity Name") or "(unnamed)",
                "activity_type": row.get("Activity Type") or "",
                "date": parsed_date.strftime("%Y-%m-%d") if parsed_date else "",
                "description": row.get("Activity Description") or "",
                "source_kind": "strava-export",
            }
    return metadata


def _source_projection(
    root: Path,
    canonical: dict[str, object],
    strava_metadata: Mapping[str, Mapping[str, str]],
) -> tuple[dict[str, str], list[dict[str, object]], str, str]:
    activity_id = str(canonical["activity_id"])
    imported = imported_route_from_spec(canonical, root)
    if imported is not None:
        source = {
            "activity_name": imported.name,
            "activity_type": imported.activity_type,
            "date": imported.date,
            "description": imported.description,
            "source_kind": "imported-gpx",
        }
        source_path = imported.path
    else:
        source = dict(strava_metadata[activity_id])
        source_path = find_strava_activity_file(activity_id)
        if source_path is None:
            raise OSError(f"route source unavailable for {activity_id}")

    provenance = build_route_provenance(load_source_route_points(source_path))
    route = [dict(point) for point in provenance.route]
    if not route:
        raise ValueError(f"route source is empty for {activity_id}")
    if canonical.get("lifecycle", "completed") == "discovered":
        route = [
            {key: value for key, value in point.items() if key != "elapsed_s"}
            for point in route
        ]
    region = str(
        canonical.get("region")
        or infer_route_region(route[0]["lat"], route[0]["lng"])
    )
    subtitle = str(canonical.get("title") or source["activity_name"]).strip()
    return source, route, region, subtitle


def _generation_state(root: Path) -> tuple[dict[str, object] | None, list[dict[str, str]]]:
    try:
        config = _read_json(root / "quests.json")
        manifest = _read_json(
            root / "app/src/data/generated/routes.manifest.json"
        )
        stats = _read_json(root / "app/src/data/generated/route-stats.json")
        if not isinstance(config, dict) or not isinstance(manifest, dict) or not isinstance(stats, dict):
            raise TypeError
        all_routes = config.get("routes", config.get("quests", []))
        if not isinstance(all_routes, list) or not all(
            isinstance(route, dict) for route in all_routes
        ):
            raise TypeError
        canonical_routes = [
            route
            for route in all_routes
            if route.get("status", "approved") == "approved"
            and route.get("visibility", "public") != "hidden"
        ]
        summary_routes = manifest["routes"]
        if not isinstance(summary_routes, list) or not all(
            isinstance(route, dict) for route in summary_routes
        ):
            raise TypeError
        canonical_ids = [str(route["activity_id"]) for route in canonical_routes]
        summary_ids = [str(route["activity_id"]) for route in summary_routes]
        summary_slugs = [str(route["slug"]) for route in summary_routes]
        detail_paths = sorted((root / "app/public/data/routes").glob("*.json"))
        details = [_read_json(path) for path in detail_paths]
        if not all(isinstance(detail, dict) for detail in details):
            raise TypeError
        detail_slugs = [path.stem for path in detail_paths]
        reported_count = stats["route_count"]
        reported_completed_km = stats["completed_km"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError, AttributeError):
        return None, [
            _issue(
                "GODIESEL_GENERATED_PROJECTION_UNREADABLE",
                "Canonical or generated route inventory could not be read.",
                "Restore the route data files, then rebuild through the Python generator.",
            )
        ]

    manifest_stats = manifest.get("stats")
    expected_manifest_stats = {
        "approved": len(canonical_routes),
        "pending": sum(1 for route in all_routes if route.get("status") == "pending"),
        "rejected": sum(1 for route in all_routes if route.get("status") == "rejected"),
        "total": len(all_routes),
    }
    generated_at_value = manifest.get("generated_at")
    generated_at_valid = (
        isinstance(generated_at_value, str)
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", generated_at_value)
        is not None
    )
    if generated_at_valid:
        try:
            datetime.strptime(generated_at_value, "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            generated_at_valid = False
    manifest_stats_valid = (
        isinstance(manifest_stats, dict)
        and set(manifest_stats) == set(expected_manifest_stats)
        and all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in manifest_stats.values()
        )
        and manifest_stats == expected_manifest_stats
    )
    inventory_current = (
        isinstance(manifest.get("schema_version"), int)
        and not isinstance(manifest.get("schema_version"), bool)
        and manifest.get("schema_version") == 1
        and generated_at_valid
        and manifest_stats_valid
        and len(canonical_ids) == len(set(canonical_ids))
        and len(summary_ids) == len(set(summary_ids))
        and len(summary_slugs) == len(set(summary_slugs))
        and set(canonical_ids) == set(summary_ids) == set(summary_slugs) == set(detail_slugs)
        and reported_count == len(summary_ids)
    )
    projection_current = inventory_current
    canonical_by_id = {str(route["activity_id"]): route for route in canonical_routes}
    summary_by_id = {str(route["activity_id"]): route for route in summary_routes}
    detail_by_slug = {path.stem: detail for path, detail in zip(detail_paths, details)}
    strava_metadata: dict[str, dict[str, str]] = {}
    if any(not route.get("source_gpx") for route in canonical_routes):
        try:
            strava_metadata = _strava_metadata()
        except (OSError, csv.Error):
            projection_current = False
    canonical_projection_fields = {
        "difficulty": ("difficulty",),
        "completion_rule": ("completion_rule",),
        "theme": ("theme",),
    }
    if inventory_current:
        for activity_id in canonical_ids:
            canonical = canonical_by_id[activity_id]
            summary = summary_by_id[activity_id]
            detail = detail_by_slug[activity_id]
            if (
                not valid_generated_projection(canonical, summary, detail)
                or summary.get("lifecycle")
                != canonical.get("lifecycle", "completed")
                or detail.get("lifecycle")
                != canonical.get("lifecycle", "completed")
            ):
                projection_current = False
                break
            try:
                expected_source, expected_route, expected_region, expected_subtitle = (
                    _source_projection(root, canonical, strava_metadata)
                )
            except (FitParseError, GPXException, KeyError, OSError, RuntimeError, ValueError):
                projection_current = False
                break
            source_fields = {
                "activity_name": "activity_name",
                "activity_type": "type",
                "date": "date",
                "description": "description",
                "source_kind": "source_kind",
            }
            if any(
                expected_source[source] is None
                or summary.get(generated) != expected_source[source]
                or detail.get(generated) != expected_source[source]
                for source, generated in source_fields.items()
            ):
                projection_current = False
                break
            if (
                detail.get("route") != expected_route
                or summary.get("region") != expected_region
                or detail.get("region") != expected_region
                or summary.get("name") != expected_region
                or detail.get("name") != expected_region
                or summary.get("subtitle") != expected_subtitle
                or detail.get("subtitle") != expected_subtitle
            ):
                projection_current = False
                break
            for source_field, generated_fields in canonical_projection_fields.items():
                if source_field not in canonical or canonical[source_field] in (None, ""):
                    continue
                expected = canonical[source_field]
                if any(
                    summary.get(field) != expected or detail.get(field) != expected
                    for field in generated_fields
                ):
                    projection_current = False
                    break
            if not projection_current:
                break
    expected_completed_km = completed_distance_km(details)
    numeric_state_valid = (
        isinstance(reported_count, int)
        and not isinstance(reported_count, bool)
        and isinstance(reported_completed_km, (int, float))
        and not isinstance(reported_completed_km, bool)
        and math.isfinite(float(reported_completed_km))
        and float(reported_completed_km) >= 0
        and expected_completed_km is not None
    )
    stats_current = numeric_state_valid and reported_completed_km == expected_completed_km
    current = inventory_current and projection_current and stats_current
    state = {
        "canonical_public_routes": len(canonical_ids),
        "generated_summary_routes": len(summary_ids),
        "generated_detail_routes": len(detail_slugs),
        "reported_route_count": reported_count,
        "reported_completed_km": reported_completed_km,
        "expected_completed_km": expected_completed_km,
        "inventory_state": "current" if current else "drifted",
        "recovery_state": (
            "pending"
            if (root / "app/public/data/.route-generation-backup").exists()
            else "clear"
        ),
    }
    blockers = []
    if not inventory_current:
        blockers.append(
            _issue(
                "GODIESEL_GENERATED_INVENTORY_DRIFT",
                "Canonical route identities and generated route inventories do not agree.",
                "Apply route-generation through the owning Python writer, then inspect again.",
            )
        )
    if inventory_current and not projection_current:
        blockers.append(
            _issue(
                "GODIESEL_GENERATED_PROJECTION_DRIFT",
                "Generated route fields do not agree with canonical route state.",
                "Apply route-generation through the owning Python writer, then inspect again.",
            )
        )
    if not stats_current:
        blockers.append(
            _issue(
                "GODIESEL_GENERATED_STATS_DRIFT",
                "Generated route statistics are invalid or disagree with route details.",
                "Apply route-generation through the owning Python writer, then inspect again.",
            )
        )
    return state, blockers


def _command_result(command: str, completed: subprocess.CompletedProcess[str]) -> dict[str, object]:
    output = (completed.stdout or "") + "\0" + (completed.stderr or "")
    return {
        "command": command,
        "command_exit_code": completed.returncode,
        "output_sha256": sha256(output.encode("utf-8", errors="surrogateescape")).hexdigest(),
    }


def _run_verification(
    root: Path,
    *,
    capability: str,
    command: list[str],
    display_command: str,
    tier: str,
    environ: Mapping[str, str],
    proof_environ: Mapping[str, str] | None = None,
    runner: Runner,
    inputs: list[dict[str, str]],
    result: Callable[[subprocess.CompletedProcess[str]], dict[str, object]],
    failure_code: str,
    failure_message: str,
    failure_remediation: str,
    provider_target: str | None = None,
    provider_identity: Mapping[str, object] | None = None,
    refresh_provider_identity: Callable[
        [], tuple[dict[str, object] | None, list[dict[str, str]]]
    ]
    | None = None,
    external_target: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        evidence_schema = _read_json(root / "system/evidence-receipt.schema.json")
        Draft202012Validator.check_schema(evidence_schema)
    except Exception:
        return _envelope(
            capability,
            "verify",
            "ephemeral-local",
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_EVIDENCE_SCHEMA_UNAVAILABLE",
                    "The evidence receipt schema could not be validated.",
                    "Restore system/evidence-receipt.schema.json before verification.",
                )
            ],
        )
    proof_environment = environ if proof_environ is None else proof_environ
    snapshot = build_proof_snapshot(
        root,
        capability,
        tiers=[tier],
        commands=[display_command],
        environ=proof_environment,
        provider_target=provider_target,
        provider_identity=provider_identity,
    )
    if snapshot["status"] != "passed":
        return _envelope(
            capability,
            "verify",
            "ephemeral-local",
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=list(snapshot["blockers"]),
        )

    monitor = ProofInputMonitor(root, snapshot)
    started_at = datetime.now(timezone.utc).isoformat()
    try:
        completed = runner(
            command,
            cwd=root,
            capture_output=True,
            text=True,
            env=dict(environ),
        )
    finally:
        transient_input_change = monitor.changed()
        monitor.close()
    finished_at = datetime.now(timezone.utc).isoformat()
    passed = completed.returncode == 0
    blockers = [] if passed else [
        _issue(failure_code, failure_message, failure_remediation)
    ]
    post_provider_identity = provider_identity
    post_identity_blockers: list[dict[str, str]] = []
    if refresh_provider_identity is not None:
        post_provider_identity, post_identity_blockers = refresh_provider_identity()
        if post_provider_identity != provider_identity:
            blockers.append(
                _issue(
                    "GODIESEL_PROVIDER_BUILD_IDENTITY_CHANGED",
                    "The deployed build identity changed while live verification was running.",
                    "Stabilize the named deployment and rerun the live provider gate.",
                )
            )
        elif post_identity_blockers:
            blockers.extend(post_identity_blockers)
    post_snapshot = build_proof_snapshot(
        root,
        capability,
        tiers=[tier],
        commands=[display_command],
        environ=proof_environment,
        provider_target=provider_target,
        provider_identity=post_provider_identity,
    )
    stability_blockers = proof_snapshot_stability_issues(snapshot, post_snapshot)
    if transient_input_change and not any(
        issue["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
        for issue in stability_blockers
    ):
        stability_blockers.append(
            _issue(
                "GODIESEL_VERIFICATION_INPUTS_CHANGED",
                "A covered input changed while the verification gate was running.",
                "Stabilize the worktree and rerun verification against one unchanged input set.",
            )
        )
    blockers.extend(stability_blockers)
    stable_inputs = not stability_blockers and not post_identity_blockers
    receipt_snapshot = post_snapshot if post_snapshot["status"] == "passed" else snapshot
    receipt_status = "failed" if not passed else "passed" if stable_inputs else "blocked"
    output = _command_result(display_command, completed)
    evidence = write_evidence_receipt(
        root,
        capability=capability,
        verb="verify",
        authority="ephemeral-local",
        started_at=started_at,
        finished_at=finished_at,
        status=receipt_status,
        inputs=inputs,
        covered_inputs=receipt_snapshot["covered_inputs"],
        proof_fingerprint=receipt_snapshot["proof_fingerprint"],
        selection={
            "mode": "explicit",
            "tiers": [tier],
            "impact_rules": receipt_snapshot["impact_rules"],
        },
        gates=[
            {
                "id": f"{capability}-check",
                "tier": gate["tier"],
                "command": gate["command"],
                "cwd": gate["cwd"],
                "provider": "live-provider" if tier == "live" else "deterministic-local",
                "started_at": started_at,
                "finished_at": finished_at,
                "status": "passed" if passed else "failed",
                "exit_code": completed.returncode,
                "output_sha256": str(output["output_sha256"]),
            }
            for gate in snapshot["gates"]
        ],
        configuration=receipt_snapshot["configuration"],
        warnings=[],
        external_target=external_target,
        safe_next_actions=[item["remediation"] for item in blockers],
    )
    if evidence is None:
        blockers.append(
            _issue(
                "GODIESEL_EVIDENCE_WRITE_FAILED",
                "Verification completed but its evidence receipt was not written.",
                "Repair the ignored .godiesel evidence directory before retrying.",
            )
        )
    envelope = _envelope(
        capability,
        "verify",
        "ephemeral-local",
        status="blocked" if blockers else "passed",
        authorized=True,
        result=result(completed),
        result_contract="godiesel_local_capabilities.py#command-summary",
        blockers=blockers,
        exit_code=0 if passed and stable_inputs and evidence is not None else 2,
    )
    envelope["evidence"] = evidence
    return envelope


def execute_route_generation(
    root: Path | str,
    verb: str,
    *,
    authority: str | None = None,
    environ: Mapping[str, str] | None = None,
    runner: Runner = subprocess.run,
) -> dict[str, Any]:
    """Inspect or invoke the sole full-catalogue route-data writer."""

    if verb not in GENERATION_AUTHORITY:
        raise ValueError(f"unsupported route-generation verb: {verb}")
    root = Path(root).resolve()
    required_authority = GENERATION_AUTHORITY[verb]
    if verb == "apply" and authority != required_authority:
        return _envelope(
            "route-generation",
            verb,
            required_authority,
            status="blocked",
            authorized=False,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_AUTHORITY_REQUIRED",
                    "apply requires explicit canonical-local authority for route-generation.",
                    "Review the generated-data effect, then repeat with --authorize canonical-local.",
                )
            ],
        )

    if verb == "inspect":
        state, blockers = _generation_state(root)
        return _envelope(
            "route-generation",
            verb,
            required_authority,
            status="blocked" if blockers else "passed",
            authorized=True,
            result=state,
            result_contract="godiesel_local_capabilities.py#route-generation-inspection",
            blockers=blockers,
        )

    process_env = dict(os.environ if environ is None else environ)
    if verb == "apply":
        command = [str(root / "rebuild.sh")]
        display_command = "./rebuild.sh"
    else:
        command = [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "test_godiesel_local_capabilities.py",
            "test_react_app.py",
        ]
        display_command = (
            "python -m pytest -q test_godiesel_local_capabilities.py "
            "test_react_app.py"
        )
        return _run_verification(
            root,
            capability="route-generation",
            command=command,
            display_command=display_command,
            tier="focused",
            environ=process_env,
            runner=runner,
            inputs=[
                {
                    "kind": "input",
                    "name": "capability-state",
                    "sha256": canonical_digest("route-generation"),
                }
            ],
            result=lambda completed: _command_result(display_command, completed),
            failure_code="GODIESEL_ROUTE_GENERATION_COMMAND_FAILED",
            failure_message="The existing route-generation verify command failed.",
            failure_remediation="Inspect the focused test output, correct the cause, and retry.",
        )
    completed = runner(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        env=process_env,
    )
    mutation_busy = (
        completed.returncode == 2
        and "Another catalogue mutation is in progress." in (completed.stderr or "")
    )
    if mutation_busy:
        return _envelope(
            "route-generation",
            verb,
            required_authority,
            status="blocked",
            authorized=True,
            result={"recovery_state": "not-started"},
            result_contract="godiesel_local_capabilities.py#route-generation-recovery",
            blockers=[
                _issue(
                    "GODIESEL_ROUTE_GENERATION_BUSY",
                    "Another catalogue mutation currently owns the generated-data write boundary.",
                    "Wait for the active catalogue mutation to finish, then inspect and retry generation.",
                )
            ],
        )
    blockers = [] if completed.returncode == 0 else [
        _issue(
            "GODIESEL_ROUTE_GENERATION_COMMAND_FAILED",
            f"The existing route-generation {verb} command failed.",
            "Inspect the writer or focused test output locally, correct the cause, and retry.",
        )
    ]
    return _envelope(
        "route-generation",
        verb,
        required_authority,
        status="blocked" if blockers else "passed",
        authorized=True,
        result=_command_result(display_command, completed),
        result_contract="godiesel_local_capabilities.py#command-summary",
        blockers=blockers,
        exit_code=completed.returncode if completed.returncode == 0 else 2,
    )


def _curation_state(root: Path) -> tuple[dict[str, object] | None, list[dict[str, str]]]:
    try:
        config = _read_json(root / "quests.json")
        if not isinstance(config, dict):
            raise TypeError
        routes = config.get("routes", config.get("quests", []))
        statuses = {"unset": 0, "draft": 0, "reviewed": 0, "published": 0}
        for route in routes:
            curation = route.get("curation")
            status = curation.get("review_status") if isinstance(curation, dict) else None
            statuses[status if status in statuses else "unset"] += 1
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        return None, [
            _issue(
                "GODIESEL_CURATION_STATE_UNREADABLE",
                "Canonical owner-curation state could not be read.",
                "Restore quests.json and rerun curation inspection.",
            )
        ]
    return {
        "writer_mode": "local-owner",
        "canonical_routes": len(routes),
        "curation_statuses": statuses,
    }, []


def _curation_observed_state(root: Path, activity_id: str) -> str:
    config = _read_json(root / "quests.json")
    if not isinstance(config, dict):
        raise ValueError("quests.json is not an object")
    matches = [
        route
        for route in config.get("routes", config.get("quests", []))
        if str(route.get("activity_id")) == activity_id
    ]
    if len(matches) != 1:
        raise ValueError("curation target must match exactly one canonical route")

    detail_path = root / "app/public/data/routes" / f"{activity_id}.json"
    detail = _read_json(detail_path) if detail_path.is_file() else None
    manifest_path = root / "app/src/data/generated/routes.manifest.json"
    manifest_route = None
    if manifest_path.is_file():
        manifest = _read_json(manifest_path)
        if not isinstance(manifest, dict):
            raise ValueError("generated manifest is not an object")
        manifest_matches = [
            route
            for route in manifest.get("routes", [])
            if str(route.get("slug")) == activity_id
        ]
        if len(manifest_matches) > 1:
            raise ValueError("curation target is duplicated in generated manifest")
        manifest_route = manifest_matches[0] if manifest_matches else None
    return canonical_digest(
        {
            "canonical_route": matches[0],
            "generated_detail": detail,
            "generated_summary": manifest_route,
        }
    )


CURATION_IMPLEMENTATION_PATHS = (
    "godiesel_local_capabilities.py",
    "admin_curation.py",
    "curation_publish.py",
    "quest_meta.py",
    "route_annotations.py",
    "build.py",
    "system/owner-curation-plan.schema.json",
)


def _curation_implementation_digest(root: Path) -> str:
    inputs = []
    for relative in CURATION_IMPLEMENTATION_PATHS:
        path = root / relative
        inputs.append(
            {
                "path": relative,
                "sha256": sha256(path.read_bytes()).hexdigest() if path.is_file() else None,
            }
        )
    return canonical_digest(inputs)


def _curation_plan_context(root: Path) -> dict[str, object]:
    return {
        "repository": repository_snapshot(root),
        "implementation_sha256": _curation_implementation_digest(root),
    }


def _curation_change_summary(
    root: Path,
    activity_id: str,
    curation: Mapping[str, Any],
) -> dict[str, object]:
    config = _read_json(root / "quests.json")
    route = next(
        route
        for route in config.get("routes", config.get("quests", []))
        if str(route.get("activity_id")) == activity_id
    )
    before = route.get("curation") if isinstance(route.get("curation"), dict) else {}
    fields = sorted(
        key for key in set(before) | set(curation) if before.get(key) != curation.get(key)
    )
    return {
        "changed_fields": fields,
        "review_status_before": before.get("review_status", "unset"),
        "review_status_after": curation["review_status"],
    }


def _plan_owner_curation(
    root: Path,
    request_path: Path | str | None,
) -> dict[str, Any]:
    try:
        if request_path is None:
            raise OSError
        request = _read_json(Path(request_path))
        if not isinstance(request, dict) or set(request) != {
            "schema_version",
            "document_type",
            "activity_id",
            "curation",
        }:
            raise ValueError
        if request["schema_version"] != 1 or request["document_type"] != "owner-curation-request":
            raise ValueError
        activity_id = str(request["activity_id"])
        if not activity_id:
            raise ValueError
        curation = build_route_curation(request["curation"])
        observed_state = _curation_observed_state(root, activity_id)
        change_summary = _curation_change_summary(root, activity_id, curation)
    except Exception:
        return _envelope(
            "owner-curation",
            "plan",
            "ephemeral-local",
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_CURATION_REQUEST_INVALID",
                    "The owner-curation request or its canonical target is invalid.",
                    "Provide one closed owner-curation request for an existing route.",
                )
            ],
        )
    plan = {
        "schema_version": 1,
        "document_type": "owner-curation-plan",
        "activity_id": activity_id,
        "curation": curation,
        "observed_state_sha256": observed_state,
        "context": _curation_plan_context(root),
        "change_summary": change_summary,
        "publication_strategy": "incremental-with-full-generation-fallback",
        "intended_writes": [
            "quests.json",
            "app/src/data/generated/routes.manifest.json",
            "app/src/data/generated/route-stats.json",
            "app/public/data/routes/**",
        ],
        "external_effects": [],
        "verification_requirements": [
            "python -m pytest -q test_godiesel_local_capabilities.py test_admin_curation.py test_curation_publish.py"
        ],
        "warnings": [],
        "blockers": [],
    }
    plan["plan_digest"] = canonical_digest(plan)
    relative_path = (
        Path(".godiesel/plans/owner-curation") / f"{plan['plan_digest']}.json"
    )
    (root / relative_path).parent.mkdir(parents=True, exist_ok=True)
    write_atomic(
        root / relative_path,
        json.dumps(plan, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )
    return _envelope(
        "owner-curation",
        "plan",
        "ephemeral-local",
        status="passed",
        authorized=True,
        result={"plan": plan, "plan_path": relative_path.as_posix()},
        result_contract="godiesel_local_capabilities.py#owner-curation-plan-result",
    )


def _load_curation_plan(root: Path, plan_path: Path | str | None) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    try:
        if plan_path is None:
            raise OSError
        plan = _read_json(Path(plan_path))
        schema = _read_json(root / "system/owner-curation-plan.schema.json")
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(plan)
        if not isinstance(plan, dict):
            raise TypeError
        plan = dict(plan)
        declared_digest = plan.pop("plan_digest")
        if canonical_digest(plan) != declared_digest:
            raise ValueError
        plan["plan_digest"] = declared_digest
        normalized = build_route_curation(plan["curation"])
        if normalized != plan["curation"]:
            raise ValueError
    except Exception:
        return None, [
            _issue(
                "GODIESEL_CURATION_PLAN_INVALID",
                "The owner-curation plan is missing, unreadable, or invalid.",
                "Create a schema-valid owner-curation plan and review it before applying.",
            )
        ]
    try:
        current_context = _curation_plan_context(root)
        planned_context = plan["context"]
        current_repository = current_context["repository"]
        planned_repository = planned_context["repository"]
        stable_context_matches = (
            current_context["implementation_sha256"]
            == planned_context["implementation_sha256"]
            and all(
                current_repository[key] == planned_repository[key]
                for key in ("commit", "branch", "worktree_sha256")
            )
        )
        fully_matches = stable_context_matches and (
            current_repository["dirty_state"] == planned_repository["dirty_state"]
        )
        if not stable_context_matches:
            return None, [
                _issue(
                    "GODIESEL_CURATION_PLAN_CONTEXT_MISMATCH",
                    "The curation plan was created for a different checkout or implementation state.",
                    "Create and review a fresh curation plan in this exact checkout.",
                )
            ]
        current_state = _curation_observed_state(root, str(plan["activity_id"]))
    except Exception:
        current_state = None
        fully_matches = False
    if not fully_matches or current_state != plan["observed_state_sha256"]:
        if _curation_is_applied(root, str(plan["activity_id"]), plan["curation"]):
            plan["_already_applied"] = True
            return plan, []
        if not fully_matches:
            return None, [
                _issue(
                    "GODIESEL_CURATION_PLAN_CONTEXT_MISMATCH",
                    "Repository state changed after curation planning.",
                    "Create and review a fresh curation plan in this exact checkout.",
                )
            ]
        return None, [
            _issue(
                "GODIESEL_CURATION_PLAN_STALE",
                "Canonical or generated route state changed after curation planning.",
                "Inspect the current route and create a new owner-curation plan.",
            )
        ]
    return plan, []


def _curation_is_applied(root: Path, activity_id: str, curation: Mapping[str, Any]) -> bool:
    try:
        config = _read_json(root / "quests.json")
        matching = [
            route
            for route in config.get("routes", config.get("quests", []))
            if str(route.get("activity_id")) == activity_id
        ]
        if len(matching) != 1 or matching[0].get("curation") != curation:
            return False
        requires_projection = (
            matching[0].get("status", "approved") == "approved"
            and matching[0].get("visibility", "public") != "hidden"
        )
        detail_path = root / "app/public/data/routes" / f"{activity_id}.json"
        if requires_projection and not detail_path.is_file():
            return False
        if detail_path.is_file() and _read_json(detail_path).get("curation") != curation:
            return False
        manifest_path = root / "app/src/data/generated/routes.manifest.json"
        if requires_projection and not manifest_path.is_file():
            return False
        summaries = []
        if manifest_path.is_file():
            manifest = _read_json(manifest_path)
            summaries = [
                route
                for route in manifest.get("routes", [])
                if str(route.get("slug")) == activity_id
            ]
        if requires_projection and len(summaries) != 1:
            return False
        if summaries and (
            len(summaries) != 1
            or summaries[0].get("guide_preview") != route_guide_preview(curation)
        ):
            return False
        _, generation_blockers = _generation_state(root)
        if generation_blockers:
            return False
    except (OSError, json.JSONDecodeError, AttributeError, TypeError, ValueError):
        return False
    return True


def execute_owner_curation(
    root: Path | str,
    verb: str,
    *,
    request_path: Path | str | None = None,
    plan_path: Path | str | None = None,
    authority: str | None = None,
    environ: Mapping[str, str] | None = None,
    runner: Runner = subprocess.run,
) -> dict[str, Any]:
    """Inspect or invoke the local owner-curation writer and recovery path."""

    if verb not in CURATION_AUTHORITY:
        raise ValueError(f"unsupported owner-curation verb: {verb}")
    root = Path(root).resolve()
    required_authority = CURATION_AUTHORITY[verb]
    if verb == "apply" and authority != required_authority:
        return _envelope(
            "owner-curation",
            verb,
            required_authority,
            status="blocked",
            authorized=False,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_AUTHORITY_REQUIRED",
                    "apply requires explicit canonical-local authority for owner-curation.",
                    "Review the curation plan, then repeat with --authorize canonical-local.",
                )
            ],
        )
    if verb == "inspect":
        state, blockers = _curation_state(root)
        return _envelope(
            "owner-curation",
            verb,
            required_authority,
            status="blocked" if blockers else "passed",
            authorized=True,
            result=state,
            result_contract="godiesel_local_capabilities.py#owner-curation-inspection",
            blockers=blockers,
        )
    if verb == "plan":
        return _plan_owner_curation(root, request_path)
    if verb == "verify":
        command = [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "test_godiesel_local_capabilities.py",
            "test_admin_curation.py",
            "test_curation_publish.py",
        ]
        display_command = (
            "python -m pytest -q test_godiesel_local_capabilities.py "
            "test_admin_curation.py test_curation_publish.py"
        )
        return _run_verification(
            root,
            capability="owner-curation",
            command=command,
            display_command=display_command,
            tier="focused",
            environ=dict(os.environ if environ is None else environ),
            runner=runner,
            inputs=[
                {
                    "kind": "input",
                    "name": "capability-state",
                    "sha256": canonical_digest("owner-curation"),
                }
            ],
            result=lambda completed: _command_result(display_command, completed),
            failure_code="GODIESEL_OWNER_CURATION_COMMAND_FAILED",
            failure_message="The existing owner-curation verification command failed.",
            failure_remediation="Inspect the focused recovery test output, correct the cause, and retry.",
        )

    try:
        with owner_mutation_lock(root):
            plan, blockers = _load_curation_plan(root, plan_path)
            if blockers or plan is None:
                return _envelope(
                    "owner-curation",
                    verb,
                    required_authority,
                    status="blocked",
                    authorized=True,
                    result=None,
                    result_contract="system/owner-curation-plan.schema.json",
                    blockers=blockers,
                )
            already_applied = bool(plan.pop("_already_applied", False))
            if not already_applied:
                save_owner_curation(
                    root,
                    plan["activity_id"],
                    plan["curation"],
                    acquire_lock=False,
                )
            generation_state, generation_blockers = _generation_state(root)
            if generation_blockers:
                return _envelope(
                    "owner-curation",
                    verb,
                    required_authority,
                    status="blocked",
                    authorized=True,
                    result={
                        "recovery_state": "source-published",
                        "generation_state": generation_state,
                    },
                    result_contract="godiesel_local_capabilities.py#owner-curation-recovery",
                    blockers=[
                        _issue(
                            "GODIESEL_CURATION_PROJECTION_INCOMPLETE",
                            "Owner curation was saved but the complete public projection is not ready.",
                            "Run route generation through the owning writer, inspect the projection, then retry.",
                        ),
                        *generation_blockers,
                    ],
                )
    except OwnerMutationBusyError:
        return _envelope(
            "owner-curation",
            verb,
            required_authority,
            status="blocked",
            authorized=True,
            result={"recovery_state": "not-started"},
            result_contract="godiesel_local_capabilities.py#owner-curation-recovery",
            blockers=[
                _issue(
                    "GODIESEL_OWNER_MUTATION_BUSY",
                    "Another owner mutation currently owns the canonical write boundary.",
                    "Wait for the active owner mutation to finish, then create or apply a fresh plan.",
                )
            ],
        )
    except (CurationRecoveryError, SourceRollbackError) as error:
        return _envelope(
            "owner-curation",
            verb,
            required_authority,
            status="blocked",
            authorized=True,
            result={"recovery_state": "manual-required", "error_type": type(error).__name__},
            result_contract="godiesel_local_capabilities.py#owner-curation-recovery",
            blockers=[
                _issue(
                    "GODIESEL_CURATION_RECOVERY_REQUIRED",
                    "Owner curation could not be published or fully recovered automatically.",
                    "Inspect the preserved recovery files named by the writer before retrying.",
                )
            ],
        )
    except Exception as error:
        return _envelope(
            "owner-curation",
            verb,
            required_authority,
            status="blocked",
            authorized=True,
            result={"recovery_state": "source-restored", "error_type": type(error).__name__},
            result_contract="godiesel_local_capabilities.py#owner-curation-recovery",
            blockers=[
                _issue(
                    "GODIESEL_OWNER_CURATION_COMMAND_FAILED",
                    "The owner-curation writer refused or failed to publish the plan.",
                    "Inspect the local writer error, correct the plan or generated state, and retry.",
                )
            ],
        )
    return _envelope(
        "owner-curation",
        verb,
        required_authority,
        status="passed",
        authorized=True,
        result={
            "activity_id": str(plan["activity_id"]),
            "review_status": plan["curation"]["review_status"],
            "generation_status": "ready",
            "plan_digest": plan["plan_digest"],
            "already_applied": already_applied,
        },
        result_contract="godiesel_local_capabilities.py#owner-curation-apply",
    )


def inspect_planned_route_persistence(root: Path | str) -> dict[str, Any]:
    """Describe browser-owned planning state without pretending to read it."""

    root = Path(root).resolve()
    try:
        source = (root / "app/src/data/planned-route-store.ts").read_text(
            encoding="utf-8"
        )
        storage_key = re.search(
            r'export const PLANNED_ROUTE_STORAGE_KEY = "([^"]+)";', source
        ).group(1)
        store_version = int(
            re.search(r"const STORE_VERSION = ([0-9]+) as const;", source).group(1)
        )
    except (OSError, AttributeError, ValueError):
        return _envelope(
            "planned-route-persistence",
            "inspect",
            "read-only",
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_PLANNED_ROUTE_CONTRACT_UNREADABLE",
                    "The browser-owned planned-route storage metadata could not be read.",
                    "Restore the exported storage key and version in planned-route-store.ts.",
                )
            ],
        )
    warning = _issue(
        "GODIESEL_BROWSER_STATE_NOT_OBSERVED",
        "Planned-route state belongs to the active browser profile and was not observed.",
        "Inspect the application in the intended browser profile to observe current planned routes.",
    )
    return _envelope(
        "planned-route-persistence",
        "inspect",
        "read-only",
        status="warning",
        authorized=True,
        result={
            "runtime_owner": "browser-local-storage",
            "storage_key": storage_key,
            "store_version": store_version,
            "inspection_state": "unavailable-from-repository-process",
            "planned_route_count": None,
            "canonical_projection": "none",
        },
        result_contract="app/src/data/planned-route-store.ts#persistence-boundary",
        warnings=[warning],
    )


def _env_file_values(root: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for candidate in (root / ".env", root / "app/.env"):
        try:
            lines = candidate.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            name, value = line.split("=", 1)
            name = name.removeprefix("export ").strip()
            value = value.strip().strip("'\"")
            if name and value:
                values[name] = value
    return values


def _configuration_present(
    root: Path,
    environ: Mapping[str, str],
    name: str,
) -> bool:
    aliases = (
        ("GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_API_KEY")
        if name == "GOOGLE_MAPS_API_KEY"
        else (name,)
    )
    file_values = _env_file_values(root)
    return any(bool(environ.get(alias) or file_values.get(alias)) for alias in aliases)


def provider_proof_environment(
    root: Path | str,
    environ: Mapping[str, str],
) -> dict[str, str]:
    """Return configuration presence for proof without copying file secret values."""

    root = Path(root).resolve()
    proof_environ = dict(environ)
    if (
        _configuration_present(root, proof_environ, "GOOGLE_MAPS_API_KEY")
        and not proof_environ.get("GOOGLE_MAPS_API_KEY")
    ):
        proof_environ["GOOGLE_MAPS_API_KEY"] = "configured-without-value"
    return proof_environ


def _provider_inventory(root: Path, environ: Mapping[str, str]) -> list[dict[str, object]]:
    providers = [
        {
            "id": provider_id,
            "loader": details["loader"],
            "configuration": details["configuration"],
            "configuration_state": (
                "configured"
                if _configuration_present(root, environ, str(details["configuration"]))
                else "missing"
            ),
            "provider_state": "not_run",
            "live_check": " ".join(details["command"]),
        }
        for provider_id, details in sorted(PROVIDER_CHECKS.items())
    ]
    providers.append(
        {
            "id": "earth-engine",
            "loader": "earth_engine_enrich.py",
            "configuration": "GODIESEL_EARTH_ENGINE_PROJECT",
            "configuration_state": (
                "configured"
                if _configuration_present(root, environ, "GODIESEL_EARTH_ENGINE_PROJECT")
                else "missing"
            ),
            "provider_state": "not_run",
            "live_check": "npm --prefix app run verify:live-pipeline",
        }
    )
    return providers


def _valid_provider_target(value: str | None) -> bool:
    if value is None:
        return False
    parsed = urlparse(value)
    return (
        parsed.scheme in {"http", "https"}
        and bool(parsed.netloc)
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )


def execute_provider_readiness(
    root: Path | str,
    verb: str,
    *,
    provider: str | None = None,
    provider_target: str | None = None,
    environ: Mapping[str, str] | None = None,
    runner: Runner = subprocess.run,
    target_identity_reader: TargetIdentityReader = read_target_build_identity,
    repository_reader: RepositoryReader = repository_snapshot,
) -> dict[str, Any]:
    """Inspect provider configuration or run one explicit existing live check."""

    if verb not in PROVIDER_AUTHORITY:
        raise ValueError(f"unsupported provider-readiness verb: {verb}")
    root = Path(root).resolve()
    process_env = dict(os.environ if environ is None else environ)
    authority = PROVIDER_AUTHORITY[verb]
    if verb == "inspect":
        providers = _provider_inventory(root, process_env)
        missing = [item["id"] for item in providers if item["configuration_state"] == "missing"]
        warnings = [] if not missing else [
            _issue(
                "GODIESEL_PROVIDER_CONFIGURATION_MISSING",
                f"Configuration is missing for {len(missing)} provider readiness target(s).",
                "Configure only the providers needed for the intended live claim, then inspect again.",
            )
        ]
        return _envelope(
            "provider-readiness",
            verb,
            authority,
            status="warning" if warnings else "passed",
            authorized=True,
            result={"providers": providers},
            result_contract="godiesel_local_capabilities.py#provider-readiness-inspection",
            warnings=warnings,
        )

    if provider not in PROVIDER_CHECKS:
        return _envelope(
            "provider-readiness",
            verb,
            authority,
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_PROVIDER_UNKNOWN",
                    "Provider verification requires atlas, earth-replay, or google-3d.",
                    "Inspect provider readiness and select one named live-check target.",
                )
            ],
        )
    if not _valid_provider_target(provider_target):
        return _envelope(
            "provider-readiness",
            verb,
            authority,
            status="blocked",
            authorized=True,
            result=None,
            result_contract="none",
            blockers=[
                _issue(
                    "GODIESEL_PROVIDER_TARGET_REQUIRED",
                    "Live provider verification requires an explicit credential-free HTTP target.",
                    "Supply the exact preview or localhost URL with --provider-target.",
                )
            ],
        )
    details = PROVIDER_CHECKS[provider]
    configuration = str(details["configuration"])
    configured = _configuration_present(root, process_env, configuration)
    if not configured:
        return _envelope(
            "provider-readiness",
            verb,
            authority,
            status="blocked",
            authorized=True,
            result={
                "provider": provider,
                "provider_target": provider_target,
                "configuration_state": "missing",
                "provider_state": "not_run",
            },
            result_contract="godiesel_local_capabilities.py#provider-verification",
            blockers=[
                _issue(
                    "GODIESEL_PROVIDER_CONFIGURATION_MISSING",
                    f"Configuration {configuration} is required for {provider} live verification.",
                    f"Configure {configuration} without exposing its value, then retry.",
                )
            ],
        )
    build_identity, identity_blockers = verified_provider_build_identity(
        root,
        str(provider_target),
        target_identity_reader=target_identity_reader,
        repository_reader=repository_reader,
    )
    if identity_blockers or build_identity is None:
        return _envelope(
            "provider-readiness",
            verb,
            authority,
            status="blocked",
            authorized=True,
            result={
                "provider": provider,
                "provider_target": provider_target,
                "configuration_state": "configured",
                "provider_state": "not_run",
            },
            result_contract="godiesel_local_capabilities.py#provider-verification",
            blockers=identity_blockers,
        )
    command = list(details["command"])
    process_env["GODIESEL_ATLAS_PREVIEW_URL"] = str(provider_target)
    proof_env = provider_proof_environment(root, process_env)
    display_command = " ".join(command)
    return _run_verification(
        root,
        capability="provider-readiness",
        command=command,
        display_command=display_command,
        tier="live",
        environ=process_env,
        proof_environ=proof_env,
        runner=runner,
        inputs=[
            {"kind": "provider", "name": "provider", "sha256": canonical_digest(provider)},
            {
                "kind": "provider",
                "name": "provider-target",
                "sha256": canonical_digest(provider_target),
            },
            {
                "kind": "provider",
                "name": "deployed-build",
                "sha256": canonical_digest(build_identity),
            },
        ],
        result=lambda completed: {
            "provider": provider,
            "provider_target": provider_target,
            "configuration_state": "configured",
            "provider_state": "passed" if completed.returncode == 0 else "failed",
            "build_identity": build_identity,
            "command": display_command,
            "command_exit_code": completed.returncode,
        },
        failure_code="GODIESEL_PROVIDER_CHECK_FAILED",
        failure_message=f"The existing {provider} live provider check failed.",
        failure_remediation="Inspect the retained Playwright evidence and provider response before retrying.",
        provider_target=provider_target,
        provider_identity=build_identity,
        refresh_provider_identity=lambda: verified_provider_build_identity(
            root,
            str(provider_target),
            target_identity_reader=target_identity_reader,
            repository_reader=repository_reader,
        ),
        external_target={
            "kind": provider,
            "name_sha256": canonical_digest(provider_target),
            "immutable_id": str(build_identity["build_id"]),
        },
    )
