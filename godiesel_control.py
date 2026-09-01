"""Read-only control-plane inspection for the goDiesel repository."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

from godiesel_route_share import AUTHORITY as ROUTE_SHARE_AUTHORITY
from godiesel_route_share import execute_route_share
from godiesel_verification import explain_verification, reuse_verification


SCHEMA_VERSION = 1
MANIFEST_PATH = Path("system/capabilities.json")
MANIFEST_SCHEMA_PATH = Path("system/capabilities.schema.json")
VERBS = {"inspect", "plan", "apply", "verify", "release"}
AUTHORITY_CLASSES = {
    "read-only",
    "ephemeral-local",
    "canonical-local",
    "external-durable",
    "destructive",
}
IDEMPOTENCY_CLASSES = {
    "read-only",
    "deterministic",
    "idempotent",
    "guarded",
    "external-check-required",
}
CAPABILITY_KEYS = {
    "id",
    "entity",
    "summary",
    "verbs",
    "authority",
    "inputs",
    "reads",
    "writes",
    "external_effects",
    "required_files",
    "configuration",
    "commands",
    "preconditions",
    "idempotency",
    "recovery",
    "artifacts",
    "invariants",
    "verification",
    "documents",
}


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def _status(blockers: list[dict[str, str]], warnings: list[dict[str, str]]) -> str:
    if blockers:
        return "blocked"
    if warnings:
        return "warning"
    return "passed"


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )


def _run_git_bytes(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=False,
        capture_output=True,
        timeout=5,
    )


def _status_paths(output: bytes) -> list[str]:
    fields = output.split(b"\0")
    paths: list[str] = []
    index = 0
    while index < len(fields):
        record = fields[index]
        index += 1
        if not record:
            continue
        decoded = record.decode("utf-8", errors="surrogateescape")
        if len(decoded) < 4 or decoded[2] != " ":
            continue
        status = decoded[:2]
        paths.append(decoded[3:])
        if "R" in status or "C" in status:
            if index < len(fields) and fields[index]:
                paths.append(
                    fields[index].decode("utf-8", errors="surrogateescape")
                )
            index += 1
    return paths


def _repository_state(root: Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    blockers: list[dict[str, str]] = []
    try:
        commit_result = _run_git(root, "rev-parse", "HEAD")
        branch_result = _run_git(root, "branch", "--show-current")
        status_result = _run_git_bytes(
            root,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
        )
    except (OSError, subprocess.TimeoutExpired):
        commit_result = subprocess.CompletedProcess([], 1, "", "")
        branch_result = subprocess.CompletedProcess([], 1, "", "")
        status_result = subprocess.CompletedProcess([], 1, b"", b"")
    if commit_result.returncode or branch_result.returncode or status_result.returncode:
        blockers.append(
            _issue(
                "GODIESEL_REPOSITORY_UNAVAILABLE",
                "The repository state could not be read.",
                "Run this command from a goDiesel Git worktree with Git available.",
            )
        )
    def redact_path(path: str) -> str:
        if path.startswith("route_sources/"):
            return "route_sources/<redacted>"
        if path.startswith(".route-share/"):
            return ".route-share/<redacted>"
        if path == "strava_data.json":
            return "<private-source-file>"
        return path

    changed_paths = sorted(
        {
            redact_path(path)
            for path in _status_paths(status_result.stdout)
        }
    )
    repository = {
        "commit": commit_result.stdout.strip() if commit_result.returncode == 0 else None,
        "branch": branch_result.stdout.strip() or None if branch_result.returncode == 0 else None,
        "worktree": {"clean": not changed_paths, "changed_paths": changed_paths},
    }
    return repository, blockers


def _is_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def _is_string_list(value: Any, *, pattern: str | None = None) -> bool:
    return (
        isinstance(value, list)
        and all(_is_string(item) for item in value)
        and len(value) == len(set(value))
        and (pattern is None or all(re.fullmatch(pattern, item) for item in value))
    )


def _is_command(value: Any) -> bool:
    if not isinstance(value, dict) or not {"command", "cwd"}.issubset(value):
        return False
    if not set(value).issubset({"command", "cwd", "description"}):
        return False
    return all(_is_string(item) for item in value.values())


def _is_command_list(value: Any) -> bool:
    return isinstance(value, list) and all(_is_command(item) for item in value)


def _is_verb_map(value: Any, verbs: set[str], validator) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == verbs
        and all(validator(item) for item in value.values())
    )


def _is_configuration(value: Any, verbs: set[str]) -> bool:
    if not isinstance(value, list):
        return False
    names: list[str] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "name",
            "required_for",
            "sensitive",
        }:
            return False
        if not _is_string(item["name"]) or not re.fullmatch(
            r"[A-Z][A-Z0-9_]+", item["name"]
        ):
            return False
        requirements = item["required_for"]
        allowed_requirements = verbs | {"verify:live"}
        if (
            not _is_string_list(requirements)
            or not set(requirements).issubset(allowed_requirements)
            or not isinstance(item["sensitive"], bool)
        ):
            return False
        names.append(item["name"])
    return len(names) == len(set(names))


def _is_artifacts(value: Any) -> bool:
    if not isinstance(value, list):
        return False
    for item in value:
        if not isinstance(item, dict) or not {"kind", "location", "persistence"}.issubset(
            item
        ):
            return False
        if not set(item).issubset({"kind", "location", "persistence", "schema"}):
            return False
        if not all(_is_string(item[key]) for key in item):
            return False
        if item["persistence"] not in {
            "runtime",
            "ignored-local",
            "tracked-local",
            "generated-local",
            "external",
        }:
            return False
    return True


def _is_capability(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != CAPABILITY_KEYS:
        return False
    verbs_value = value["verbs"]
    if (
        not _is_string_list(verbs_value)
        or not verbs_value
        or not set(verbs_value).issubset(VERBS)
    ):
        return False
    verbs = set(verbs_value)
    if not all(_is_string(value[key]) for key in ("id", "entity", "summary")):
        return False
    if not re.fullmatch(r"[a-z][a-z0-9-]+", value["id"]):
        return False
    if not _is_verb_map(
        value["authority"], verbs, lambda item: item in AUTHORITY_CLASSES
    ):
        return False
    if not _is_verb_map(value["inputs"], verbs, _is_string_list):
        return False
    if not _is_verb_map(value["commands"], verbs, _is_command_list):
        return False
    if not _is_verb_map(
        value["idempotency"], verbs, lambda item: item in IDEMPOTENCY_CLASSES
    ):
        return False
    if not _is_verb_map(value["recovery"], verbs, _is_string):
        return False
    if not all(
        _is_string_list(value[key])
        for key in (
            "reads",
            "writes",
            "external_effects",
            "required_files",
            "preconditions",
            "documents",
        )
    ):
        return False
    if not _is_string_list(value["invariants"], pattern=r"[a-z][a-z0-9-]+"):
        return False
    if not _is_configuration(value["configuration"], verbs):
        return False
    if not _is_artifacts(value["artifacts"]):
        return False
    verification = value["verification"]
    return (
        isinstance(verification, dict)
        and set(verification) == {"focused", "ticket", "live"}
        and all(_is_command_list(commands) for commands in verification.values())
    )


def _is_manifest(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not {"schema_version", "document_type", "capabilities", "impact_rules"}.issubset(value):
        return False
    if not set(value).issubset(
        {"$schema", "schema_version", "document_type", "capabilities", "impact_rules"}
    ):
        return False
    capabilities = value["capabilities"]
    if (
        value["schema_version"] != SCHEMA_VERSION
        or value["document_type"] != "godiesel-capability-manifest"
        or not isinstance(capabilities, list)
        or not capabilities
        or not all(_is_capability(capability) for capability in capabilities)
    ):
        return False
    ids = [capability["id"] for capability in capabilities]
    if len(ids) != len(set(ids)):
        return False
    impact_rules = value["impact_rules"]
    if not isinstance(impact_rules, list) or not impact_rules:
        return False
    rule_ids: list[str] = []
    for rule in impact_rules:
        if not isinstance(rule, dict) or set(rule) != {
            "id",
            "paths",
            "capabilities",
            "category",
            "gates",
            "reason",
        }:
            return False
        if not _is_string(rule["id"]) or not re.fullmatch(
            r"[a-z][a-z0-9-]+", rule["id"]
        ):
            return False
        if not _is_string_list(rule["paths"]) or not rule["paths"]:
            return False
        if (
            not _is_string_list(rule["capabilities"])
            or not rule["capabilities"]
            or not set(rule["capabilities"]).issubset(ids)
        ):
            return False
        if rule["category"] not in {
            "implementation",
            "contract",
            "fixture",
            "configuration",
            "data",
            "provider",
            "documentation",
        }:
            return False
        if not isinstance(rule["gates"], list) or not all(
            isinstance(gate, dict)
            and set(gate) == {"capability", "tier"}
            and gate["capability"] in ids
            and gate["tier"] in {"focused", "ticket", "live"}
            for gate in rule["gates"]
        ):
            return False
        if not _is_string(rule["reason"]):
            return False
        rule_ids.append(rule["id"])
    return len(rule_ids) == len(set(rule_ids))


def _load_manifest(root: Path) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    try:
        schema = json.loads((root / MANIFEST_SCHEMA_PATH).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, [
            _issue(
                "GODIESEL_MANIFEST_SCHEMA_MISSING",
                "The capability manifest schema is missing.",
                "Restore system/capabilities.schema.json from the repository.",
            )
        ]
    except json.JSONDecodeError:
        return None, [
            _issue(
                "GODIESEL_MANIFEST_SCHEMA_INVALID_JSON",
                "The capability manifest schema is not valid JSON.",
                "Repair system/capabilities.schema.json and run the focused control-plane tests.",
            )
        ]
    if (
        not isinstance(schema, dict)
        or schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
        or schema.get("type") != "object"
        or schema.get("additionalProperties") is not False
    ):
        return None, [
            _issue(
                "GODIESEL_MANIFEST_SCHEMA_INVALID",
                "The capability manifest schema does not satisfy the control-plane contract.",
                "Restore the closed Draft 2020-12 schema and run the focused control-plane tests.",
            )
        ]
    try:
        manifest = json.loads((root / MANIFEST_PATH).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, [
            _issue(
                "GODIESEL_MANIFEST_MISSING",
                "The capability manifest is missing.",
                "Restore system/capabilities.json from the repository.",
            )
        ]
    except json.JSONDecodeError:
        return None, [
            _issue(
                "GODIESEL_MANIFEST_INVALID_JSON",
                "The capability manifest is not valid JSON.",
                "Repair system/capabilities.json and run the focused control-plane tests.",
            )
        ]

    if not _is_manifest(manifest):
        return None, [
            _issue(
                "GODIESEL_MANIFEST_INVALID",
                "The capability manifest does not satisfy the control-plane contract.",
                "Validate system/capabilities.json against system/capabilities.schema.json.",
            )
        ]
    return manifest, []


def _capability_view(root: Path, capability: Mapping[str, Any]) -> dict[str, Any]:
    blockers: list[dict[str, str]] = []
    missing_files = [
        path for path in capability["required_files"] if not (root / path).exists()
    ]
    if missing_files:
        blockers.append(
            _issue(
                "GODIESEL_CAPABILITY_FILES_MISSING",
                f"Required files are missing for {capability['id']}: {', '.join(missing_files)}.",
                "Restore the named files before using this capability.",
            )
        )
    missing_documents = [
        path for path in capability["documents"] if not (root / path).is_file()
    ]
    if missing_documents:
        blockers.append(
            _issue(
                "GODIESEL_CAPABILITY_DOCUMENTS_MISSING",
                "Capability guidance is missing for "
                f"{capability['id']}: {len(missing_documents)} document(s).",
                "Restore the manifest-linked capability guidance before changing this area.",
            )
        )
    transitions = []
    for verb in capability["verbs"]:
        commands = capability["commands"].get(verb, [])
        if commands:
            transitions.append(
                {
                    "verb": verb,
                    "authority": capability["authority"][verb],
                    "command": commands[0]["command"],
                }
            )
    return {
        "id": capability["id"],
        "entity": capability["entity"],
        "summary": capability["summary"],
        "status": _status(blockers, []),
        "verbs": capability["verbs"],
        "authority": capability["authority"],
        "inputs": capability["inputs"],
        "reads": capability["reads"],
        "effects": {
            "writes": capability["writes"],
            "external": capability["external_effects"],
        },
        "preconditions": capability["preconditions"],
        "idempotency": capability["idempotency"],
        "recovery": capability["recovery"],
        "artifacts": capability["artifacts"],
        "invariants": capability["invariants"],
        "documents": capability["documents"],
        "blockers": blockers,
        "warnings": [],
        "next_transitions": transitions,
    }


def inspect_system(
    root: Path | str,
    *,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return a redacted, read-only view of repository capabilities and state."""

    del environ  # Environment values are intentionally outside the inspection result.
    root = Path(root).resolve()
    repository, blockers = _repository_state(root)
    manifest, manifest_blockers = _load_manifest(root)
    blockers.extend(manifest_blockers)
    capabilities = [] if manifest is None else [
        _capability_view(root, capability) for capability in manifest["capabilities"]
    ]
    for capability in capabilities:
        blockers.extend(capability["blockers"])
    warnings: list[dict[str, str]] = []
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-system-inspection",
        "status": _status(blockers, warnings),
        "repository": repository,
        "capabilities": capabilities,
        "blockers": blockers,
        "warnings": warnings,
        "next_transitions": [
            {
                "verb": "inspect",
                "authority": "read-only",
                "command": "./scripts/godiesel doctor --json",
            }
        ],
    }


