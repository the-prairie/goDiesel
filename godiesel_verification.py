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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Callable, Iterable, Mapping, Sequence
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker

from admin_curation import OwnerMutationBusyError, owner_mutation_lock
from godiesel_evidence import (
    canonical_digest,
    ensure_local_directory,
    existing_local_directory,
    repository_snapshot,
)
from route_imports import (
    DEFAULT_DIESEL_DIARIES_ROOT,
    find_strava_activity_file,
    load_strava_route_metadata,
)


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
    """A proof input reaches a symbolic link."""


class ProofInputMonitor:
    """Record covered-input filesystem events that before/after hashes can miss."""

    def __init__(self, root: Path, snapshot: Mapping[str, Any]):
        self.root = root
        self.paths = self._paths(snapshot)
        self.before = self._state()
        self.kqueue = None
        self.descriptors: list[int] = []
        self.inotify_fd: int | None = None
        self.monitoring_failed = False
        if hasattr(select, "kqueue"):
            self._start_kqueue()
        elif os.name == "posix":
            self._start_inotify()

    def _paths(self, snapshot: Mapping[str, Any]) -> list[Path]:
        paths = {
            Path(path)
            for path in snapshot.get("_monitor_paths", [])
            if Path(path).exists()
        }
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
                if not anchor.is_dir():
                    continue
                recursive_root = anchor
                paths.add(recursive_root)
                paths.update(
                    candidate
                    for candidate in recursive_root.rglob("*")
                    if candidate.is_dir()
                )
        return sorted(path for path in paths if path.exists())

    def _state(self) -> dict[str, tuple[int, int, int, int, int]]:
        state = {}
        for path in self.paths:
            try:
                details = path.stat()
                state[path.as_posix()] = (
                    details.st_ino,
                    details.st_size,
                    details.st_mtime_ns,
                    details.st_ctime_ns,
                    details.st_mode,
                )
            except OSError:
                state[path.as_posix()] = (-1, -1, -1, -1, -1)
        return state

    def _start_kqueue(self) -> None:
        try:
            self.kqueue = select.kqueue()
        except OSError:
            self.monitoring_failed = True
            return
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
                self.monitoring_failed = True
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
            try:
                self.kqueue.control(events, 0, 0)
            except OSError:
                self.monitoring_failed = True

    def _start_inotify(self) -> None:
        try:
            libc = ctypes.CDLL(None, use_errno=True)
            fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
            if fd < 0:
                self.monitoring_failed = True
                return
            # Content and directory-entry mutations matter here. Attribute-only
            # events include harmless access-time updates when a script executes.
            mask = 0x00000FCA
            for path in self.paths:
                if libc.inotify_add_watch(fd, os.fsencode(path), mask) < 0:
                    self.monitoring_failed = True
                    os.close(fd)
                    return
            self.inotify_fd = fd
        except (AttributeError, OSError):
            self.monitoring_failed = True
            self.inotify_fd = None

    def changed(self) -> bool:
        event_seen = False
        if self.kqueue is not None:
            try:
                events = self.kqueue.control(None, max(1, len(self.paths)), 0)
                event_seen = any(
                    event.fflags & ~select.KQ_NOTE_ATTRIB for event in events
                )
            except OSError:
                self.monitoring_failed = True
        if self.inotify_fd is not None:
            try:
                event_seen = bool(os.read(self.inotify_fd, 65536)) or event_seen
            except BlockingIOError:
                pass
        return self.monitoring_failed or event_seen or self._state() != self.before

    def close(self) -> None:
        if self.kqueue is not None:
            self.kqueue.close()
        for descriptor in self.descriptors:
            os.close(descriptor)
        if self.inotify_fd is not None:
            os.close(self.inotify_fd)


def _issue(code: str, message: str, remediation: str) -> dict[str, str]:
    return {"code": code, "message": message, "remediation": remediation}


