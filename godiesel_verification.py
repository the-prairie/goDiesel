"""Manifest-owned impact selection for proportionate verification."""

from __future__ import annotations

import ast
import ctypes
import fnmatch
import json
import os
import re
import select
import stat
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Callable, Iterable, Mapping, Sequence
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from jsonschema import Draft202012Validator

from godiesel_evidence import canonical_digest, repository_snapshot


SCHEMA_VERSION = 1
MANIFEST_PATH = Path("system/capabilities.json")
EVIDENCE_SCHEMA_PATH = Path("system/evidence-receipt.schema.json")
EVIDENCE_ROOT = Path(".godiesel/evidence")
VERIFICATION_TIERS = {"focused", "ticket", "release", "live"}
LIVE_PROOF_MAX_AGE_SECONDS = 15 * 60
SOURCE_SUFFIXES = (
    ".py", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"
)
SCRIPT_IMPORT_PATTERN = re.compile(
    r"(?:\b(?:import|export)\s+(?:[^\n;]*?\s+from\s+)?|\bimport\s*\()"
    r"[\"']([^\"']+)[\"']"
)
SCRIPT_FROM_PATTERN = re.compile(r"\bfrom\s*[\"']([^\"']+)[\"']")
SCRIPT_REQUIRE_PATTERN = re.compile(r"\brequire\s*\(\s*[\"']([^\"']+)[\"']\s*\)")


class UnsafeCoveredInputSymlink(ValueError):
    """A proof input reaches a broken or repository-external symlink."""


class ProofInputMonitor:
    """Record covered-input filesystem events that before/after hashes can miss."""

    def __init__(self, root: Path, snapshot: Mapping[str, Any]):
        self.root = root
        self.paths = self._paths(snapshot)
        self.before = self._state()
        self.kqueue = None
        self.descriptors: list[int] = []
        self.inotify_fd: int | None = None
        if hasattr(select, "kqueue"):
            self._start_kqueue()
        elif os.name == "posix":
            self._start_inotify()

    def _paths(self, snapshot: Mapping[str, Any]) -> list[Path]:
        paths: set[Path] = set()
        for item in snapshot.get("covered_inputs", []):
            if item.get("state") not in {"matched", "absent"}:
                continue
            normalized = _normalized_path(str(item.get("name", "")))
            if normalized is None:
                continue
            recursive_pattern = normalized.endswith("/**")
            glob_pattern = f"{normalized}/*" if normalized.endswith("/**") else normalized
            candidates = [
                candidate
                for candidate in self.root.glob(glob_pattern)
                if candidate.is_file() and candidate.is_relative_to(self.root)
            ]
            try:
                paths.update(_dependency_closure(self.root, candidates))
            except (OSError, RuntimeError, SyntaxError, UnicodeError, ValueError):
                paths.update(candidates)
            anchor = self.root
            for part in PurePosixPath(normalized).parts:
                if any(token in part for token in ("*", "?", "[")):
                    break
                anchor = anchor / part
            if recursive_pattern:
                paths.add(anchor if anchor.is_dir() else anchor.parent)
            elif not candidates:
                paths.add(anchor.parent)
        return sorted(path for path in paths if path.exists())

    def _state(self) -> dict[str, tuple[int, int, int]]:
        state = {}
        for path in self.paths:
            try:
                details = path.stat()
                state[path.as_posix()] = (
                    details.st_ino,
                    details.st_size,
                    details.st_mtime_ns,
                )
            except OSError:
                state[path.as_posix()] = (-1, -1, -1)
        return state

    def _start_kqueue(self) -> None:
        self.kqueue = select.kqueue()
        events = []
        flags = (
            select.KQ_NOTE_WRITE
            | select.KQ_NOTE_DELETE
            | select.KQ_NOTE_EXTEND
            | select.KQ_NOTE_ATTRIB
            | select.KQ_NOTE_RENAME
            | select.KQ_NOTE_REVOKE
        )
        for path in self.paths:
            try:
                descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                continue
            self.descriptors.append(descriptor)
            events.append(
                select.kevent(
                    descriptor,
                    filter=select.KQ_FILTER_VNODE,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                    fflags=flags,
                )
            )
        if events:
            self.kqueue.control(events, 0, 0)

    def _start_inotify(self) -> None:
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
            if fd < 0:
                return
            mask = 0x00000FFF
            for path in self.paths:
                libc.inotify_add_watch(fd, os.fsencode(path), mask)
            self.inotify_fd = fd
        except (AttributeError, OSError):
            self.inotify_fd = None

    def changed(self) -> bool:
        event_seen = False
        if self.kqueue is not None:
            event_seen = bool(self.kqueue.control(None, max(1, len(self.paths)), 0))
        if self.inotify_fd is not None:
            try:
                event_seen = bool(os.read(self.inotify_fd, 65536)) or event_seen
            except BlockingIOError:
                pass
        return event_seen or self._state() != self.before

    def close(self) -> None:
        if self.kqueue is not None:
            self.kqueue.close()
        for descriptor in self.descriptors:
            os.close(descriptor)
        if self.inotify_fd is not None:
            os.close(self.inotify_fd)


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def _normalized_path(value: str) -> str | None:
    candidate = value.replace("\\", "/")
    path = PurePosixPath(candidate)
    if (
        path.is_absolute()
        or PureWindowsPath(value).drive
        or not candidate
        or ".." in path.parts
    ):
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