def _check(
    check_id: str,
    summary: str,
    blockers: list[dict[str, str]] | None = None,
    warnings: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    blockers = blockers or []
    warnings = warnings or []
    return {
        "id": check_id,
        "status": _status(blockers, warnings),
        "summary": summary,
        "blockers": blockers,
        "warnings": warnings,
    }


def _runtime_check(
    environ: Mapping[str, str],
) -> tuple[
    dict[str, Any],
    list[dict[str, str]],
    list[dict[str, str]],
    list[dict[str, Any]],
]:
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    runtimes = [
        {
            "name": "python",
            "status": "available",
            "version": (
                f"{sys.version_info.major}.{sys.version_info.minor}."
                f"{sys.version_info.micro}"
            ),
        }
    ]
    path = environ.get("PATH", "")
    for name, required in (
        ("git", True),
        ("node", False),
        ("npm", False),
        ("npx", False),
    ):
        executable = shutil.which(name, path=path)
        if executable is None:
            issue = _issue(
                f"GODIESEL_RUNTIME_MISSING_{name.upper()}",
                f"The {name} runtime is not available on PATH.",
                f"Install {name} and make it available on PATH, then rerun doctor.",
            )
            (blockers if required else warnings).append(issue)
            runtimes.append({"name": name, "status": "missing", "version": None})
            continue
        try:
            version_result = subprocess.run(
                [executable, "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
                env=dict(environ),
            )
        except (OSError, subprocess.TimeoutExpired):
            version_result = subprocess.CompletedProcess([], 1, "", "")
        version = (version_result.stdout or version_result.stderr).strip().splitlines()
        runtimes.append(
            {
                "name": name,
                "status": "available" if version_result.returncode == 0 else "unhealthy",
                "version": version[0] if version else None,
            }
        )
        if version_result.returncode:
            warnings.append(
                _issue(
                    f"GODIESEL_RUNTIME_UNHEALTHY_{name.upper()}",
                    f"The {name} runtime did not return a version successfully.",
                    f"Repair the {name} installation and rerun doctor.",
                )
            )
    return (
        _check("runtimes", "Inspect required local runtime availability.", blockers, warnings),
        blockers,
        warnings,
        runtimes,
    )


def _documentation_check(root: Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    blockers: list[dict[str, str]] = []
    for directory in (Path("docs/adr"), Path("docs/plans")):
        index_path = root / directory / "README.md"
        if not index_path.exists():
            blockers.append(
                _issue(
                    "GODIESEL_DOCUMENTATION_INDEX_MISSING",
                    f"The documentation index {directory}/README.md is missing.",
                    "Restore the index and list every Markdown document in that directory.",
                )
            )
            continue
        index = index_path.read_text(encoding="utf-8")
        disk_documents = {
            path.name
            for path in (root / directory).glob("*.md")
            if path.name != "README.md"
        }
        linked_documents = {
            Path(target).name
            for target in re.findall(
                r"\]\(([^)#]+\.md)(?:#[^)]+)?\)",
                index,
            )
            if Path(target).parent == Path(".")
        }
        listed_reference_documents = set(
            re.findall(r"(?m)^\s*-\s+`([^`/]+\.md)`", index)
        )
        indexed_documents = linked_documents | listed_reference_documents
        unlisted = disk_documents - indexed_documents
        stale = indexed_documents - disk_documents
        if unlisted or stale:
            blockers.append(
                _issue(
                    "GODIESEL_DOCUMENTATION_INDEX_DRIFT",
                    f"{directory}/README.md has {len(unlisted)} unlisted and "
                    f"{len(stale)} stale document reference(s).",
                    f"Make {directory}/README.md match the Markdown files on disk "
                    "and rerun doctor.",
                )
            )
    return (
        _check(
            "documentation-indexes",
            "Compare ADR and plan indexes with Markdown files on disk.",
            blockers,
        ),
        blockers,
    )


def _iter_commands(manifest: Mapping[str, Any]):
    for capability in manifest["capabilities"]:
        for command_group in (capability["commands"], capability["verification"]):
            for commands in command_group.values():
                for command in commands:
                    yield capability["id"], command


def _command_reference_check(
    root: Path,
    manifest: Mapping[str, Any],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    blockers: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for capability_id, command_ref in _iter_commands(manifest):
        command = command_ref["command"]
        key = (capability_id, command)
        if key in seen:
            continue
        seen.add(key)
        cwd = root / command_ref["cwd"]
        try:
            tokens = shlex.split(command)
        except ValueError:
            tokens = []
        missing_reference = None
        if not tokens:
            missing_reference = "unparseable command"
        elif not cwd.is_dir():
            missing_reference = command_ref["cwd"]
        elif tokens[0].startswith("./"):
            command_path = cwd / tokens[0]
            if not command_path.is_file():
                missing_reference = tokens[0]
            elif tokens[0] == "./scripts/route.sh" and len(tokens) > 1:
                route_commands = set(
                    re.findall(
                        r"(?m)^\s{2}([a-z][a-z-]*)\)",
                        command_path.read_text(encoding="utf-8"),
                    )
                )
                if tokens[1] not in route_commands:
                    missing_reference = f"route command {tokens[1]}"
        elif (
            len(tokens) > 1
            and tokens[0] in {"python", "python3"}
            and tokens[1].endswith(".py")
        ):
            if not (cwd / tokens[1]).is_file():
                missing_reference = tokens[1]
        elif (
            len(tokens) > 2
            and tokens[0] in {"python", "python3"}
            and tokens[1:3] == ["-m", "pytest"]
        ):
            test_paths = [
                token.split("::", 1)[0]
                for token in tokens[3:]
                if not token.startswith("-")
                and token.split("::", 1)[0].endswith(".py")
            ]
            missing_tests = [path for path in test_paths if not (cwd / path).is_file()]
            if missing_tests:
                missing_reference = missing_tests[0]
        elif len(tokens) > 1 and tokens[0] == "node" and tokens[1].endswith(".mjs"):
            if not (cwd / tokens[1]).is_file():
                missing_reference = tokens[1]
        elif tokens and tokens[0] == "npm" and "run" in tokens:
            package_root = cwd
            if "--prefix" in tokens:
                prefix_index = tokens.index("--prefix") + 1
                if prefix_index >= len(tokens):
                    missing_reference = "npm --prefix value"
                else:
                    package_root = cwd / tokens[prefix_index]
            if missing_reference is None:
                package_path = package_root / "package.json"
                try:
                    package = json.loads(package_path.read_text(encoding="utf-8"))
                    script = tokens[tokens.index("run") + 1]
                    if script not in package.get("scripts", {}):
                        missing_reference = f"npm script {script}"
                except (FileNotFoundError, json.JSONDecodeError, IndexError):
                    missing_reference = str(package_path.relative_to(root))
        if missing_reference:
            blockers.append(
                _issue(
                    "GODIESEL_COMMAND_REFERENCE_INVALID",
                    f"Capability {capability_id} references an unavailable command "
                    f"target: {missing_reference}.",
                    "Correct the manifest command reference or restore its implementation.",
                )
            )
    return (
        _check(
            "command-references",
            "Resolve supported manifest command targets locally.",
            blockers,
        ),
        blockers,
    )


def _configuration_names_from_env_file(root: Path) -> set[str]:
    path = root / ".env"
    if not path.exists():
        return set()
    configured = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$", line)
        if match and match.group(2).strip().strip("'\""):
            configured.add(match.group(1))
    return configured


def _configuration_check(
    root: Path,
    manifest: Mapping[str, Any],
    environ: Mapping[str, str],
) -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, Any]]]:
    declarations: dict[str, dict[str, Any]] = {}
    for capability in manifest["capabilities"]:
        for item in capability["configuration"]:
            declaration = declarations.setdefault(
                item["name"],
                {"name": item["name"], "required_by": [], "sensitive": item["sensitive"]},
            )
            declaration["required_by"].append(
                {"capability": capability["id"], "verbs": item["required_for"]}
            )
    file_names = _configuration_names_from_env_file(root)
    warnings: list[dict[str, str]] = []
    results = []
    for name in sorted(declarations):
        declaration = declarations[name]
        configured = bool(environ.get(name)) or name in file_names
        results.append(
            {
                "name": name,
                "status": "configured" if configured else "missing",
                "required_by": declaration["required_by"],
                "sensitive": declaration["sensitive"],
            }
        )
        if not configured:
            warnings.append(
                _issue(
                    "GODIESEL_CONFIGURATION_MISSING",
                    f"Configuration {name} is not present; capabilities that require "
                    "it remain unavailable.",
                    f"Set {name} in the process environment or the ignored repository .env file.",
                )
            )
    return (
        _check(
            "configuration",
            "Configuration presence is reported without values.",
            warnings=warnings,
        ),
        warnings,
        results,
    )


def _generated_projection_check(
    root: Path,
    repository: Mapping[str, Any],
) -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, str]]]:
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    try:
        routes_config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
        route_manifest = json.loads(
            (root / "app/src/data/generated/routes.manifest.json").read_text(encoding="utf-8")
        )
        route_stats = json.loads(
            (root / "app/src/data/generated/route-stats.json").read_text(encoding="utf-8")
        )
        expected_id_list = [
            str(route["activity_id"])
            for route in routes_config.get("routes", routes_config.get("quests", []))
            if route.get("status", "approved") == "approved"
            and route.get("visibility", "public") != "hidden"
        ]
        manifest_id_list = [
            str(route["activity_id"]) for route in route_manifest["routes"]
        ]
        manifest_slug_list = [str(route["slug"]) for route in route_manifest["routes"]]
        expected_ids = set(expected_id_list)
        manifest_ids = set(manifest_id_list)
        manifest_slugs = set(manifest_slug_list)
        detail_slugs = {
            path.stem for path in (root / "app/public/data/routes").glob("*.json")
        }
        count_matches = route_stats.get("route_count") == len(route_manifest["routes"])
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError, AttributeError):
        blockers.append(
            _issue(
                "GODIESEL_GENERATED_PROJECTION_UNREADABLE",
                "Canonical or generated route inventory could not be read.",
                "Restore the route data files, then rebuild through the Python generator.",
            )
        )
    else:
        identities_are_unique = (
            len(expected_id_list) == len(expected_ids)
            and len(manifest_id_list) == len(manifest_ids)
            and len(manifest_slug_list) == len(manifest_slugs)
        )
        inventories_agree = (
            expected_ids == manifest_ids == manifest_slugs == detail_slugs
            and len(expected_id_list)
            == len(manifest_id_list)
            == len(manifest_slug_list)
            == len(detail_slugs)
        )
        if not identities_are_unique or not inventories_agree or not count_matches:
            blockers.append(
                _issue(
                    "GODIESEL_GENERATED_INVENTORY_DRIFT",
                    "Canonical route identities and generated route inventories do not agree.",
                    "Run the owning Python generator, review its diff, and rerun doctor.",
                )
            )

    changed_paths = repository["worktree"]["changed_paths"]
    canonical_changed = any(
        path == "quests.json" or path.startswith("route_sources/") for path in changed_paths
    )
    generated_changed = any(
        path.startswith("app/src/data/generated/") or path.startswith("app/public/data/routes/")
        for path in changed_paths
    )
    if canonical_changed != generated_changed:
        warnings.append(
            _issue(
                "GODIESEL_GENERATED_CONTENT_PARITY_UNPROVEN",
                "Canonical and generated route paths have not changed together in this worktree.",
                "Rebuild through the owning Python generator and verify the resulting "
                "projection diff.",
            )
        )
    return _check(
        "generated-projection",
        "Compare canonical and generated route identity inventory; content parity "
        "remains the generator test's responsibility.",
        blockers,
        warnings,
    ), blockers, warnings