def route_generation_recovery_state(
    root: Path | str,
    *,
    allowed_route_share_recovery: str | None = None,
) -> tuple[str, list[dict[str, str]]]:
    """Return fail-closed state for unresolved catalogue publication artifacts."""

    root = Path(root).resolve()
    data_root = root / "app/public/data"
    generated_root = root / "app/src/data/generated"
    detail_root = data_root / "routes"
    route_share_parent = root / ".route-share"
    route_share_recovery_root = route_share_parent / "recovery"

    def has_entry(directory: Path, predicate: Callable[[str], bool]) -> bool:
        if directory.is_symlink():
            raise OSError("catalogue recovery directory is a symbolic link")
        try:
            with os.scandir(directory) as entries:
                return any(predicate(entry.name) for entry in entries)
        except FileNotFoundError:
            return False

    try:
        pending = has_entry(
            data_root,
            lambda name: name == ".route-generation-backup"
            or name.startswith(".routes-staging-"),
        )
        pending = pending or has_entry(
            root,
            lambda name: name in {
                "quests.json.tmp",
                ".quests.json.rollback",
                ".quests.json.rollback.tmp",
            }
            or (
                name.startswith(".quests.json.")
                and name.endswith(".tmp")
            ),
        )
        if generated_root.exists() or generated_root.is_symlink():
            pending = pending or has_entry(
                generated_root,
                lambda name: name.startswith(".")
                and name.endswith((".tmp", ".recovery", ".rollback")),
            )
        if detail_root.exists() or detail_root.is_symlink():
            pending = pending or has_entry(
                detail_root,
                lambda name: name.startswith(".")
                and name.endswith((".tmp", ".recovery", ".rollback")),
            )
        if route_share_parent.exists() or route_share_parent.is_symlink():
            if existing_local_directory(root, ".route-share") is None:
                raise OSError("route-share artifact root is redirected")
        if route_share_recovery_root.exists() or route_share_recovery_root.is_symlink():
            if existing_local_directory(root, ".route-share/recovery") is None:
                raise OSError("route-share recovery root is redirected")
            pending = pending or has_entry(
                route_share_recovery_root,
                lambda name: name != allowed_route_share_recovery,
            )
    except OSError:
        return "unreadable", [
            _issue(
                "GODIESEL_ROUTE_GENERATION_RECOVERY_UNREADABLE",
                "Catalogue recovery state could not be inspected.",
                "Restore readable repository-owned catalogue paths before mutation, verification, or proof reuse.",
            )
        ]
    if pending:
        return "pending", [
            _issue(
                "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING",
                "Unresolved catalogue publication artifacts still require recovery.",
                "Repair the named writer recovery state, then inspect the catalogue before continuing.",
            )
        ]
    return "clear", []


def catalogue_recovery_monitor(root: Path | str) -> ProofInputMonitor:
    """Observe every directory that can acquire catalogue recovery residue."""

    root = Path(root).resolve()
    try:
        ensure_local_directory(root, ".godiesel/evidence")
        recovery_path = ensure_local_directory(root, ".route-share/recovery")
    except OSError:
        monitor = ProofInputMonitor(root, {"covered_inputs": [], "_monitor_paths": [str(root)]})
        monitor.monitoring_failed = True
        return monitor
    monitor_paths = [
        str(root),
        str(root / "app/public/data"),
        str(root / "app/public/data/routes"),
        str(root / "app/src/data/generated"),
        str(recovery_path),
    ]
    return ProofInputMonitor(
        root,
        {
            "covered_inputs": [],
            "_monitor_paths": monitor_paths,
        },
    )


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


def _local_regular_file(root: Path, relative_path: object) -> Path | None:
    if not isinstance(relative_path, str):
        return None
    normalized = _normalized_path(relative_path)
    if normalized != relative_path:
        return None
    current = root
    try:
        for part in PurePosixPath(normalized).parts:
            current = current / part
            mode = current.lstat().st_mode
            if stat.S_ISLNK(mode):
                return None
        if not stat.S_ISREG(current.lstat().st_mode):
            return None
        current.resolve().relative_to(root)
    except (OSError, ValueError):
        return None
    return current