def _file_digest(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unsafe_symlink_in_path(root: Path, path: Path) -> bool:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        try:
            if not current.is_symlink():
                continue
            resolved = current.resolve(strict=True)
        except (OSError, RuntimeError):
            return True
        if not resolved.is_relative_to(root):
            return True
    return False


def _resolve_local_module(root: Path, source: Path, module: str) -> Path | None:
    if module.startswith("@/"):
        base = root / "app/src" / module[2:]
    elif module.startswith("."):
        if source.suffix == ".py":
            level = len(module) - len(module.lstrip("."))
            package_root = source.parent
            for _ in range(max(0, level - 1)):
                package_root = package_root.parent
            base = package_root / module[level:].replace(".", "/")
        else:
            base = source.parent / module
    elif source.suffix == ".py":
        base = root / module.replace(".", "/")
    else:
        return None
    candidates = [base]
    if base.suffix not in SOURCE_SUFFIXES:
        candidates.extend(base.with_suffix(suffix) for suffix in SOURCE_SUFFIXES)
        candidates.extend(base / f"index{suffix}" for suffix in SOURCE_SUFFIXES)
        candidates.append(base / "__init__.py")
    for candidate in candidates:
        normalized_candidate = Path(os.path.abspath(candidate))
        if normalized_candidate.is_file() and normalized_candidate.is_relative_to(root):
            return normalized_candidate
    return None


def _source_dependencies(root: Path, source: Path) -> list[Path]:
    if source.suffix not in SOURCE_SUFFIXES:
        return []
    text = source.read_text(encoding="utf-8")
    modules: set[str] = set()
    if source.suffix == ".py":
        tree = ast.parse(text, filename=source.as_posix())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                prefix = "." * node.level
                module = prefix + (node.module or "")
                if module:
                    modules.add(module)
                modules.update(
                    f"{module}.{alias.name}" if node.module else f"{prefix}{alias.name}"
                    for alias in node.names
                    if alias.name != "*"
                )
    else:
        modules.update(SCRIPT_IMPORT_PATTERN.findall(text))
        modules.update(SCRIPT_FROM_PATTERN.findall(text))
        modules.update(SCRIPT_REQUIRE_PATTERN.findall(text))
    return sorted(
        {
            dependency
            for module in modules
            if (dependency := _resolve_local_module(root, source, module)) is not None
        }
    )


def _dependency_closure(root: Path, seeds: Iterable[Path]) -> list[Path]:
    pending = list(seeds)
    observed: set[Path] = set()
    while pending:
        source = pending.pop()
        if source in observed:
            continue
        if _unsafe_symlink_in_path(root, source):
            raise UnsafeCoveredInputSymlink
        observed.add(source)
        pending.extend(
            dependency
            for dependency in _source_dependencies(root, source)
            if dependency not in observed
        )
    return sorted(observed)


def proof_snapshot_stability_issues(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
) -> list[dict[str, str]]:
    if after["status"] != "passed":
        return [
            _issue(
                "GODIESEL_VERIFICATION_POSTCHECK_FAILED",
                "Verification finished but its covered inputs could not be rechecked.",
                "Restore the covered inputs and rerun verification before reusing proof.",
            ),
            *after["blockers"],
        ]
    if after["proof_fingerprint"] != before["proof_fingerprint"]:
        return [
            _issue(
                "GODIESEL_VERIFICATION_INPUTS_CHANGED",
                "One or more covered inputs changed while the verification gate was running.",
                "Stabilize the worktree and rerun verification against one unchanged input set.",
            )
        ]
    return []


def read_target_build_identity(provider_target: str) -> Mapping[str, object]:
    parsed_target = urlparse(provider_target)
    if parsed_target.path not in ("", "/"):
        raise ValueError("provider target must identify an origin root")
    identity_url = f"{parsed_target.scheme}://{parsed_target.netloc}/build-identity.json"
    request = Request(identity_url, headers={"Accept": "application/json"})

    class RejectRedirects(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, newurl):
            return None

    with build_opener(RejectRedirects()).open(request, timeout=5) as response:
        payload = response.read(65_537)
    if len(payload) > 65_536:
        raise ValueError("build identity exceeds the bounded response size")
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("build identity is not an object")
    return value


def verified_provider_build_identity(
    root: Path,
    provider_target: str,
    *,
    target_identity_reader: Callable[[str], Mapping[str, object]] = read_target_build_identity,
    repository_reader: Callable[[Path], Mapping[str, object]] = repository_snapshot,
) -> tuple[dict[str, object] | None, list[dict[str, str]]]:
    repository = dict(repository_reader(root))
    commit = repository.get("commit")
    dirty_state = repository.get("dirty_state")
    tree = repository.get("tree")
    if tree is None:
        try:
            tree = subprocess.run(
                ["git", "rev-parse", "HEAD^{tree}"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            tree = None
    if (
        not isinstance(commit, str)
        or re.fullmatch(r"[a-f0-9]{40}", commit) is None
        or not isinstance(tree, str)
        or re.fullmatch(r"[a-f0-9]{40}", tree) is None
        or not isinstance(dirty_state, Mapping)
        or dirty_state.get("clean") is not True
    ):
        return None, [
            _issue(
                "GODIESEL_PROVIDER_LOCAL_BUILD_UNBOUND",
                "Live provider proof requires one clean local commit to identify the expected build.",
                "Commit the exact implementation to verify, then deploy a preview from that commit.",
            )
        ]
    try:
        identity = dict(target_identity_reader(provider_target))
        schema = json.loads(
            (root / "system/build-identity.schema.json").read_text(encoding="utf-8")
        )
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema).validate(identity)
    except Exception:
        return None, [
            _issue(
                "GODIESEL_PROVIDER_BUILD_IDENTITY_UNREADABLE",
                "The named live target did not expose a valid goDiesel build identity.",
                "Deploy this branch with build-identity.json enabled, then retry the exact target.",
            )
        ]
    if identity["commit"] != commit:
        return None, [
            _issue(
                "GODIESEL_PROVIDER_BUILD_IDENTITY_MISMATCH",
                "The named live target was built from a different commit.",
                "Deploy the exact local commit to a preview target, then verify that target.",
            )
        ]
    if identity["tree"] != tree:
        return None, [
            _issue(
                "GODIESEL_PROVIDER_BUILD_TREE_MISMATCH",
                "The named live target was built from a different source tree.",
                "Deploy the exact clean local tree to a preview target, then verify that target.",
            )
        ]
    return identity, []


def _pattern_input(
    root: Path,
    *,
    category: str,
    pattern: str,
) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    normalized = _normalized_path(pattern)
    if normalized is None:
        return None, _issue(
            "GODIESEL_IMPACT_PATTERN_INVALID",
            "An impact pattern is absolute, empty, or escapes the repository.",
            "Repair the named pattern in system/capabilities.json.",
        )
    glob_pattern = f"{normalized}/*" if normalized.endswith("/**") else normalized
    try:
        anchor_parts = []
        for part in PurePosixPath(normalized).parts:
            if any(token in part for token in ("*", "?", "[")):
                break
            anchor_parts.append(part)
        anchor = root.joinpath(*anchor_parts) if anchor_parts else root
        if anchor.exists() or anchor.is_symlink():
            if _unsafe_symlink_in_path(root, anchor):
                raise UnsafeCoveredInputSymlink
            if anchor.is_dir():
                mode = stat.S_IMODE(anchor.stat().st_mode)
                if mode & 0o444 == 0 or mode & 0o111 == 0:
                    raise PermissionError
        candidates = sorted(
            path
            for path in root.glob(glob_pattern)
            if path.is_relative_to(root) and (path.is_symlink() or path.is_file())
        )
        if any(_unsafe_symlink_in_path(root, path) for path in candidates):
            raise UnsafeCoveredInputSymlink
    except UnsafeCoveredInputSymlink:
        return None, _issue(
            "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE",
            "A covered input is a broken or repository-escaping symbolic link.",
            "Replace it with a repository-contained file or symbolic link before verification.",
        )
    except ValueError:
        return None, _issue(
            "GODIESEL_COVERED_INPUT_UNAVAILABLE",
            f"The covered input pattern {normalized} could not be read.",
            "Repair the repository input and rerun verification before reuse.",
        )
    except OSError:
        return None, _issue(
            "GODIESEL_COVERED_INPUT_UNAVAILABLE",
            f"The covered input pattern {normalized} could not be read.",
            "Repair the repository input and rerun verification before reuse.",
        )
    observed = []
    try:
        for path in _dependency_closure(root, candidates):
            if _unsafe_symlink_in_path(root, path):
                raise UnsafeCoveredInputSymlink
            metadata = path.lstat()
            if path.is_symlink():
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root) or not resolved.is_file():
                    raise UnsafeCoveredInputSymlink
            entry = {
                "path": path.relative_to(root).as_posix(),
                "kind": "symlink" if path.is_symlink() else "file",
                "mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
                "sha256": _file_digest(path),
            }
            if path.is_symlink():
                entry["target"] = path.readlink().as_posix()
            observed.append(entry)
    except UnsafeCoveredInputSymlink:
        return None, _issue(
            "GODIESEL_COVERED_INPUT_SYMLINK_UNSAFE",
            "A covered input is a broken or repository-escaping symbolic link.",
            "Replace it with a repository-contained file or symbolic link before verification.",
        )
    except ValueError:
        return None, _issue(
            "GODIESEL_COVERED_INPUT_UNAVAILABLE",
            f"The covered input pattern {normalized} could not be read.",
            "Repair the repository input and rerun verification before reuse.",
        )
    except (OSError, RuntimeError, SyntaxError, UnicodeError):
        return None, _issue(
            "GODIESEL_COVERED_INPUT_UNAVAILABLE",
            f"The covered input pattern {normalized} could not be read.",
            "Repair the repository input and rerun verification before reuse.",
        )
    return (
        {
            "category": category,
            "name": normalized,
            "state": "matched" if observed else "absent",
            "sha256": canonical_digest(observed),
        },
        None,
    )


def build_proof_snapshot(
    root: Path | str,
    capability_id: str,
    *,
    tiers: Sequence[str],
    commands: Sequence[str] | None = None,
    environ: Mapping[str, str] | None = None,
    provider_target: str | None = None,
    provider_identity: Mapping[str, object] | None = None,
) -> dict[str, Any]:
    """Fingerprint every manifest input covered by the selected capability gates."""

    root = Path(root).resolve()
    environ = {} if environ is None else environ
    manifest, blockers = _load_manifest(root)
    if manifest is None:
        return {
            "status": "blocked",
            "covered_inputs": [],
            "configuration": [],
            "impact_rules": [],
            "gates": [],
            "proof_fingerprint": canonical_digest([]),
            "blockers": blockers,
        }
    capability = next(
        (
            value
            for value in manifest["capabilities"]
            if value.get("id") == capability_id
        ),
        None,
    )
    if capability is None:
        blockers.append(
            _issue(
                "GODIESEL_CAPABILITY_UNKNOWN",
                f"The capability {capability_id} is not in the manifest.",
                "Inspect the system capability inventory and select a named capability.",
            )
        )
        return {
            "status": "blocked",
            "covered_inputs": [],
            "configuration": [],
            "impact_rules": [],
            "gates": [],
            "proof_fingerprint": canonical_digest([]),
            "blockers": blockers,
        }
    selected_tiers = sorted(set(tiers))
    unknown_tiers = sorted(set(selected_tiers) - VERIFICATION_TIERS)
    unavailable_tiers = sorted(
        tier for tier in selected_tiers if tier not in capability.get("verification", {})
    )
    if unknown_tiers or unavailable_tiers:
        named = ", ".join(unknown_tiers or unavailable_tiers)
        blockers.append(
            _issue(
                "GODIESEL_VERIFICATION_TIER_UNKNOWN",
                f"The verification tier selection contains unsupported tier(s): {named}.",
                "Select focused, ticket, release, or live proof declared by the capability manifest.",
            )
        )
        return {
            "status": "blocked",
            "covered_inputs": [],
            "configuration": [],
            "impact_rules": [],
            "gates": [],
            "proof_fingerprint": canonical_digest([]),
            "blockers": blockers,
        }
    gate_refs = {(capability_id, tier) for tier in selected_tiers}
    selected_command_items = [
        (tier, item)
        for tier in selected_tiers
        for item in capability["verification"][tier]
    ]
    if commands is not None:
        requested_commands = set(commands)
        declared_commands = {
            item["command"] for _, item in selected_command_items
        }
        if requested_commands - declared_commands:
            blockers.append(
                _issue(
                    "GODIESEL_VERIFICATION_COMMAND_UNKNOWN",
                    "The selected verification command is not declared by the capability tier.",
                    "Select an exact command returned by capability inspection.",
                )
            )
        selected_command_items = [
            (tier, item)
            for tier, item in selected_command_items
            if item["command"] in requested_commands
        ]
    impact_patterns = {
            (rule["category"], pattern)
            for rule in manifest["impact_rules"]
            if any(
                (gate["capability"], gate["tier"]) in gate_refs
                for gate in rule["gates"]
            )
            for pattern in rule["paths"]
        }
    command_patterns = {
            (proof_input["category"], pattern)
            for _, item in selected_command_items
            for proof_input in item.get("proof_inputs", [])
            for pattern in proof_input["paths"]
        }
    exact_command_inputs = (
        commands is not None
        and bool(selected_command_items)
        and all(item.get("proof_inputs") for _, item in selected_command_items)
    )
    patterns = sorted(
        command_patterns if exact_command_inputs else impact_patterns | command_patterns
    )
    impact_rule_ids = sorted(
        {
            rule["id"]
            for rule in manifest["impact_rules"]
            if any(
                (gate["capability"], gate["tier"]) in gate_refs
                for gate in rule["gates"]
            )
        }
    )
    covered_inputs: list[dict[str, str]] = []
    for category, pattern in patterns:
        covered, issue = _pattern_input(root, category=category, pattern=pattern)
        if issue is not None:
            blockers.append(issue)
        elif covered is not None:
            covered_inputs.append(covered)

    configuration: list[dict[str, Any]] = []
    requirements = {
        (
            "verify:live"
            if tier == "live"
            else "release"
            if tier == "release"
            else "verify"
        )
        for tier in selected_tiers
    }
    for item in capability.get("configuration", []):
        if not requirements.intersection(item["required_for"]):
            continue
        name = item["name"]
        present = bool(environ.get(name))
        required_for = sorted(requirements.intersection(item["required_for"]))
        configuration.append(
            {"name": name, "present": present, "required_for": required_for}
        )
        covered_inputs.append(
            {
                "category": "configuration",
                "name": name,
                "state": "present" if present else "missing",
                "sha256": canonical_digest({"name": name, "present": present}),
            }
        )
        if not present:
            blockers.append(
                _issue(
                    (
                        "GODIESEL_LIVE_CONFIGURATION_MISSING"
                        if "verify:live" in required_for
                        else "GODIESEL_VERIFICATION_CONFIGURATION_MISSING"
                    ),
                    f"Required verification configuration {name} is unavailable.",
                    "Provide the named configuration without exposing its value, then rerun verification.",
                )
            )
        elif not item["sensitive"]:
            covered_inputs.append(
                {
                    "category": "provider",
                    "name": f"target:{name}",
                    "state": "target",
                    "sha256": canonical_digest(environ[name]),
                }
            )
    if provider_target is not None:
        covered_inputs.append(
            {
                "category": "provider",
                "name": "explicit-provider-target",
                "state": "target",
                "sha256": canonical_digest(provider_target),
            }
        )
        if provider_identity is not None:
            covered_inputs.append(
                {
                    "category": "provider",
                    "name": "deployed-build-identity",
                    "state": "observed",
                    "sha256": canonical_digest(provider_identity),
                }
            )
    elif "live" in selected_tiers:
        blockers.append(
            _issue(
                "GODIESEL_LIVE_TARGET_MISSING",
                "Live verification requires the exact provider or deployment target.",
                "Pass the named public URL or provider target so the live proof is target-bound.",
            )
        )
    covered_inputs = sorted(
        covered_inputs,
        key=lambda item: (item["category"], item["name"], item["state"]),
    )
    gates = sorted(
        (
            {"tier": tier, "command": item["command"], "cwd": item["cwd"]}
            for tier, item in selected_command_items
        ),
        key=lambda gate: (gate["tier"], gate["command"], gate["cwd"]),
    )
    proof_fingerprint = canonical_digest(
        {
            "capability": capability_id,
            "gates": gates,
            "covered_inputs": covered_inputs,
        }
    )
    return {
        "status": "blocked" if blockers else "passed",
        "covered_inputs": covered_inputs,
        "configuration": configuration,
        "impact_rules": impact_rule_ids,
        "gates": gates,
        "proof_fingerprint": proof_fingerprint,
        "blockers": blockers,
    }


def _reuse_result(
    capability_id: str,
    *,
    status: str,
    explanation: Mapping[str, Any],
    blockers: Sequence[Mapping[str, str]],
    evidence: Mapping[str, str] | None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-capability-result",
        "capability": capability_id,
        "verb": "verify",
        "status": status,
        "authority": "ephemeral-local",
        "authorized": True,
        "exit_code": 2 if status == "blocked" else 0,
        "result": dict(explanation),
        "result_contract": "system/verification-reuse.schema.json",
        "blockers": [dict(item) for item in blockers],
        "warnings": [],
        "receipt": None,
        "evidence": dict(evidence) if evidence else None,
    }


def _covered_input_changes(
    previous: Sequence[Mapping[str, str]],
    current: Sequence[Mapping[str, str]],
) -> list[dict[str, str]]:
    previous_map = {
        (item["category"], item["name"]): (item["state"], item["sha256"])
        for item in previous
    }
    current_map = {
        (item["category"], item["name"]): (item["state"], item["sha256"])
        for item in current
    }
    return [
        {"category": category, "name": name}
        for category, name in sorted(set(previous_map) | set(current_map))
        if previous_map.get((category, name)) != current_map.get((category, name))
    ]


def _live_proof_is_stale(receipt: Mapping[str, Any]) -> bool:
    try:
        finished_at = datetime.fromisoformat(str(receipt["finished_at"]))
        if finished_at.tzinfo is None:
            return True
        age_seconds = (datetime.now(timezone.utc) - finished_at).total_seconds()
    except (KeyError, TypeError, ValueError):
        return True
    return age_seconds < -60 or age_seconds > LIVE_PROOF_MAX_AGE_SECONDS


def reuse_verification(
    root: Path | str,
    capability_id: str,
    *,
    slug: str | None = None,
    expected_inputs: Mapping[str, object] | None = None,
    environ: Mapping[str, str] | None = None,
    provider_target: str | None = None,
    target_identity_reader: Callable[[str], Mapping[str, object]] = read_target_build_identity,
    repository_reader: Callable[[Path], Mapping[str, object]] = repository_snapshot,
) -> dict[str, Any]:
    """Reuse the newest valid passed proof whose complete fingerprint still matches."""

    root = Path(root).resolve()
    schema_path = root / EVIDENCE_SCHEMA_PATH
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
    except Exception:
        blocker = _issue(
            "GODIESEL_EVIDENCE_SCHEMA_UNAVAILABLE",
            "The evidence receipt schema could not be validated.",
            "Restore system/evidence-receipt.schema.json before attempting proof reuse.",
        )
        explanation = {
            "schema_version": SCHEMA_VERSION,
            "document_type": "godiesel-verification-reuse",
            "reused": False,
            "source_receipt": None,
            "proof_fingerprint": canonical_digest([]),
            "source_proof_fingerprint": None,
            "covered_inputs": [],
            "invalidated_inputs": [],
            "reason": blocker["message"],
        }
        return _reuse_result(
            capability_id,
            status="blocked",
            explanation=explanation,
            blockers=[blocker],
            evidence=None,
        )

    required_input_digests = {
        name: canonical_digest(value)
        for name, value in (expected_inputs or {}).items()
    }
    if slug is not None:
        required_input_digests["route-slug"] = canonical_digest(slug)
    candidates: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted((root / EVIDENCE_ROOT).glob("*.json"), reverse=True):
        try:
            receipt = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not validator.is_valid(receipt):
            continue
        if (
            receipt.get("capability") == capability_id
            and receipt.get("verb") == "verify"
            and receipt.get("status") == "passed"
            and all(
                any(
                    item.get("name") == name and item.get("sha256") == digest
                    for item in receipt.get("inputs", [])
                )
                for name, digest in required_input_digests.items()
            )
        ):
            candidates.append((path, receipt))

    provider_identity = None
    if candidates and capability_id == "provider-readiness":
        if provider_target is None:
            identity_blockers = [
                _issue(
                    "GODIESEL_LIVE_TARGET_MISSING",
                    "Live verification reuse requires the exact deployment target.",
                    "Pass the same provider target used by the recorded live proof.",
                )
            ]
        else:
            provider_identity, identity_blockers = verified_provider_build_identity(
                root,
                provider_target,
                target_identity_reader=target_identity_reader,
                repository_reader=repository_reader,
            )
        if identity_blockers:
            explanation = {
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-verification-reuse",
                "reused": False,
                "source_receipt": candidates[0][0].relative_to(root).as_posix(),
                "proof_fingerprint": canonical_digest([]),
                "source_proof_fingerprint": candidates[0][1]["proof_fingerprint"],
                "covered_inputs": [],
                "invalidated_inputs": [],
                "reason": identity_blockers[0]["message"],
            }
            return _reuse_result(
                capability_id,
                status="blocked",
                explanation=explanation,
                blockers=identity_blockers,
                evidence=None,
            )

    latest_invalidated: tuple[Path, dict[str, Any], dict[str, Any]] | None = None
    for path, receipt in candidates:
        tiers = sorted({gate["tier"] for gate in receipt["gates"]})
        live_proof_stale = "live" in tiers and _live_proof_is_stale(receipt)
        snapshot = build_proof_snapshot(
            root,
            capability_id,
            tiers=tiers,
            commands=[gate["command"] for gate in receipt["gates"]],
            environ=environ,
            provider_target=provider_target,
            provider_identity=provider_identity,
        )
        relative_path = path.relative_to(root).as_posix()
        explanation = {
            "schema_version": SCHEMA_VERSION,
            "document_type": "godiesel-verification-reuse",
            "reused": (
                snapshot["proof_fingerprint"] == receipt["proof_fingerprint"]
                and not live_proof_stale
            ),
            "source_receipt": relative_path,
            "proof_fingerprint": snapshot["proof_fingerprint"],
            "source_proof_fingerprint": receipt["proof_fingerprint"],
            "covered_inputs": snapshot["covered_inputs"],
            "invalidated_inputs": _covered_input_changes(
                receipt["covered_inputs"], snapshot["covered_inputs"]
            ),
            "reason": (
                "Live-provider evidence is older than the 15-minute reuse window."
                if live_proof_stale
                else
                "Every covered input and selected gate remains unchanged."
                if snapshot["proof_fingerprint"] == receipt["proof_fingerprint"]
                else "One or more covered inputs or selected gates changed."
            ),
        }
        evidence = {
            "id": receipt["receipt_id"],
            "path": relative_path,
            "sha256": _file_digest(path),
        }
        if snapshot["status"] == "blocked":
            return _reuse_result(
                capability_id,
                status="blocked",
                explanation=explanation,
                blockers=snapshot["blockers"],
                evidence=evidence,
            )
        if live_proof_stale:
            return _reuse_result(
                capability_id,
                status="blocked",
                explanation=explanation,
                blockers=[
                    _issue(
                        "GODIESEL_LIVE_PROOF_STALE",
                        "Live-provider evidence is outside the 15-minute reuse window.",
                        "Run the named live verification again before claiming current readiness.",
                    )
                ],
                evidence=evidence,
            )
        if explanation["reused"]:
            return _reuse_result(
                capability_id,
                status="passed",
                explanation=explanation,
                blockers=[],
                evidence=evidence,
            )
        if latest_invalidated is None:
            latest_invalidated = (path, receipt, explanation)

    if latest_invalidated is not None:
        path, receipt, explanation = latest_invalidated
        blocker = _issue(
            "GODIESEL_PROOF_INVALIDATED",
            "The available verification proof no longer covers the current inputs.",
            "Run the selected verification gate and record a new evidence receipt.",
        )
        return _reuse_result(
            capability_id,
            status="blocked",
            explanation=explanation,
            blockers=[blocker],
            evidence={
                "id": receipt["receipt_id"],
                "path": path.relative_to(root).as_posix(),
                "sha256": _file_digest(path),
            },
        )

    snapshot = build_proof_snapshot(
        root,
        capability_id,
        tiers=["focused"],
        environ=environ,
        provider_target=provider_target,
    )
    blocker = _issue(
        "GODIESEL_REUSABLE_PROOF_NOT_FOUND",
        "No schema-valid passed evidence receipt exists for this capability input.",
        "Run verification normally before requesting proof reuse.",
    )
    explanation = {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-verification-reuse",
        "reused": False,
        "source_receipt": None,
        "proof_fingerprint": snapshot["proof_fingerprint"],
        "source_proof_fingerprint": None,
        "covered_inputs": snapshot["covered_inputs"],
        "invalidated_inputs": [],
        "reason": blocker["message"],
    }
    return _reuse_result(
        capability_id,
        status="blocked",
        explanation=explanation,
        blockers=[*snapshot["blockers"], blocker],
        evidence=None,
    )


def _selected_gates(
    root: Path,
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
                commands = capability["verification"][tier]
                applicable_commands = [
                    command
                    for command in commands
                    if not command.get("proof_inputs")
                    or _command_covers_path(root, command, path)
                ]
                if not applicable_commands:
                    applicable_commands = commands
                for command in applicable_commands:
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


def _command_covers_path(
    root: Path,
    command: Mapping[str, Any],
    path: str,
    *,
    category: str | None = None,
) -> bool:
    for proof_input in command.get("proof_inputs", []):
        if category is not None and proof_input["category"] != category:
            continue
        if _matches(path, proof_input["paths"]):
            return True
        seeds: list[Path] = []
        try:
            for pattern in proof_input["paths"]:
                normalized = _normalized_path(pattern)
                if normalized is None:
                    continue
                glob_pattern = (
                    f"{normalized}/*" if normalized.endswith("/**") else normalized
                )
                seeds.extend(
                    candidate
                    for candidate in root.glob(glob_pattern)
                    if candidate.is_file() and candidate.is_relative_to(root)
                )
            dependencies = {
                candidate.relative_to(root).as_posix()
                for candidate in _dependency_closure(root, seeds)
            }
        except (OSError, SyntaxError, UnicodeError, ValueError):
            continue
        if path in dependencies:
            return True
    return False


def _rule_covers_dependency(
    root: Path,
    manifest: Mapping[str, Any],
    rule: Mapping[str, Any],
    path: str,
) -> bool:
    capabilities = {
        capability["id"]: capability for capability in manifest["capabilities"]
    }
    for gate in rule["gates"]:
        commands = capabilities[gate["capability"]]["verification"][gate["tier"]]
        for command in commands:
            for proof_input in command.get("proof_inputs", []):
                seeds: list[Path] = []
                try:
                    for pattern in proof_input["paths"]:
                        normalized = _normalized_path(pattern)
                        if normalized is None:
                            continue
                        glob_pattern = (
                            f"{normalized}/*"
                            if normalized.endswith("/**")
                            else normalized
                        )
                        seeds.extend(
                            candidate
                            for candidate in root.glob(glob_pattern)
                            if candidate.is_file() and candidate.is_relative_to(root)
                        )
                    seed_paths = {
                        seed.relative_to(root).as_posix() for seed in seeds
                    }
                    if not any(_matches(seed, rule["paths"]) for seed in seed_paths):
                        continue
                    dependencies = {
                        candidate.relative_to(root).as_posix()
                        for candidate in _dependency_closure(root, seeds)
                    }
                except (
                    OSError,
                    RuntimeError,
                    SyntaxError,
                    UnicodeError,
                    ValueError,
                ):
                    continue
                if path in dependencies:
                    return True
    return False


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
                or _rule_covers_dependency(root, manifest, rule, path)
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
                    "invariants": sorted(
                        {
                            (invariant["capability"], invariant["id"])
                            for rule in matching
                            for invariant in rule["invariants"]
                        }
                    ),
                    "rules": [rule["id"] for rule in matching],
                }
            )
            classifications[-1]["invariants"] = [
                {"capability": capability, "id": invariant}
                for capability, invariant in classifications[-1]["invariants"]
            ]
    if unclassified:
        blockers.append(
            _issue(
                "GODIESEL_UNCLASSIFIED_PATH",
                f"{len(unclassified)} changed path(s) have no capability impact rule.",
                "Classify every named path in system/capabilities.json before choosing a gate.",
            )
        )
    selected_gates = (
        _selected_gates(root, manifest, classifications)
        if manifest is not None
        else []
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