def doctor_system(
    root: Path | str,
    *,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Diagnose local control readiness without mutating repository or external state."""

    root = Path(root).resolve()
    environ = dict(os.environ if environ is None else environ)
    inspection = inspect_system(root, environ=environ)
    blockers = list(inspection["blockers"])
    warnings = list(inspection["warnings"])
    checks: list[dict[str, Any]] = []

    repository_blockers = [
        issue for issue in blockers if issue["code"] == "GODIESEL_REPOSITORY_UNAVAILABLE"
    ]
    checks.append(
        _check(
            "repository",
            "Read Git commit and worktree state.",
            repository_blockers,
        )
    )

    manifest, manifest_blockers = _load_manifest(root)
    checks.append(
        _check(
            "manifest",
            "Read and validate the versioned capability manifest.",
            manifest_blockers,
        )
    )

    runtime_check, runtime_blockers, runtime_warnings, runtimes = _runtime_check(environ)
    checks.append(runtime_check)
    blockers.extend(runtime_blockers)
    warnings.extend(runtime_warnings)

    capability_file_blockers = [
        issue for capability in inspection["capabilities"] for issue in capability["blockers"]
    ]
    checks.append(
        _check(
            "capability-files",
            "Check every capability's required files and documents.",
            capability_file_blockers,
        )
    )

    document_check, document_blockers = _documentation_check(root)
    checks.append(document_check)
    blockers.extend(document_blockers)

    if manifest is None:
        command_check = _check(
            "command-references",
            "Manifest command references cannot be checked without a valid manifest.",
            manifest_blockers,
        )
        configuration_check = _check(
            "configuration",
            "Configuration requirements cannot be checked without a valid manifest.",
            manifest_blockers,
        )
        configuration: list[dict[str, Any]] = []
    else:
        command_check, command_blockers = _command_reference_check(root, manifest)
        blockers.extend(command_blockers)
        configuration_check, configuration_warnings, configuration = _configuration_check(
            root, manifest, environ
        )
        warnings.extend(configuration_warnings)
    checks.append(command_check)
    checks.append(configuration_check)

    writer_paths = ["admin.py", "build.py", "curation_publish.py", "route_create.py"]
    missing_writers = [path for path in writer_paths if not (root / path).is_file()]
    writer_blockers = [] if not missing_writers else [
        _issue(
            "GODIESEL_WRITER_MISSING",
            f"{len(missing_writers)} owning writer(s) are missing.",
            "Restore the owning writer files before applying canonical changes.",
        )
    ]
    checks.append(
        _check("writers", "Check owning canonical writer files.", writer_blockers)
    )
    blockers.extend(writer_blockers)

    projection_check, projection_blockers, projection_warnings = _generated_projection_check(
        root, inspection["repository"]
    )
    checks.append(projection_check)
    blockers.extend(projection_blockers)
    warnings.extend(projection_warnings)

    unique_blockers = list(
        {issue["code"] + issue["message"]: issue for issue in blockers}.values()
    )
    unique_warnings = list(
        {issue["code"] + issue["message"]: issue for issue in warnings}.values()
    )
    issues = unique_blockers + unique_warnings
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-system-doctor-report",
        "status": _status(unique_blockers, unique_warnings),
        "repository": inspection["repository"],
        "checks": checks,
        "runtimes": runtimes,
        "configuration": configuration,
        "capabilities": inspection["capabilities"],
        "blockers": unique_blockers,
        "warnings": unique_warnings,
        "safe_next_actions": [
            {"code": issue["code"], "action": issue["remediation"]} for issue in issues
        ],
        "next_transitions": inspection["next_transitions"],
    }


def _render_human(result: Mapping[str, Any]) -> str:
    if result["document_type"] == "godiesel-capability-result":
        lines = [
            f"{result['status'].upper()}: {result['capability']} {result['verb']}",
            f"Authority: {result['authority']}",
        ]
        receipt = result.get("receipt")
        if receipt:
            lines.append(f"Receipt: {receipt['path']}")
        for issue in result.get("blockers", []) + result.get("warnings", []):
            lines.append(f"- {issue['code']}: {issue['message']}")
        domain_result = result.get("result")
        if isinstance(domain_result, dict) and set(domain_result) == {"stdout", "stderr"}:
            if domain_result["stdout"]:
                lines.append(domain_result["stdout"].rstrip())
            if domain_result["stderr"]:
                lines.append(domain_result["stderr"].rstrip())
        else:
            lines.append(json.dumps(domain_result, indent=2, ensure_ascii=False))
        return "\n".join(lines)
    title = result["document_type"].replace("godiesel-", "").replace("-", " ")
    repository = result.get("repository", {})
    lines = [f"{result['status'].upper()}: {title}"]
    if repository.get("commit"):
        worktree = repository["worktree"]
        state = (
            "clean"
            if worktree["clean"]
            else f"dirty ({len(worktree['changed_paths'])} path(s))"
        )
        branch = repository.get("branch") or "detached HEAD"
        lines.append(f"Repository: {repository['commit'][:12]} on {branch}, {state}")
    lines.append(f"Capabilities: {len(result.get('capabilities', []))}")
    lines.append(
        f"Blockers: {len(result.get('blockers', []))}; "
        f"warnings: {len(result.get('warnings', []))}"
    )
    for issue in result.get("blockers", []) + result.get("warnings", []):
        lines.append(f"- {issue['code']}: {issue['message']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="godiesel")
    parser.add_argument(
        "verb",
        choices=("inspect", "plan", "apply", "verify", "release", "doctor"),
    )
    parser.add_argument("target", nargs="?", default="system")
    parser.add_argument("slug", nargs="?")
    parser.add_argument("share_name", nargs="?")
    parser.add_argument("--request")
    parser.add_argument("--proposal")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--detach", action="store_true")
    parser.add_argument("--replace-existing", action="store_true")
    parser.add_argument("--authorize")
    parser.add_argument("--authorize-target")
    parser.add_argument("--authorize-replacement")
    parser.add_argument("--explain", action="store_true")
    parser.add_argument("--reuse", action="store_true")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--changed-path", action="append")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    if args.explain and args.reuse:
        parser.error("--explain and --reuse are mutually exclusive")
    root = Path(__file__).resolve().parent
    try:
        if args.verb == "doctor":
            if args.target != "system":
                parser.error("doctor only supports the system target")
            result = doctor_system(root)
        elif args.target == "system":
            if args.verb == "inspect":
                result = inspect_system(root)
            elif args.verb == "verify" and args.explain:
                result = explain_verification(
                    root,
                    changed_paths=args.changed_path,
                    base_ref=args.base,
                )
            else:
                parser.error("system supports inspect, doctor, and verify --explain")
        elif args.target == "route-share":
            if args.verb == "plan" and args.request is None:
                parser.error("plan route-share requires --request")
            if args.verb == "apply" and args.proposal is None:
                parser.error("apply route-share requires --proposal")
            if args.verb in {"verify", "release"} and args.slug is None:
                parser.error(f"{args.verb} route-share requires a route slug")
            if args.verb == "release" and args.share_name is None:
                parser.error("release route-share requires a share name")
            if args.detach and not args.preview:
                parser.error("--detach requires --preview")
            if args.reuse:
                if args.verb != "verify":
                    parser.error("--reuse only supports verification")
                result = reuse_verification(
                    root,
                    "route-share",
                    slug=args.slug,
                )
            else:
                result = execute_route_share(
                    root,
                    args.verb,
                    request_path=args.request,
                    proposal_path=args.proposal,
                    slug=args.slug,
                    share_name=args.share_name,
                    preview=args.preview,
                    detach=args.detach,
                    replace_existing=args.replace_existing,
                    authority=args.authorize,
                    target_authority=args.authorize_target,
                    replacement_authority=args.authorize_replacement,
                )
        else:
            parser.error(f"unknown target: {args.target}")
    except Exception:
        if args.target == "route-share" and args.verb in ROUTE_SHARE_AUTHORITY:
            issue = _issue(
                "GODIESEL_CONTROL_INTERNAL_ERROR",
                "The route-share transition could not produce a complete result.",
                "Run the focused route-share adapter tests and inspect ignored local receipts before retrying.",
            )
            result = {
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-capability-result",
                "capability": "route-share",
                "verb": args.verb,
                "status": "blocked",
                "authority": ROUTE_SHARE_AUTHORITY[args.verb],
                "authorized": False,
                "exit_code": 2,
                "result": None,
                "result_contract": "none",
                "blockers": [issue],
                "warnings": [],
                "receipt": None,
                "evidence": None,
            }
        else:
            issue = _issue(
                "GODIESEL_CONTROL_INTERNAL_ERROR",
                "The read-only control inspection could not complete.",
                "Run the focused control-plane tests and inspect the local repository state.",
            )
            result = {
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-control-error",
                "status": "blocked",
                "repository": {
                    "commit": None,
                    "branch": None,
                    "worktree": {"clean": False, "changed_paths": []},
                },
                "capabilities": [],
                "blockers": [issue],
                "warnings": [],
                "next_transitions": [],
            }
    if args.as_json:
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    else:
        print(_render_human(result))
    return int(result.get("exit_code", 2 if result["status"] == "blocked" else 0))


if __name__ == "__main__":
    raise SystemExit(main())
