"""Five-verb route-share adapter over the established domain workflow."""

from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Mapping

from jsonschema import Draft202012Validator

from jsonschema.exceptions import SchemaError

from admin_curation import OwnerMutationBusyError, owner_mutation_lock
from godiesel_evidence import (
    canonical_digest,
    ensure_local_directory,
    existing_local_directory,
    unlink_local_file,
    write_local_text_atomic,
    write_evidence_receipt,
)
from godiesel_verification import (
    ProofInputMonitor,
    build_proof_snapshot,
    catalogue_recovery_monitor,
    proof_snapshot_stability_issues,
    route_generation_recovery_state,
    reuse_verification,
)


SCHEMA_VERSION = 1
AUTHORITY = {
    "inspect": "read-only",
    "plan": "ephemeral-local",
    "apply": "canonical-local",
    "verify": "ephemeral-local",
    "release": "external-durable",
}
EFFECTFUL_AUTHORITY = {"apply", "release"}
Runner = Callable[..., subprocess.CompletedProcess[str]]


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def _canonical_digest(value: object) -> str:
    return canonical_digest(value)


def _json_value(value: str) -> object | None:
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _domain_result(completed: subprocess.CompletedProcess[str]) -> object:
    for candidate in (completed.stdout, completed.stderr):
        parsed = _json_value(candidate)
        if parsed is not None:
            return parsed
    return {"stdout": completed.stdout, "stderr": completed.stderr}