def _evidence_artifacts_valid(root: Path, receipt: Mapping[str, Any]) -> bool:
    artifacts = receipt.get("artifacts")
    if not isinstance(artifacts, list):
        return False
    if receipt.get("capability") == "route-share" and not artifacts:
        return False
    for artifact in artifacts:
        if not isinstance(artifact, Mapping):
            return False
        path = _local_regular_file(root, artifact.get("path"))
        expected = artifact.get("sha256")
        if (
            path is None
            or not isinstance(expected, str)
            or re.fullmatch(r"[a-f0-9]{64}", expected) is None
            or _file_digest(path) != expected
        ):
            return False
    return True


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
    # Import lazily to avoid a module cycle while sharing the control plane's
    # closed schema and semantic validation as the verification root of trust.
    from godiesel_control import _load_manifest as load_control_manifest

    return load_control_manifest(root)


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def _file_digest(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _route_generation_external_sources(
    root: Path,
) -> tuple[dict[str, str] | None, list[str], dict[str, str] | None]:
    """Fingerprint private route inputs without exposing their filesystem paths."""
    try:
        config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
        if not isinstance(config, dict):
            raise TypeError
        routes = config.get("routes", config.get("quests", []))
        if not isinstance(routes, list) or not all(
            isinstance(route, dict) for route in routes
        ):
            raise TypeError
        repository_sources: list[dict[str, object]] = []
        repository_monitor_paths: list[str] = []
        for route in routes:
            if (
                route.get("status", "approved") != "approved"
                or route.get("visibility", "public") == "hidden"
                or not route.get("source_gpx")
            ):
                continue
            relative = _normalized_path(str(route["source_gpx"]))
            if relative is None:
                raise OSError("repository GPX path is invalid")
            source_path = root / relative
            source_stat = source_path.lstat()
            if _unsafe_symlink_in_path(root, source_path) or not stat.S_ISREG(
                source_stat.st_mode
            ):
                raise OSError("repository GPX path is unsafe")
            repository_sources.append(
                {
                    "kind": "repository-gpx",
                    "path": relative,
                    "file_type": "regular",
                    "mode": stat.S_IMODE(source_stat.st_mode),
                    "sha256": _file_digest(source_path),
                }
            )
            repository_monitor_paths.append(str(source_path))
        activity_ids = sorted(
            str(route["activity_id"])
            for route in routes
            if route.get("status", "approved") == "approved"
            and route.get("visibility", "public") != "hidden"
            and not route.get("source_gpx")
        )
        if not activity_ids:
            if not repository_sources:
                return None, [], None
            return (
                {
                    "category": "data",
                    "name": "external-private:route-generation-sources",
                    "state": "matched",
                    "sha256": canonical_digest(repository_sources),
                },
                repository_monitor_paths,
                None,
            )
        metadata_path = DEFAULT_DIESEL_DIARIES_ROOT / "activities.csv"
        if not metadata_path.is_file():
            raise OSError("private activity metadata is unavailable")
        metadata = load_strava_route_metadata(metadata_path)
        if any(activity_id not in metadata for activity_id in activity_ids):
            raise ValueError("private activity metadata is incomplete")
        sources = [
            *repository_sources,
            {
                "kind": "activity-metadata",
                "sha256": _file_digest(metadata_path),
            }
        ]
        monitor_paths = [*repository_monitor_paths, str(metadata_path)]
        for activity_id in activity_ids:
            source_path = find_strava_activity_file(activity_id)
            if source_path is None:
                raise OSError(f"private geometry is unavailable for {activity_id}")
            sources.append(
                {
                    "kind": "activity-geometry",
                    "activity_id": activity_id,
                    "sha256": _file_digest(source_path),
                }
            )
            monitor_paths.append(str(source_path))
    except (
        KeyError,
        OSError,
        TypeError,
        UnicodeError,
        ValueError,
        json.JSONDecodeError,
    ):
        return None, [], _issue(
            "GODIESEL_PRIVATE_ROUTE_SOURCE_UNAVAILABLE",
            "The private source inventory for generated routes could not be fingerprinted.",
            "Restore the declared Strava metadata and geometry sources, then rerun verification.",
        )
    return (
        {
            "category": "data",
            "name": "external-private:route-generation-sources",
            "state": "matched",
            "sha256": canonical_digest(sources),
        },
        monitor_paths,
        None,
    )


def external_route_source_fingerprint(
    root: Path | str,
) -> tuple[dict[str, str] | None, list[str], dict[str, str] | None]:
    """Return the redacted fingerprint for private route-generation inputs."""

    return _route_generation_external_sources(Path(root).resolve())


def _raise_walk_error(error: OSError) -> None:
    raise error


def _unsafe_symlink_in_path(root: Path, path: Path) -> bool:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        try:
            if current.is_symlink():
                return True
        except (OSError, RuntimeError):
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


def source_dependency_paths(
    root: Path | str,
    seeds: Iterable[Path | str],
) -> list[Path]:
    """Resolve the complete repository-local source dependency closure."""

    resolved_root = Path(root).resolve()
    resolved_seeds = []
    for seed in seeds:
        candidate = resolved_root / Path(seed)
        if not candidate.is_file() or not candidate.is_relative_to(resolved_root):
            raise OSError(f"source dependency seed is unavailable: {seed}")
        resolved_seeds.append(candidate)
    return _dependency_closure(resolved_root, resolved_seeds)


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


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def _read_target_bytes(origin: str, relative_path: str, limit: int) -> bytes:
    request = Request(
        f"{origin}/{quote(relative_path, safe='/')}",
        headers={"Accept-Encoding": "identity"},
    )
    with build_opener(_RejectRedirects()).open(request, timeout=10) as response:
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise ValueError(
            f"target artifact exceeds the bounded response size: {relative_path}"
        )
    return payload


def _artifact_manifest_files(value: object) -> list[dict[str, object]]:
    if not isinstance(value, dict) or set(value) != {
        "schema_version",
        "document_type",
        "files",
    }:
        raise ValueError("artifact manifest is not a closed object")
    if (
        value.get("schema_version") != 1
        or value.get("document_type") != "godiesel-artifact-manifest"
        or not isinstance(value.get("files"), list)
        or not value["files"]
        or len(value["files"]) > 10_000
    ):
        raise ValueError("artifact manifest header is invalid")
    files: list[dict[str, object]] = []
    previous_path = ""
    total_size = 0
    for item in value["files"]:
        if not isinstance(item, dict) or set(item) != {
            "path",
            "size",
            "sha256",
            "delivery",
        }:
            raise ValueError("artifact manifest entry is not a closed object")
        relative_path = item.get("path")
        size = item.get("size")
        digest = item.get("sha256")
        delivery = item.get("delivery")
        normalized = (
            _normalized_path(relative_path)
            if isinstance(relative_path, str)
            else None
        )
        if (
            normalized != relative_path
            or relative_path in {"artifact-manifest.json", "build-identity.json"}
            or "\\" in relative_path
            or relative_path <= previous_path
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size < 0
            or size > 64 * 1024 * 1024
            or not isinstance(digest, str)
            or re.fullmatch(r"[a-f0-9]{64}", digest) is None
            or delivery not in {"served-asset", "deployment-control"}
            or (
                delivery == "deployment-control"
                and relative_path not in {"_headers", "_redirects"}
            )
            or (
                relative_path in {"_headers", "_redirects"}
                and delivery != "deployment-control"
            )
        ):
            raise ValueError("artifact manifest entry is invalid")
        total_size += size
        if total_size > 256 * 1024 * 1024:
            raise ValueError("artifact manifest exceeds the bounded total size")
        files.append(item)
        previous_path = relative_path
    return files


def _validate_build_identity_shape(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("build identity is not an object")
    artifact_kind = value.get("artifact_kind")
    expected_keys = {
        "schema_version",
        "document_type",
        "artifact_kind",
        "commit",
        "tree",
        "build_id",
    }
    if artifact_kind in {"built-artifact", "unverified-working-tree-artifact"}:
        expected_keys.add("artifact_manifest_sha256")
    if (
        set(value) != expected_keys
        or value.get("schema_version") != 1
        or value.get("document_type") != "godiesel-build-identity"
        or artifact_kind
        not in {
            "built-artifact",
            "development-server",
            "unverified-working-tree-artifact",
        }
        or not isinstance(value.get("commit"), str)
        or re.fullmatch(r"[a-f0-9]{40}", str(value.get("commit"))) is None
        or not isinstance(value.get("tree"), str)
        or re.fullmatch(r"[a-f0-9]{40}", str(value.get("tree"))) is None
        or not isinstance(value.get("build_id"), str)
    ):
        raise ValueError("build identity has an invalid closed shape")
    try:
        UUID(str(value["build_id"]))
    except ValueError as error:
        raise ValueError("build identity has an invalid build id") from error
    if "artifact_manifest_sha256" in expected_keys and (
        not isinstance(value.get("artifact_manifest_sha256"), str)
        or re.fullmatch(
            r"[a-f0-9]{64}", str(value.get("artifact_manifest_sha256"))
        )
        is None
    ):
        raise ValueError("build identity does not bind an artifact manifest")
    return value


def read_target_build_identity(
    provider_target: str,
    *,
    expected_commit: str | None = None,
    expected_tree: str | None = None,
) -> Mapping[str, object]:
    parsed_target = urlparse(provider_target)
    if (
        parsed_target.scheme not in {"http", "https"}
        or not parsed_target.netloc
        or parsed_target.username is not None
        or parsed_target.password is not None
        or parsed_target.path not in ("", "/")
        or parsed_target.query
        or parsed_target.fragment
    ):
        raise ValueError("provider target must identify an origin root")
    origin = f"{parsed_target.scheme}://{parsed_target.netloc}"
    payload = _read_target_bytes(origin, "build-identity.json", 65_536)
    value = _validate_build_identity_shape(json.loads(payload.decode("utf-8")))
    if expected_commit is not None and value["commit"] != expected_commit:
        raise ValueError("build identity commit does not match the expected commit")
    if expected_tree is not None and value["tree"] != expected_tree:
        raise ValueError("build identity tree does not match the expected tree")
    if value.get("artifact_kind") in {
        "built-artifact",
        "unverified-working-tree-artifact",
    }:
        expected_manifest_digest = value.get("artifact_manifest_sha256")
        if (
            not isinstance(expected_manifest_digest, str)
            or re.fullmatch(r"[a-f0-9]{64}", expected_manifest_digest) is None
        ):
            raise ValueError("build identity does not bind an artifact manifest")
        manifest_payload = _read_target_bytes(
            origin, "artifact-manifest.json", 4 * 1024 * 1024
        )
        if sha256(manifest_payload).hexdigest() != expected_manifest_digest:
            raise ValueError("artifact manifest does not match the build identity")
        files = _artifact_manifest_files(json.loads(manifest_payload.decode("utf-8")))

        def verify_file(item: Mapping[str, object]) -> None:
            relative_path = str(item["path"])
            content = _read_target_bytes(origin, relative_path, int(item["size"]))
            if (
                len(content) != item["size"]
                or sha256(content).hexdigest() != item["sha256"]
            ):
                raise ValueError(
                    f"served artifact does not match its manifest: {relative_path}"
                )

        served_files = [
            item for item in files if item["delivery"] == "served-asset"
        ]
        if not served_files:
            raise ValueError("artifact manifest has no served assets")
        with ThreadPoolExecutor(max_workers=min(16, len(served_files))) as executor:
            list(executor.map(verify_file, served_files))
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
        identity = dict(
            read_target_build_identity(
                provider_target,
                expected_commit=commit,
                expected_tree=tree,
            )
            if target_identity_reader is read_target_build_identity
            else target_identity_reader(provider_target)
        )
        schema = json.loads(
            (root / "system/build-identity.schema.json").read_text(encoding="utf-8")
        )
        Draft202012Validator.check_schema(schema)
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(identity)
    except Exception:
        return None, [
            _issue(
                "GODIESEL_PROVIDER_BUILD_IDENTITY_UNREADABLE",
                "The named live target did not expose a valid goDiesel build identity.",
                "Deploy this branch with build-identity.json enabled, then retry the exact target.",
            )
        ]
    if identity["artifact_kind"] != "built-artifact":
        return None, [
            _issue(
                "GODIESEL_PROVIDER_BUILD_ARTIFACT_REQUIRED",
                "Live provider proof requires a target serving the immutable built application artifact.",
                "Build this branch and serve app/dist through the canonical preview target, then retry.",
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
                if normalized.endswith("/**"):
                    for current, directories, _files in os.walk(
                        anchor,
                        followlinks=False,
                        onerror=_raise_walk_error,
                    ):
                        for directory in [Path(current), *(
                            Path(current) / name for name in directories
                        )]:
                            if _unsafe_symlink_in_path(root, directory):
                                raise UnsafeCoveredInputSymlink
                            directory_mode = stat.S_IMODE(directory.stat().st_mode)
                            if (
                                directory_mode & 0o444 == 0
                                or directory_mode & 0o111 == 0
                            ):
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
            "A covered input traverses a symbolic link, which is not accepted as proof input.",
            "Replace it with a repository-owned regular file or directory before verification.",
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
            "A covered input traverses a symbolic link, which is not accepted as proof input.",
            "Replace it with a repository-owned regular file or directory before verification.",
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
    monitor_paths: list[str] = []
    for category, pattern in patterns:
        covered, issue = _pattern_input(root, category=category, pattern=pattern)
        if issue is not None:
            blockers.append(issue)
        elif covered is not None:
            covered_inputs.append(covered)
    if capability_id in {"route-generation", "owner-curation"}:
        external_input, external_paths, external_issue = (
            _route_generation_external_sources(root)
        )
        if external_issue is not None:
            blockers.append(external_issue)
        elif external_input is not None:
            covered_inputs.append(external_input)
            monitor_paths.extend(external_paths)

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
        "_monitor_paths": monitor_paths,
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
    _recovery_monitor: ProofInputMonitor | None = None,
    _mutation_lock_held: bool = False,
) -> dict[str, Any]:
    """Reuse the newest valid passed proof whose complete fingerprint still matches."""

    root = Path(root).resolve()
    if (
        capability_id in {"route-share", "route-generation", "owner-curation"}
        and not _mutation_lock_held
    ):
        try:
            with owner_mutation_lock(root):
                return reuse_verification(
                    root,
                    capability_id,
                    slug=slug,
                    expected_inputs=expected_inputs,
                    environ=environ,
                    provider_target=provider_target,
                    target_identity_reader=target_identity_reader,
                    repository_reader=repository_reader,
                    _recovery_monitor=_recovery_monitor,
                    _mutation_lock_held=True,
                )
        except OwnerMutationBusyError:
            blocker = _issue(
                "GODIESEL_CATALOGUE_MUTATION_BUSY",
                "Another catalogue mutation is in progress while proof reuse is requested.",
                "Wait for the active catalogue mutation to finish, then request proof reuse again.",
            )
            return _reuse_result(
                capability_id,
                status="blocked",
                explanation={
                    "schema_version": SCHEMA_VERSION,
                    "document_type": "godiesel-verification-reuse",
                    "reused": False,
                    "source_receipt": None,
                    "proof_fingerprint": canonical_digest([]),
                    "source_proof_fingerprint": None,
                    "covered_inputs": [],
                    "invalidated_inputs": [],
                    "reason": blocker["message"],
                },
                blockers=[blocker],
                evidence=None,
            )
    if (
        capability_id in {"route-share", "route-generation", "owner-curation"}
        and _recovery_monitor is None
    ):
        recovery_monitor = catalogue_recovery_monitor(root)
        try:
            result = reuse_verification(
                root,
                capability_id,
                slug=slug,
                expected_inputs=expected_inputs,
                environ=environ,
                provider_target=provider_target,
                target_identity_reader=target_identity_reader,
                repository_reader=repository_reader,
                _recovery_monitor=recovery_monitor,
                _mutation_lock_held=True,
            )
            _recovery_state, recovery_blockers = route_generation_recovery_state(root)
            recovery_changed = recovery_monitor.changed()
            if result["status"] == "passed" and (
                recovery_blockers or recovery_changed
            ):
                blockers = recovery_blockers or [
                    _issue(
                        "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED",
                        "Route-generation recovery state changed while proof reuse was evaluated.",
                        "Stabilize generated publication state, inspect route generation, and request proof reuse again.",
                    )
                ]
                explanation = dict(result["result"])
                explanation["reused"] = False
                explanation["invalidated_inputs"] = [
                    *explanation.get("invalidated_inputs", []),
                    {"category": "data", "name": "route-generation-recovery"},
                ]
                explanation["reason"] = blockers[0]["message"]
                return _reuse_result(
                    capability_id,
                    status="blocked",
                    explanation=explanation,
                    blockers=blockers,
                    evidence=result.get("evidence"),
                )
            return result
        finally:
            recovery_monitor.close()
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

    if capability_id in {"route-share", "route-generation", "owner-curation"}:
        recovery_state, recovery_blockers = route_generation_recovery_state(root)
        if recovery_blockers:
            explanation = {
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-verification-reuse",
                "reused": False,
                "source_receipt": None,
                "proof_fingerprint": canonical_digest([]),
                "source_proof_fingerprint": None,
                "covered_inputs": [],
                "invalidated_inputs": [
                    {"category": "data", "name": "route-generation-recovery"}
                ],
                "reason": recovery_blockers[0]["message"],
            }
            return _reuse_result(
                capability_id,
                status="blocked",
                explanation=explanation,
                blockers=recovery_blockers,
                evidence=None,
            )

    required_input_digests = {
        name: canonical_digest(value)
        for name, value in (expected_inputs or {}).items()
    }
    if slug is not None:
        required_input_digests["route-slug"] = canonical_digest(slug)
    candidates: list[tuple[Path, dict[str, Any]]] = []
    evidence_root_path = root / EVIDENCE_ROOT
    safe_evidence_root = existing_local_directory(root, EVIDENCE_ROOT)
    if safe_evidence_root is None and (
        evidence_root_path.exists() or evidence_root_path.is_symlink()
    ):
        blocker = _issue(
            "GODIESEL_EVIDENCE_ROOT_UNSAFE",
            "The evidence root is not a repository-owned directory.",
            "Restore a real .godiesel/evidence directory inside the checkout before proof reuse.",
        )
        return _reuse_result(
            capability_id,
            status="blocked",
            explanation={
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-verification-reuse",
                "reused": False,
                "source_receipt": None,
                "proof_fingerprint": canonical_digest([]),
                "source_proof_fingerprint": None,
                "covered_inputs": [],
                "invalidated_inputs": [],
                "reason": blocker["message"],
            },
            blockers=[blocker],
            evidence=None,
        )
    invalid_artifact_candidate: tuple[Path, dict[str, Any]] | None = None
    for path in sorted((safe_evidence_root or evidence_root_path).glob("*.json"), reverse=True):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            receipt = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not validator.is_valid(receipt):
            continue
        gates = receipt.get("gates", [])
        gates_passed = bool(gates) and all(
            gate.get("status") == "passed" and gate.get("exit_code") == 0
            for gate in gates
        )
        matches_request = (
            receipt.get("capability") == capability_id
            and receipt.get("verb") == "verify"
            and receipt.get("status") == "passed"
            and gates_passed
            and all(
                any(
                    item.get("name") == name and item.get("sha256") == digest
                    for item in receipt.get("inputs", [])
                )
                for name, digest in required_input_digests.items()
            )
        )
        if matches_request and not _evidence_artifacts_valid(root, receipt):
            if invalid_artifact_candidate is None:
                invalid_artifact_candidate = (path, receipt)
            continue
        if matches_request:
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

    if invalid_artifact_candidate is not None:
        path, receipt = invalid_artifact_candidate
        blocker = _issue(
            "GODIESEL_PROOF_ARTIFACT_INVALID",
            "A referenced verification artifact is missing or no longer matches its recorded digest.",
            "Run verification again and retain every artifact bound by the new evidence receipt.",
        )
        return _reuse_result(
            capability_id,
            status="blocked",
            explanation={
                "schema_version": SCHEMA_VERSION,
                "document_type": "godiesel-verification-reuse",
                "reused": False,
                "source_receipt": path.relative_to(root).as_posix(),
                "proof_fingerprint": canonical_digest([]),
                "source_proof_fingerprint": receipt.get("proof_fingerprint"),
                "covered_inputs": [],
                "invalidated_inputs": [
                    {"category": "artifact", "name": "evidence-artifact"}
                ],
                "reason": blocker["message"],
            },
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
    cache: dict[str, set[str]] | None = None,
) -> bool:
    cache_key = str(rule["id"])
    if cache is not None and cache_key in cache:
        return path in cache[cache_key]
    capabilities = {
        capability["id"]: capability for capability in manifest["capabilities"]
    }
    dependencies: set[str] = set()
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
                    matching_seeds = [
                        seed
                        for seed in seeds
                        if _matches(seed.relative_to(root).as_posix(), rule["paths"])
                    ]
                    dependencies.update(
                        candidate.relative_to(root).as_posix()
                        for candidate in _dependency_closure(root, matching_seeds)
                    )
                except (
                    OSError,
                    RuntimeError,
                    SyntaxError,
                    UnicodeError,
                    ValueError,
                ):
                    continue
    if cache is not None:
        cache[cache_key] = dependencies
    return path in dependencies


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
        dependency_cache: dict[str, set[str]] = {}
        for path in normalized_paths:
            matching = [
                rule
                for rule in manifest["impact_rules"]
                if _matches(path, rule["paths"])
                or _rule_covers_dependency(
                    root,
                    manifest,
                    rule,
                    path,
                    dependency_cache,
                )
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
