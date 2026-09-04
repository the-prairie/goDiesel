"""Compact, privacy-safe evidence receipts for capability verification."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import uuid
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Mapping, Sequence


SCHEMA_VERSION = 1
EVIDENCE_SCHEMA_PATH = Path("system/evidence-receipt.schema.json")
EVIDENCE_ROOT = Path(".godiesel/evidence")


def canonical_digest(value: object) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256(serialized).hexdigest()


def _file_digest(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_local_directory(root: Path | str, relative: Path | str) -> Path:
    """Create a repository-owned directory without traversing symbolic links."""

    root = Path(root).resolve()
    relative = Path(relative)
    if relative.is_absolute() or ".." in relative.parts:
        raise OSError("local artifact directory must stay inside the repository")
    current = root
    for part in relative.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            current.mkdir()
            mode = current.lstat().st_mode
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            raise OSError("local artifact directory is not a real directory")
    if not current.resolve().is_relative_to(root):
        raise OSError("local artifact directory escapes the repository")
    return current


def existing_local_directory(root: Path | str, relative: Path | str) -> Path | None:
    """Resolve an existing repository-owned directory without following symlinks."""

    try:
        root = Path(root).resolve()
        relative = Path(relative)
        if relative.is_absolute() or ".." in relative.parts:
            return None
        current = root
        for part in relative.parts:
            current = current / part
            mode = current.lstat().st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
                return None
        return current if current.resolve().is_relative_to(root) else None
    except OSError:
        return None


def write_local_text_atomic(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    content: str,
) -> Path:
    """Atomically write inside a pinned repository-owned directory."""

    if not filename or Path(filename).name != filename:
        raise OSError("local artifact filename must be one path component")
    root = Path(root).resolve()
    directory = ensure_local_directory(root, relative_directory)
    directory_fd = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
    )
    temporary = f".{filename}.{uuid.uuid4().hex}.tmp"
    try:
        opened = os.fstat(directory_fd)

        def directory_is_still_pinned() -> bool:
            try:
                current = directory.lstat()
            except OSError:
                return False
            return (
                stat.S_ISDIR(current.st_mode)
                and not stat.S_ISLNK(current.st_mode)
                and current.st_dev == opened.st_dev
                and current.st_ino == opened.st_ino
            )

        file_fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        with os.fdopen(file_fd, "w", encoding="utf-8") as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        if not directory_is_still_pinned():
            raise OSError("local artifact directory changed during write")
        os.replace(
            temporary,
            filename,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        os.fsync(directory_fd)
        if not directory_is_still_pinned():
            raise OSError("local artifact directory changed during commit")
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        os.close(directory_fd)
    return directory / filename


def _git(root: Path, *args: str, text: bool = True) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=False,
        capture_output=True,
        text=text,
        timeout=5,
    )


def repository_snapshot(root: Path | str) -> dict[str, Any]:
    """Return a privacy-safe identity for the exact checkout and repository state."""

    root = Path(root).resolve()
    try:
        commit = _git(root, "rev-parse", "HEAD")
        branch = _git(root, "branch", "--show-current")
        status = _git(
            root,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            text=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        commit = subprocess.CompletedProcess([], 1, "", "")
        branch = subprocess.CompletedProcess([], 1, "", "")
        status = subprocess.CompletedProcess([], 1, b"", b"")
    status_bytes = status.stdout if status.returncode == 0 else b"unavailable"
    return {
        "commit": commit.stdout.strip() if commit.returncode == 0 else None,
        "branch": branch.stdout.strip() or None if branch.returncode == 0 else None,
        "worktree_sha256": canonical_digest(root.as_posix()),
        "dirty_state": {
            "clean": status.returncode == 0 and not status_bytes,
            "sha256": sha256(status_bytes or b"clean").hexdigest(),
        },
    }


def write_evidence_receipt(
    root: Path | str,
    *,
    capability: str,
    verb: str,
    authority: str,
    started_at: str,
    finished_at: str,
    status: str,
    inputs: Sequence[Mapping[str, str]],
    covered_inputs: Sequence[Mapping[str, str]],
    proof_fingerprint: str,
    selection: Mapping[str, Any],
    gates: Sequence[Mapping[str, Any]],
    configuration: Sequence[Mapping[str, Any]],
    warnings: Sequence[Mapping[str, str]],
    named_degradation: Sequence[str] = (),
    external_target: Mapping[str, Any] | None = None,
    recovery_paths: Sequence[str] = (),
    safe_next_actions: Sequence[str] = (),
    artifacts: Sequence[Mapping[str, str]] = (),
) -> dict[str, str] | None:
    """Write one ignored evidence receipt when its repository contract is present."""

    root = Path(root).resolve()
    if not (root / EVIDENCE_SCHEMA_PATH).is_file():
        return None
    now = datetime.now(timezone.utc)
    receipt_id = now.strftime("%Y%m%dT%H%M%S%fZ") + "-" + uuid.uuid4().hex[:12]
    receipt = {
        "schema_version": SCHEMA_VERSION,
        "document_type": "godiesel-evidence-receipt",
        "receipt_id": receipt_id,
        "capability": capability,
        "verb": verb,
        "authority": authority,
        "started_at": started_at,
        "finished_at": finished_at,
        "status": status,
        "repository": repository_snapshot(root),
        "inputs": [dict(item) for item in inputs],
        "covered_inputs": [dict(item) for item in covered_inputs],
        "proof_fingerprint": proof_fingerprint,
        "selection": dict(selection),
        "gates": [dict(item) for item in gates],
        "configuration": [dict(item) for item in configuration],
        "warnings": [dict(item) for item in warnings],
        "named_degradation": list(named_degradation),
        "external_target": dict(external_target) if external_target else None,
        "recovery_paths": list(recovery_paths),
        "safe_next_actions": list(safe_next_actions),
        "artifacts": [dict(item) for item in artifacts],
    }
    relative_path = EVIDENCE_ROOT / f"{receipt_id}.json"
    try:
        destination = write_local_text_atomic(
            root,
            EVIDENCE_ROOT,
            f"{receipt_id}.json",
            json.dumps(receipt, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        )
    except OSError:
        return None
    return {
        "id": receipt_id,
        "path": relative_path.as_posix(),
        "sha256": _file_digest(destination),
    }