def _read_mapping(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _read_json_file(path: Path) -> tuple[bool, object]:
    try:
        return True, json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, None


def _proposal_metadata(value: Mapping[str, Any]) -> tuple[str | None, str | None]:
    route_spec = value.get("route_spec")
    slug = route_spec.get("activity_id") if isinstance(route_spec, dict) else None
    proposal_id = value.get("proposal_id")
    return (
        str(proposal_id) if proposal_id is not None else None,
        str(slug) if slug is not None else None,
    )


def _release_target(
    output: str,
    share_name: str | None,
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    if share_name is None:
        return None, []
    stable_alias = f"https://share-{share_name}.godiesel.pages.dev/"
    records = [
        line.removeprefix("GODIESEL_RELEASE_TARGET=")
        for line in output.splitlines()
        if line.startswith("GODIESEL_RELEASE_TARGET=")
    ]
    try:
        if len(records) != 1:
            raise ValueError
        target = json.loads(records[0])
        immutable = target["immutable_deployment_url"]
        if (
            set(target)
            != {
                "immutable_deployment_url",
                "stable_alias",
                "commit",
                "tree",
                "build_id",
                "artifact_manifest_sha256",
                "smoke_status",
            }
            or target["stable_alias"] != stable_alias
            or target["smoke_status"] != "passed"
            or not isinstance(immutable, str)
            or re.fullmatch(
                r"https://(?!share-)[A-Za-z0-9-]+\.godiesel\.pages\.dev/",
                immutable,
            )
            is None
            or re.fullmatch(r"[a-f0-9]{40}", target["commit"]) is None
            or re.fullmatch(r"[a-f0-9]{40}", target["tree"]) is None
            or re.fullmatch(
                r"[a-f0-9]{64}", target["artifact_manifest_sha256"]
            )
            is None
        ):
            raise ValueError
        uuid.UUID(target["build_id"])
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return (
            {"stable_alias": stable_alias},
            [
                _issue(
                    "GODIESEL_RELEASE_EVIDENCE_INCOMPLETE",
                    "The release command completed without exposing its immutable deployment URL.",
                    "Inspect the named Cloudflare deployment and complete the evidence before any retry or handoff.",
                )
            ],
        )
    return {
        **target,
        "guide_url": f"{stable_alias}#/routes/{{route_slug}}",
        "replay_url": f"{stable_alias}#/replay/{{route_slug}}",
    }, []


def _release_observation(output: str, share_name: str | None) -> dict[str, Any] | None:
    """Parse a deployment observed before post-upload verification completed."""

    if share_name is None:
        return None
    records = [
        line.removeprefix("GODIESEL_RELEASE_OBSERVED=")
        for line in output.splitlines()
        if line.startswith("GODIESEL_RELEASE_OBSERVED=")
    ]
    try:
        if len(records) != 1:
            return None
        observed = json.loads(records[0])
        stable_alias = f"https://share-{share_name}.godiesel.pages.dev/"
        immutable = observed["immutable_deployment_url"]
        if (
            set(observed)
            != {"immutable_deployment_url", "stable_alias", "external_status"}
            or observed["stable_alias"] != stable_alias
            or observed["external_status"] != "externally-unknown"
            or not isinstance(immutable, str)
            or re.fullmatch(
                r"https://(?!share-)[A-Za-z0-9-]+\.godiesel\.pages\.dev/",
                immutable,
            )
            is None
        ):
            return None
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    return dict(observed)


def _receipt_records(root: Path, receipt_root: Path) -> list[tuple[Path, dict[str, Any]]]:
    records: list[tuple[Path, dict[str, Any]]] = []
    safe_root = existing_local_directory(root, receipt_root.relative_to(root))
    if safe_root is None:
        return records
    for path in sorted(safe_root.glob("*.json")):
        if path.is_symlink() or not path.is_file():
            continue
        value = _read_mapping(path)
        if value:
            records.append((path, value))
    return sorted(
        records,
        key=lambda item: (str(item[1].get("created_at", "")), item[0].name),
    )


def _contained_artifact_path(
    root: Path,
    relative_path: object,
    expected_directory: Path,
) -> Path | None:
    if not isinstance(relative_path, str):
        return None
    normalized = Path(relative_path)
    if normalized.is_absolute() or ".." in normalized.parts:
        return None
    try:
        normalized.relative_to(expected_directory)
    except ValueError:
        return None
    directory = existing_local_directory(root, expected_directory)
    if directory is None:
        return None
    candidate = root / normalized
    current = root
    try:
        for part in normalized.parts:
            current = current / part
            if current.is_symlink():
                return None
    except OSError:
        return None
    try:
        candidate.resolve().relative_to(directory)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def _receipt_integrity_valid(
    root: Path,
    path: Path,
    receipt: Mapping[str, Any],
    records_by_path: Mapping[str, Mapping[str, Any]],
    validator: Draft202012Validator,
) -> bool:
    if not validator.is_valid(receipt):
        return False
    result_artifact = receipt.get("result_artifact")
    if not isinstance(result_artifact, dict):
        return False
    result_path = _contained_artifact_path(
        root,
        result_artifact.get("path"),
        Path(".route-share/results"),
    )
    if result_path is None:
        return False
    result_readable, domain_result = _read_json_file(result_path)
    if not result_readable:
        return False
    result_digest = _canonical_digest(domain_result)
    if result_digest != receipt.get("result_sha256"):
        return False
    if result_digest != result_artifact.get("sha256"):
        return False

    if receipt.get("verb") == "plan":
        proposal = receipt.get("proposal")
        if not isinstance(proposal, dict):
            return False
        proposal_path = _contained_artifact_path(
            root,
            proposal.get("path"),
            Path(".route-share/proposals"),
        )
        if proposal_path is None:
            return False
        proposal_readable, proposal_value = _read_json_file(proposal_path)
        if not proposal_readable or not isinstance(proposal_value, dict):
            return False
        proposal_digest = _canonical_digest(proposal_value)
        if proposal_digest != proposal.get("sha256"):
            return False
        if proposal_digest != receipt.get("proposal_sha256"):
            return False
        proposal_id, proposal_slug = _proposal_metadata(proposal_value)
        if proposal_id != proposal.get("id"):
            return False
        if proposal_slug != receipt.get("route_slug"):
            return False

    for link in receipt.get("lineage", []):
        linked = records_by_path.get(link.get("path"))
        if linked is None:
            return False
        if any(
            link.get(key) != linked.get(key)
            for key in ("receipt_id", "verb", "outcome", "result_sha256")
        ):
            return False

    try:
        path.relative_to(root / ".route-share" / "runs")
    except ValueError:
        return False
    return True


def _lineage_paths(receipt: Mapping[str, Any]) -> set[str]:
    return {
        str(link["path"])
        for link in receipt.get("lineage", [])
        if isinstance(link, dict) and isinstance(link.get("path"), str)
    }


def _release_lineage_state(
    root: Path,
    receipt_root: Path,
    route_slug: str | None,
) -> str:
    if route_slug is None:
        return "missing"
    records = _receipt_records(root, receipt_root)
    records_by_path = {
        path.relative_to(root).as_posix(): value for path, value in records
    }
    schema = _read_mapping(root / "system" / "route-share-receipt.schema.json")
    try:
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
    except Exception:
        return "invalid" if records else "missing"

    def matches(value: Mapping[str, Any], verb: str, digest: object) -> bool:
        return (
            value.get("verb") == verb
            and value.get("route_slug") == route_slug
            and value.get("outcome") == "passed"
            and value.get("proposal_sha256") == digest
            and isinstance(digest, str)
        )

    structural_chain_found = False
    for verify_index in range(len(records) - 1, -1, -1):
        verify_path, verify_receipt = records[verify_index]
        digest = verify_receipt.get("proposal_sha256")
        if not matches(verify_receipt, "verify", digest):
            continue
        for apply_index in range(verify_index - 1, -1, -1):
            apply_path, apply_receipt = records[apply_index]
            if not matches(apply_receipt, "apply", digest):
                continue
            for plan_index in range(apply_index - 1, -1, -1):
                plan_path, plan_receipt = records[plan_index]
                if not matches(plan_receipt, "plan", digest):
                    continue
                structural_chain_found = True
                chain = (
                    (plan_path, plan_receipt),
                    (apply_path, apply_receipt),
                    (verify_path, verify_receipt),
                )
                if not all(
                    _receipt_integrity_valid(
                        root,
                        receipt_path,
                        receipt,
                        records_by_path,
                        validator,
                    )
                    for receipt_path, receipt in chain
                ):
                    continue
                plan_relative = plan_path.relative_to(root).as_posix()
                apply_relative = apply_path.relative_to(root).as_posix()
                if plan_relative not in _lineage_paths(apply_receipt):
                    continue
                if not {plan_relative, apply_relative}.issubset(
                    _lineage_paths(verify_receipt)
                ):
                    continue
                plan_proposal = plan_receipt.get("proposal")
                apply_proposal = apply_receipt.get("proposal")
                if not isinstance(plan_proposal, dict) or not isinstance(
                    apply_proposal,
                    dict,
                ):
                    continue
                if apply_proposal.get("id") != plan_proposal.get("id"):
                    continue
                if apply_proposal.get("sha256") != digest:
                    continue
                return "ready"
    return "invalid" if structural_chain_found else "missing"


def _lineage_context(
    root: Path,
    receipt_root: Path,
    *,
    verb: str,
    proposal_sha256: str | None,
    route_slug: str | None,
) -> tuple[str | None, list[dict[str, Any]]]:
    records = _receipt_records(root, receipt_root)
    if proposal_sha256 is None and route_slug is not None:
        predecessor = "apply" if verb == "verify" else "verify" if verb == "release" else None
        if predecessor is not None:
            candidates = [
                value
                for _, value in records
                if value.get("verb") == predecessor
                and value.get("route_slug") == route_slug
                and value.get("outcome") == "passed"
            ]
            if candidates:
                candidate_digest = candidates[-1].get("proposal_sha256")
                if isinstance(candidate_digest, str):
                    proposal_sha256 = candidate_digest

    selected: list[tuple[Path, dict[str, Any]]] = []
    if proposal_sha256 is not None:
        selected = [
            (path, value)
            for path, value in records
            if value.get("proposal_sha256") == proposal_sha256
        ]
    elif verb == "release" and route_slug is not None:
        candidates = [
            (path, value)
            for path, value in records
            if value.get("verb") == "verify"
            and value.get("route_slug") == route_slug
            and value.get("outcome") == "passed"
        ]
        selected = candidates[-1:]

    lineage: list[dict[str, Any]] = []
    for path, value in selected:
        receipt_id = value.get("receipt_id")
        linked_verb = value.get("verb")
        result_digest = value.get("result_sha256")
        outcome = value.get("outcome")
        if not all(isinstance(item, str) for item in (receipt_id, linked_verb, result_digest, outcome)):
            continue
        lineage.append(
            {
                "receipt_id": receipt_id,
                "verb": linked_verb,
                "outcome": outcome,
                "path": path.relative_to(root).as_posix(),
                "result_sha256": result_digest,
            }
        )
    return proposal_sha256, lineage


def _write_receipt(
    root: Path,
    *,
    verb: str,
    authority: str,
    exit_code: int,
    outcome: str,
    domain_result: object,
    proposal: Mapping[str, Any],
    route_slug: str | None,
    release_target: Mapping[str, Any] | None,
    verification_mode: str | None,
) -> dict[str, str]:
    result_digest = _canonical_digest(domain_result)
    proposal_id, proposal_slug = _proposal_metadata(proposal)
    route_slug = route_slug or proposal_slug
    receipt_root = root / ".route-share" / "runs"
    proposal_digest = _canonical_digest(proposal) if proposal_id is not None else None
    proposal_digest, lineage = _lineage_context(
        root,
        receipt_root,
        verb=verb,
        proposal_sha256=proposal_digest,
        route_slug=route_slug,
    )
    now = datetime.now(timezone.utc)
    created_at = now.isoformat()
    receipt_id = (
        now.strftime("%Y%m%dT%H%M%S%fZ")
        + "-"
        + uuid.uuid4().hex[:12]
    )
    receipt: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-route-share-receipt",
        "receipt_id": receipt_id,
        "created_at": created_at,
        "capability": "route-share",
        "verb": verb,
        "authority": authority,
        "outcome": outcome,
        "exit_code": exit_code,
        "result_sha256": result_digest,
        "lineage": lineage,
    }
    if route_slug is not None:
        receipt["route_slug"] = route_slug
    if proposal_digest is not None:
        receipt["proposal_sha256"] = proposal_digest
    if proposal_id is not None:
        receipt["proposal"] = {
            "id": proposal_id,
            "sha256": proposal_digest,
        }
    if verb == "apply" and isinstance(domain_result, dict):
        creation_result = domain_result.get("result")
        if isinstance(creation_result, str):
            receipt["creation_report"] = {
                "result": creation_result,
                "sha256": result_digest,
            }
    if verb == "verify":
        receipt["verification"] = {
            "mode": verification_mode or "check",
            "sha256": result_digest,
        }
    if release_target is not None:
        target = dict(release_target)
        for key in ("guide_url", "replay_url"):
            if isinstance(target.get(key), str) and route_slug is not None:
                target[key] = target[key].format(route_slug=route_slug)
        receipt["release_target"] = target

    relative_evidence = Path(".route-share") / "results" / f"{receipt_id}.json"
    write_local_text_atomic(
        root,
        Path(".route-share/results"),
        f"{receipt_id}.json",
        json.dumps(domain_result, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )
    receipt["result_artifact"] = {
        "path": relative_evidence.as_posix(),
        "sha256": result_digest,
    }
    result_path = None
    if verb == "plan" and proposal_id is not None:
        relative_result = Path(".route-share") / "proposals" / f"{proposal_id}.json"
        write_local_text_atomic(
            root,
            Path(".route-share/proposals"),
            f"{proposal_id}.json",
            json.dumps(domain_result, indent=2, ensure_ascii=False) + "\n",
        )
        result_path = relative_result.as_posix()
        receipt["proposal"]["path"] = result_path
    relative_path = Path(".route-share") / "runs" / f"{receipt_id}.json"
    write_local_text_atomic(
        root,
        Path(".route-share/runs"),
        f"{receipt_id}.json",
        json.dumps(receipt, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )
    summary = {
        "id": receipt_id,
        "path": relative_path.as_posix(),
        "result_sha256": result_digest,
        "evidence_path": relative_evidence.as_posix(),
    }
    if result_path is not None:
        summary["result_path"] = result_path
    return summary


def _command(
    root: Path,
    verb: str,
    *,
    request_path: Path | None,
    proposal_path: Path | None,
    slug: str | None,
    share_name: str | None,
    preview: bool,
    detach: bool,
    replace_existing: bool,
) -> list[str]:
    route = str(root / "scripts" / "route.sh")
    if verb == "inspect":
        return [route, "status", *([slug] if slug else [])]
    if verb == "plan":
        return [route, "propose", "--request", str(request_path)]
    if verb == "apply":
        return [route, "create", "--proposal", str(proposal_path)]
    if verb == "verify":
        command = [route, "preview" if preview else "check", str(slug)]
        if preview and detach:
            command.append("--detach")
        return command
    command = [route, "publish", str(slug), str(share_name)]
    if replace_existing:
        command.append("--replace-existing")
    return command


def _result_contract(verb: str, domain_result: object) -> str:
    if isinstance(domain_result, dict):
        document_type = domain_result.get("document_type")
        if document_type == "route-share-proposal":
            return "route_create.schema.json#/$defs/proposal"
        if document_type == "route-share-creation-report":
            return "route_create.py#route-share-creation-report"
        if domain_result.get("ok") is False and "error" in domain_result:
            return "route_create.py#route-create-error"
    return f"scripts/route.sh#{verb}-transcript"


def _focused_proof_snapshot(root: Path, environ: Mapping[str, str]) -> dict[str, Any]:
    selection = build_proof_snapshot(
        root,
        "route-share",
        tiers=["focused"],
        environ=environ,
    )
    if selection["status"] != "passed" or len(selection["gates"]) != 1:
        return selection
    return build_proof_snapshot(
        root,
        "route-share",
        tiers=["focused"],
        commands=[selection["gates"][0]["command"]],
        environ=environ,
    )


def _release_proof_monitor_paths(
    root: Path,
    proof: Mapping[str, Any],
    route_slug: str | None = None,
) -> list[str]:
    """Return the already-validated receipt and artifact paths bound to reuse."""

    evidence = proof.get("evidence")
    relative_receipt = evidence.get("path") if isinstance(evidence, Mapping) else None
    if not isinstance(relative_receipt, str):
        return []
    receipt_path = root / relative_receipt
    valid, receipt = _read_json_file(receipt_path)
    if not valid or not isinstance(receipt, Mapping):
        return []
    paths = [receipt_path]
    for artifact in receipt.get("artifacts", []):
        relative_artifact = artifact.get("path") if isinstance(artifact, Mapping) else None
        if isinstance(relative_artifact, str):
            paths.append(root / relative_artifact)
    if route_slug is not None:
        for receipt_path, value in _receipt_records(
            root, root / ".route-share" / "runs"
        ):
            if value.get("route_slug") != route_slug:
                continue
            paths.append(receipt_path)
            result_artifact = value.get("result_artifact")
            if isinstance(result_artifact, Mapping) and isinstance(
                result_artifact.get("path"), str
            ):
                paths.append(root / result_artifact["path"])
            proposal = value.get("proposal")
            if isinstance(proposal, Mapping) and isinstance(proposal.get("path"), str):
                paths.append(root / proposal["path"])
    return [str(path) for path in paths]


def _mark_receipt_incomplete(root: Path, summary: Mapping[str, str]) -> None:
    relative_path = summary.get("path")
    if not isinstance(relative_path, str):
        return
    path = root / relative_path
    valid, receipt = _read_json_file(path)
    if not valid or not isinstance(receipt, dict):
        return
    receipt["outcome"] = "incomplete"
    write_local_text_atomic(
        root,
        path.parent.relative_to(root),
        path.name,
        json.dumps(receipt, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )


def _blocked_result(
    verb: str,
    authority: str,
    issue: Mapping[str, str],
    *,
    authorized: bool = False,
    additional_issues: tuple[Mapping[str, str], ...] = (),
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-capability-result",
        "capability": "route-share",
        "verb": verb,
        "status": "blocked",
        "authority": authority,
        "authorized": authorized,
        "exit_code": 2,
        "result": None,
        "result_contract": "none",
        "blockers": [dict(issue), *(dict(item) for item in additional_issues)],
        "warnings": [],
        "receipt": None,
        "evidence": None,
    }


def execute_route_share(
    root: Path | str,
    verb: str,
    *,
    request_path: Path | str | None = None,
    proposal_path: Path | str | None = None,
    slug: str | None = None,
    share_name: str | None = None,
    preview: bool = False,
    detach: bool = False,
    replace_existing: bool = False,
    authority: str | None = None,
    target_authority: str | None = None,
    replacement_authority: str | None = None,
    environ: Mapping[str, str] | None = None,
    runner: Runner = subprocess.run,
    _recovery_monitor: ProofInputMonitor | None = None,
    _mutation_lock_held: bool = False,
) -> dict[str, Any]:
    """Run one route-share transition and return its stable result envelope."""

    if verb not in AUTHORITY:
        raise ValueError(f"unsupported route-share verb: {verb}")
    root = Path(root).resolve()
    if (verb == "release" or (verb == "verify" and not preview)) and not _mutation_lock_held:
        try:
            with owner_mutation_lock(root):
                return execute_route_share(
                    root,
                    verb,
                    request_path=request_path,
                    proposal_path=proposal_path,
                    slug=slug,
                    share_name=share_name,
                    preview=preview,
                    detach=detach,
                    replace_existing=replace_existing,
                    authority=authority,
                    target_authority=target_authority,
                    replacement_authority=replacement_authority,
                    environ=environ,
                    runner=runner,
                    _recovery_monitor=_recovery_monitor,
                    _mutation_lock_held=True,
                )
        except OwnerMutationBusyError:
            return _blocked_result(
                verb,
                AUTHORITY[verb],
                _issue(
                    "GODIESEL_ROUTE_MUTATION_BUSY",
                    "Another catalogue mutation currently owns the canonical write boundary.",
                    "Wait for the active catalogue mutation to finish, then retry the transition.",
                ),
                authorized=verb not in EFFECTFUL_AUTHORITY or authority == AUTHORITY[verb],
            )
    if verb in {"verify", "release"} and _recovery_monitor is None:
        try:
            ensure_local_directory(root, ".route-share")
            ensure_local_directory(root, "dist")
        except OSError:
            return _blocked_result(
                verb,
                AUTHORITY[verb],
                _issue(
                    "GODIESEL_LOCAL_ARTIFACT_ROOT_UNSAFE",
                    "The local route-share artifact boundary is not a repository-owned directory.",
                    "Restore a real .route-share directory inside the checkout, then retry the transition.",
                ),
                authorized=verb not in EFFECTFUL_AUTHORITY or authority == AUTHORITY[verb],
            )
        recovery_monitor = catalogue_recovery_monitor(root)
        try:
            return execute_route_share(
                root,
                verb,
                request_path=request_path,
                proposal_path=proposal_path,
                slug=slug,
                share_name=share_name,
                preview=preview,
                detach=detach,
                replace_existing=replace_existing,
                authority=authority,
                target_authority=target_authority,
                replacement_authority=replacement_authority,
                environ=environ,
                runner=runner,
                _recovery_monitor=recovery_monitor,
                _mutation_lock_held=_mutation_lock_held,
            )
        finally:
            recovery_monitor.close()
    request = Path(request_path).resolve() if request_path is not None else None
    proposal_file = (
        Path(proposal_path).resolve() if proposal_path is not None else None
    )
    required_authority = AUTHORITY[verb]
    if verb in EFFECTFUL_AUTHORITY and authority != required_authority:
        blocker = _issue(
            "GODIESEL_AUTHORITY_REQUIRED",
            f"{verb} requires explicit {required_authority} authority for route-share.",
            f"Review the exact effect, then repeat with --authorize {required_authority}.",
        )
        return _blocked_result(verb, required_authority, blocker)
    if verb == "release" and target_authority != share_name:
        blocker = _issue(
            "GODIESEL_RELEASE_TARGET_AUTHORITY_REQUIRED",
            f"Releasing share-{share_name} requires authority for that exact stable alias.",
            f"Review the named target, then repeat with --authorize-target {share_name}.",
        )
        return _blocked_result(verb, required_authority, blocker)
    if verb == "release" and replace_existing and replacement_authority != share_name:
        blocker = _issue(
            "GODIESEL_REPLACEMENT_AUTHORITY_REQUIRED",
            f"Replacing share-{share_name} requires authority for that exact stable alias.",
            f"Review the existing target, then repeat with --authorize-replacement {share_name}.",
        )
        return _blocked_result(verb, required_authority, blocker)
    proof_snapshot = None
    if verb == "release":
        lineage_state = _release_lineage_state(
            root,
            root / ".route-share" / "runs",
            slug,
        )
        if lineage_state != "ready":
            blocker = (
                _issue(
                    "GODIESEL_RELEASE_LINEAGE_INVALID",
                    "The route transition lineage or one of its linked artifacts failed integrity checks.",
                    "Discard the invalid ignored receipts and repeat plan, apply, and verify before release.",
                )
                if lineage_state == "invalid"
                else _issue(
                    "GODIESEL_RELEASE_LINEAGE_REQUIRED",
                    "Release requires a passed plan, apply, and verify chain for this route and proposal.",
                    "Complete the unified plan, apply, and verify transitions before authorizing release.",
                )
            )
            return _blocked_result(verb, required_authority, blocker)
        _recovery_state, recovery_blockers = route_generation_recovery_state(root)
        if recovery_blockers:
            return _blocked_result(
                verb,
                required_authority,
                recovery_blockers[0],
                authorized=True,
                additional_issues=tuple(recovery_blockers[1:]),
            )
        proof = reuse_verification(
            root,
            "route-share",
            slug=str(slug),
            environ=dict(os.environ if environ is None else environ),
            _mutation_lock_held=_mutation_lock_held,
        )
        if proof["status"] != "passed":
            proof_codes = {
                issue["code"] for issue in proof.get("blockers", [])
            }
            invalidated = "GODIESEL_PROOF_INVALIDATED" in proof_codes
            blocker = _issue(
                (
                    "GODIESEL_RELEASE_PROOF_INVALIDATED"
                    if invalidated
                    else "GODIESEL_RELEASE_PROOF_REQUIRED"
                ),
                (
                    "The route verification proof no longer covers the release inputs."
                    if invalidated
                    else "Release requires a reusable passed route verification proof."
                ),
                "Run route-share verification normally and review its new evidence receipt before release.",
            )
            return _blocked_result(
                verb,
                required_authority,
                blocker,
                authorized=True,
                additional_issues=tuple(proof.get("blockers", [])),
            )
        proof_snapshot = {
            "status": "passed",
            "covered_inputs": list(proof["result"]["covered_inputs"]),
            "proof_fingerprint": proof["result"]["proof_fingerprint"],
            "_monitor_paths": _release_proof_monitor_paths(root, proof, slug),
        }

    if verb == "verify" and not preview:
        evidence_schema = root / "system/evidence-receipt.schema.json"
        try:
            schema = json.loads(evidence_schema.read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
        except (OSError, json.JSONDecodeError, SchemaError):
            blocker = _issue(
                "GODIESEL_EVIDENCE_SCHEMA_UNAVAILABLE",
                "The evidence receipt schema could not be validated.",
                "Restore system/evidence-receipt.schema.json before recording verification proof.",
            )
            return _blocked_result(
                verb,
                required_authority,
                blocker,
                authorized=True,
            )
        proof_snapshot = _focused_proof_snapshot(
            root,
            dict(os.environ if environ is None else environ),
        )
        if proof_snapshot["status"] != "passed":
            proof_blockers = tuple(proof_snapshot["blockers"])
            return _blocked_result(
                verb,
                required_authority,
                proof_blockers[0],
                authorized=True,
                additional_issues=proof_blockers[1:],
            )
    if verb == "verify":
        _recovery_state, recovery_blockers = route_generation_recovery_state(root)
        if recovery_blockers:
            return _blocked_result(
                verb,
                required_authority,
                recovery_blockers[0],
                authorized=True,
                additional_issues=tuple(recovery_blockers[1:]),
            )
    command = _command(
        root,
        verb,
        request_path=request,
        proposal_path=proposal_file,
        slug=slug,
        share_name=share_name,
        preview=preview,
        detach=detach,
        replace_existing=replace_existing,
    )
    monitor = ProofInputMonitor(root, proof_snapshot) if proof_snapshot is not None else None
    if verb == "release" and monitor is not None:
        refreshed_lineage = _release_lineage_state(
            root,
            root / ".route-share" / "runs",
            slug,
        )
        refreshed_proof = reuse_verification(
            root,
            "route-share",
            slug=str(slug),
            environ=dict(os.environ if environ is None else environ),
            _mutation_lock_held=_mutation_lock_held,
        )
        if refreshed_lineage != "ready" or refreshed_proof["status"] != "passed":
            monitor.close()
            return _blocked_result(
                verb,
                required_authority,
                _issue(
                    "GODIESEL_RELEASE_PRECONDITIONS_CHANGED",
                    "Release lineage or verification proof changed during preflight.",
                    "Stabilize the local release evidence and rerun release authorization.",
                ),
                authorized=True,
            )
    started_at = datetime.now(timezone.utc).isoformat()
    try:
        completed = runner(
            command,
            cwd=root,
            capture_output=True,
            text=True,
            env=dict(os.environ if environ is None else environ),
        )
    finally:
        transient_input_change = monitor.changed() if monitor is not None else False
    finished_at = datetime.now(timezone.utc).isoformat()
    domain_result = _domain_result(completed)
    post_proof_snapshot = proof_snapshot
    proof_stability_blockers: list[dict[str, str]] = []
    if proof_snapshot is not None:
        post_proof_snapshot = _focused_proof_snapshot(
            root,
            dict(os.environ if environ is None else environ),
        )
        proof_stability_blockers = proof_snapshot_stability_issues(
            proof_snapshot,
            post_proof_snapshot,
        )
        if transient_input_change and not any(
            issue["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
            for issue in proof_stability_blockers
        ):
            proof_stability_blockers.append(
                _issue(
                    "GODIESEL_VERIFICATION_INPUTS_CHANGED",
                    "A covered input changed while the verification gate was running.",
                    "Stabilize the worktree and rerun verification against one unchanged input set.",
                )
            )
    if verb in {"verify", "release"}:
        _recovery_state, post_recovery_blockers = route_generation_recovery_state(root)
        proof_stability_blockers.extend(
            issue
            for issue in post_recovery_blockers
            if issue["code"]
            not in {blocker["code"] for blocker in proof_stability_blockers}
        )
        recovery_changed = (
            _recovery_monitor.changed() if _recovery_monitor is not None else False
        )
        if recovery_changed and not post_recovery_blockers:
            proof_stability_blockers.insert(
                0,
                _issue(
                    "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED",
                    "Route-generation recovery state changed during the route-share transition.",
                    "Stabilize generated publication state, inspect route generation, and retry the transition.",
                )
            )
    blockers = list(proof_stability_blockers)
    release_output = completed.stdout + completed.stderr
    observed_release = (
        _release_observation(release_output, share_name)
        if verb == "release"
        else None
    )
    domain_error = (
        domain_result.get("error")
        if isinstance(domain_result, dict) else None
    )
    if (
        completed.returncode == 2
        and isinstance(domain_error, dict)
        and domain_error.get("code") == "repository.mutation_busy"
    ):
        blockers.append(
            _issue(
                "GODIESEL_ROUTE_MUTATION_BUSY",
                "Another catalogue mutation currently owns the canonical write boundary.",
                "Wait for the active catalogue mutation to finish, then create or apply a fresh proposal.",
            )
        )
    elif completed.returncode != 0 and observed_release is not None:
        blockers.append(
            _issue(
                "GODIESEL_RELEASE_EXTERNAL_STATE_UNKNOWN",
                "Cloudflare reported an immutable deployment, but post-upload verification did not complete.",
                "Inspect the reported immutable deployment and stable alias before deciding whether any retry is safe.",
            )
        )
    elif completed.returncode != 0:
        blockers.append(
            _issue(
                "GODIESEL_ROUTE_SHARE_COMMAND_FAILED",
                f"The existing route-share {verb} command refused or failed.",
                "Inspect the preserved domain result, correct its reported cause, and retry the same transition.",
            )
        )
    release_target = None
    warnings: list[dict[str, str]] = []
    if verb == "release" and completed.returncode == 0:
        release_target, release_blockers = _release_target(
            release_output,
            share_name,
        )
        blockers.extend(release_blockers)
        if release_target is not None:
            release_target["authorized_share_name"] = target_authority
            release_target["replacement_authorized"] = replace_existing
    elif verb == "release" and observed_release is not None:
        release_target = {
            **observed_release,
            "authorized_share_name": target_authority,
            "replacement_authorized": replace_existing,
        }

    proposal = (
        domain_result
        if verb == "plan" and isinstance(domain_result, dict)
        else _read_mapping(proposal_file)
    )
    receipt = None
    if verb != "inspect":
        outcome = (
            "blocked"
            if completed.returncode != 0
            else "incomplete"
            if blockers
            else "passed"
        )
        try:
            receipt = _write_receipt(
                root,
                verb=verb,
                authority=required_authority,
                exit_code=completed.returncode,
                outcome=outcome,
                domain_result=domain_result,
                proposal=proposal,
                route_slug=slug
                or (
                    str(domain_result.get("slug"))
                    if verb == "apply"
                    and isinstance(domain_result, dict)
                    and domain_result.get("slug") is not None
                    else None
                ),
                release_target=release_target,
                verification_mode="preview" if preview else "check",
            )
        except OSError:
            blockers.append(
                _issue(
                    "GODIESEL_LOCAL_ARTIFACT_ROOT_UNSAFE",
                    "The local route-share artifact boundary is not a repository-owned directory.",
                    "Restore real .route-share directories inside the checkout, then retry the transition.",
                )
            )
    status = "blocked" if blockers else "warning" if warnings else "passed"
    exit_code = 2 if blockers and completed.returncode == 0 else completed.returncode
    evidence = None
    if verb == "verify" and receipt is not None and post_proof_snapshot is not None:
        gate_status = "passed" if completed.returncode == 0 else "failed"
        evidence_status = "blocked" if proof_stability_blockers else gate_status
        evidence = write_evidence_receipt(
            root,
            capability="route-share",
            verb="verify",
            authority=required_authority,
            started_at=started_at,
            finished_at=finished_at,
            status=evidence_status,
            inputs=[
                {
                    "kind": "input",
                    "name": "route-slug",
                    "sha256": canonical_digest(slug),
                },
                {
                    "kind": "output",
                    "name": "verification-result",
                    "sha256": receipt["result_sha256"],
                },
            ],
            covered_inputs=post_proof_snapshot["covered_inputs"],
            proof_fingerprint=post_proof_snapshot["proof_fingerprint"],
            selection={
                "mode": "explicit",
                "tiers": ["focused"],
                "impact_rules": post_proof_snapshot["impact_rules"],
            },
            gates=[
                {
                    "id": "route-share-check",
                    "tier": gate["tier"],
                    "command": gate["command"],
                    "cwd": gate["cwd"],
                    "provider": "deterministic-local",
                    "started_at": started_at,
                    "finished_at": finished_at,
                    "status": gate_status,
                    "exit_code": completed.returncode,
                    "output_sha256": receipt["result_sha256"],
                }
                for gate in proof_snapshot["gates"]
            ],
            configuration=proof_snapshot["configuration"],
            warnings=warnings,
            recovery_paths=[],
            safe_next_actions=[issue["remediation"] for issue in blockers],
            artifacts=[
                {
                    "kind": "route-share-run-receipt",
                    "path": receipt["path"],
                    "sha256": sha256((root / receipt["path"]).read_bytes()).hexdigest(),
                }
            ],
        )
        if evidence is None:
            blockers.append(
                _issue(
                    "GODIESEL_LOCAL_ARTIFACT_ROOT_UNSAFE",
                    "The general evidence receipt could not be committed inside its repository-owned directory.",
                    "Restore a real .godiesel/evidence directory inside the checkout, then rerun verification.",
                )
            )
            try:
                _mark_receipt_incomplete(root, receipt)
            except OSError:
                pass
            status = "blocked"
            exit_code = 2
    late_issues: list[dict[str, str]] = []
    if verb in {"verify", "release"}:
        if proof_snapshot is not None:
            final_proof_snapshot = _focused_proof_snapshot(
                root,
                dict(os.environ if environ is None else environ),
            )
            late_issues.extend(
                proof_snapshot_stability_issues(
                    post_proof_snapshot,
                    final_proof_snapshot,
                )
            )
        if verb == "release":
            final_lineage = _release_lineage_state(
                root,
                root / ".route-share" / "runs",
                slug,
            )
            final_reuse = reuse_verification(
                root,
                "route-share",
                slug=str(slug),
                environ=dict(os.environ if environ is None else environ),
                _mutation_lock_held=_mutation_lock_held,
            )
            if final_lineage != "ready" or final_reuse["status"] != "passed":
                late_issues.append(
                    _issue(
                        "GODIESEL_RELEASE_PRECONDITIONS_CHANGED",
                        "Release lineage or verification proof changed while release evidence was being finalized.",
                        "Inspect the deployment and repeat the local plan, apply, and verify chain before any retry.",
                    )
                )
        _final_recovery_state, late_recovery_blockers = route_generation_recovery_state(
            root
        )
        late_issues.extend(late_recovery_blockers)
        if _recovery_monitor is not None and _recovery_monitor.changed() and not any(
            issue["code"]
            in {
                "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED",
                "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING",
                "GODIESEL_ROUTE_GENERATION_RECOVERY_UNREADABLE",
            }
            for issue in late_issues
        ):
            late_issues.append(
                _issue(
                    "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED",
                    "Catalogue recovery state changed while route-share evidence was being finalized.",
                    "Stabilize catalogue publication state and rerun the transition.",
                )
            )
        if monitor is not None and monitor.changed() and not any(
            issue["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
            for issue in late_issues
        ):
            late_issues.append(
                _issue(
                    "GODIESEL_VERIFICATION_INPUTS_CHANGED",
                    "A covered proof or lineage input changed while route-share evidence was being finalized.",
                    "Stabilize the worktree and rerun the transition against one unchanged input set.",
                )
            )
        existing_codes = {issue["code"] for issue in blockers}
        newly_detected = [
            issue for issue in late_issues if issue["code"] not in existing_codes
        ]
        blockers.extend(newly_detected)
        if newly_detected:
            if receipt is not None:
                try:
                    _mark_receipt_incomplete(root, receipt)
                except OSError:
                    pass
            if evidence is not None:
                evidence_path = Path(evidence["path"])
                try:
                    unlink_local_file(
                        root,
                        evidence_path.parent,
                        evidence_path.name,
                        missing_ok=True,
                    )
                except OSError:
                    pass
                evidence = None
            status = "blocked"
            exit_code = 2
    if monitor is not None:
        monitor.close()
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-capability-result",
        "capability": "route-share",
        "verb": verb,
        "status": status,
        "authority": required_authority,
        "authorized": verb not in EFFECTFUL_AUTHORITY or authority == required_authority,
        "exit_code": exit_code,
        "result": domain_result,
        "result_contract": _result_contract(verb, domain_result),
        "blockers": blockers,
        "warnings": warnings,
        "receipt": receipt,
        "evidence": evidence,
    }
