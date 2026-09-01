"""Manifest-owned impact selection for proportionate verification."""

from __future__ import annotations

import fnmatch
import json
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Sequence


SCHEMA_VERSION = 1
MANIFEST_PATH = Path("system/capabilities.json")


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def _normalized_path(value: str) -> str | None:
    candidate = value.replace("\\", "/")
    path = PurePosixPath(candidate)
    if path.is_absolute() or not candidate or ".." in path.parts:
        return None
    normalized = path.as_posix()
    return None if normalized == "." else normalized


def _git_changed_paths(root: Path, base_ref: str) -> tuple[list[str], list[dict[str, str]]]:
    try:
        merge_base = subprocess.run(
            ["git", "merge-base", base_ref, "HEAD"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if merge_base.returncode:
            raise ValueError
        changed = subprocess.run(
            ["git", "diff", "--name-only", "-z", merge_base.stdout.strip(), "--"],
            cwd=root,
            check=False,
            capture_output=True,
            timeout=10,
        )
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard", "-z"],
            cwd=root,
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return [], [
            _issue(
                "GODIESEL_VERIFICATION_BASE_UNAVAILABLE",
                f"The verification base {base_ref} could not be resolved.",
                "Fetch or supply an existing base ref, then rerun verification explanation.",
            )
        ]
    if changed.returncode or untracked.returncode:
        return [], [
            _issue(
                "GODIESEL_CHANGED_PATHS_UNAVAILABLE",
                "Changed paths could not be read from the worktree.",
                "Repair the Git worktree or pass explicit --changed-path values.",
            )
        ]
    decoded = (changed.stdout + untracked.stdout).split(b"\0")
    paths = {
        normalized
        for raw in decoded
        if raw
        for normalized in [_normalized_path(raw.decode("utf-8", errors="surrogateescape"))]
        if normalized is not None
    }
    return sorted(paths), []


def _load_manifest(root: Path) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    try:
        value = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, [
            _issue(
                "GODIESEL_MANIFEST_UNAVAILABLE",
                "The capability manifest could not be read for verification selection.",
                "Repair system/capabilities.json and rerun doctor before selecting proof.",
            )
        ]
    if not isinstance(value, dict) or not isinstance(value.get("impact_rules"), list):
        return None, [
            _issue(
                "GODIESEL_IMPACT_GRAPH_UNAVAILABLE",
                "The capability manifest does not contain an impact graph.",
                "Restore the manifest impact rules and rerun the focused control-plane tests.",
            )
        ]
    return value, []


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def _selected_gates(
    manifest: Mapping[str, Any],
    classifications: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    capabilities = {
        capability["id"]: capability for capability in manifest["capabilities"]
    }
    selected: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    rules = {rule["id"]: rule for rule in manifest["impact_rules"]}
    for classification in classifications:
        path = classification["path"]
        for rule_id in classification["rules"]:
            rule = rules[rule_id]
            for gate_ref in rule["gates"]:
                capability_id = gate_ref["capability"]
                tier = gate_ref["tier"]
                capability = capabilities[capability_id]
                for command in capability["verification"][tier]:
                    key = (capability_id, tier, command["command"], command["cwd"])
                    gate = selected.setdefault(
                        key,
                        {
                            "capability": capability_id,
                            "tier": tier,
                            "command": command["command"],
                            "cwd": command["cwd"],
                            "provider": (
                                "live-provider"
                                if tier == "live"
                                else "deterministic-local"
                            ),
                            "reasons": [],
                            "required_by": [],
                        },
                    )
                    if rule["reason"] not in gate["reasons"]:
                        gate["reasons"].append(rule["reason"])
                    if path not in gate["required_by"]:
                        gate["required_by"].append(path)
    return sorted(
        selected.values(),
        key=lambda item: (item["capability"], item["tier"], item["command"]),
    )


def explain_verification(
    root: Path | str,
    *,
    changed_paths: Sequence[str] | None = None,
    base_ref: str = "origin/main",
) -> dict[str, Any]:
    """Explain manifest-selected proof without executing any gate."""

    root = Path(root).resolve()
    manifest, blockers = _load_manifest(root)
    explicit_paths = changed_paths is not None
    if changed_paths is None and not blockers:
        changed_paths, git_blockers = _git_changed_paths(root, base_ref)
        blockers.extend(git_blockers)
    normalized_paths: list[str] = []
    for value in changed_paths or []:
        normalized = _normalized_path(value)
        if normalized is None:
            blockers.append(
                _issue(
                    "GODIESEL_CHANGED_PATH_INVALID",
                    "A changed path is absolute, empty, or escapes the repository.",
                    "Pass repository-relative --changed-path values without parent traversal.",
                )
            )
        else:
            normalized_paths.append(normalized)
    normalized_paths = sorted(set(normalized_paths))

    classifications: list[dict[str, Any]] = []
    unclassified: list[str] = []
    if manifest is not None:
        for path in normalized_paths:
            matching = [
                rule
                for rule in manifest["impact_rules"]
                if _matches(path, rule["paths"])
            ]
            if not matching:
                unclassified.append(path)
                continue
            classifications.append(
                {
                    "path": path,
                    "capabilities": sorted(
                        {item for rule in matching for item in rule["capabilities"]}
                    ),
                    "categories": sorted({rule["category"] for rule in matching}),
                    "rules": [rule["id"] for rule in matching],
                }
            )
    if unclassified:
        blockers.append(
            _issue(
                "GODIESEL_UNCLASSIFIED_PATH",
                f"{len(unclassified)} changed path(s) have no capability impact rule.",
                "Classify every named path in system/capabilities.json before choosing a gate.",
            )
        )
    selected_gates = (
        _selected_gates(manifest, classifications) if manifest is not None else []
    )
    explanation = {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-verification-explanation",
        "execution": "not_run",
        "base_ref": None if explicit_paths else base_ref,
        "changed_paths": normalized_paths,
        "classifications": classifications,
        "selected_gates": selected_gates,
        "unclassified_paths": unclassified,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-capability-result",
        "capability": "system",
        "verb": "verify",
        "status": "blocked" if blockers else "passed",
        "authority": "ephemeral-local",
        "authorized": True,
        "exit_code": 2 if blockers else 0,
        "result": explanation,
        "result_contract": "system/verification-explanation.schema.json",
        "blockers": blockers,
        "warnings": [],
        "receipt": None,
        "evidence": None,
    }
