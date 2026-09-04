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
from typing import Any, Callable, Iterable, Mapping, Sequence


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


def _write_local_chunks_atomic(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    chunks: Callable[[], Iterable[bytes]],
    *,
    expected_sha256: str | None = None,
) -> Path:
    """Atomically stream bytes inside a descriptor-pinned repository directory."""

    if not filename or Path(filename).name != filename:
        raise OSError("local artifact filename must be one path component")
    root = Path(root).resolve()
    relative_directory = Path(relative_directory)
    if relative_directory.is_absolute() or ".." in relative_directory.parts:
        raise OSError("local artifact directory must stay inside the repository")
    directory = root / relative_directory
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative_directory.parts:
            try:
                next_fd = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=directory_fd,
                )
            except FileNotFoundError:
                os.mkdir(part, 0o700, dir_fd=directory_fd)
                next_fd = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=directory_fd,
                )
            os.close(directory_fd)
            directory_fd = next_fd
    except Exception:
        os.close(directory_fd)
        raise
    temporary = f".{filename}.{uuid.uuid4().hex}.tmp"
    try:
        opened = os.fstat(directory_fd)

        def directory_is_still_pinned() -> bool:
            try:
                reopened = os.open(
                    root,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                )
                for part in relative_directory.parts:
                    next_fd = os.open(
                        part,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=reopened,
                    )
                    os.close(reopened)
                    reopened = next_fd
                current = os.fstat(reopened)
                os.close(reopened)
            except OSError:
                return False
            return (
                stat.S_ISDIR(current.st_mode)
                and current.st_dev == opened.st_dev
                and current.st_ino == opened.st_ino
            )

        file_fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        digest = sha256()
        try:
            for chunk in chunks():
                digest.update(chunk)
                remaining = memoryview(chunk)
                while remaining:
                    written = os.write(file_fd, remaining)
                    if written <= 0:
                        raise OSError("local artifact write made no progress")
                    remaining = remaining[written:]
            os.fsync(file_fd)
        finally:
            os.close(file_fd)
        if expected_sha256 is not None and digest.hexdigest() != expected_sha256:
            raise OSError("local artifact content digest changed during write")
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


def write_local_text_atomic(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    content: str,
) -> Path:
    """Atomically write UTF-8 text inside a pinned repository directory."""

    payload = content.encode("utf-8")
    return _write_local_chunks_atomic(
        root,
        relative_directory,
        filename,
        lambda: (payload,),
    )


def write_local_bytes_atomic(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    content: bytes,
) -> Path:
    """Atomically write bytes inside a pinned repository directory."""

    return _write_local_chunks_atomic(
        root,
        relative_directory,
        filename,
        lambda: (content,),
    )


def copy_local_file_atomic(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    source: Path | str,
    *,
    expected_sha256: str,
) -> Path:
    """Atomically stream one checksummed source into a pinned local directory."""

    source = Path(source)

    def source_chunks() -> Iterable[bytes]:
        with source.open("rb") as input_file:
            while chunk := input_file.read(1024 * 1024):
                yield chunk

    return _write_local_chunks_atomic(
        root,
        relative_directory,
        filename,
        source_chunks,
        expected_sha256=expected_sha256,
    )


def replace_local_file(
    root: Path | str,
    relative_directory: Path | str,
    source_filename: str,
    destination_filename: str,
) -> None:
    """Replace one local file with another through one pinned directory."""

    if any(
        not filename or Path(filename).name != filename
        for filename in (source_filename, destination_filename)
    ):
        raise OSError("local artifact filenames must be one path component")
    root = Path(root).resolve()
    relative_directory = Path(relative_directory)
    if relative_directory.is_absolute() or ".." in relative_directory.parts:
        raise OSError("local artifact directory must stay inside the repository")
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative_directory.parts:
            next_fd = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        os.replace(
            source_filename,
            destination_filename,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def read_local_bytes(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
) -> bytes:
    """Read one regular file through a no-follow repository directory chain."""

    if not filename or Path(filename).name != filename:
        raise OSError("local artifact filename must be one path component")
    root = Path(root).resolve()
    relative_directory = Path(relative_directory)
    if relative_directory.is_absolute() or ".." in relative_directory.parts:
        raise OSError("local artifact directory must stay inside the repository")
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative_directory.parts:
            next_fd = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
        try:
            if not stat.S_ISREG(os.fstat(file_fd).st_mode):
                raise OSError("local artifact is not a regular file")
            chunks: list[bytes] = []
            while chunk := os.read(file_fd, 1024 * 1024):
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(file_fd)
    finally:
        os.close(directory_fd)


def unlink_local_file(
    root: Path | str,
    relative_directory: Path | str,
    filename: str,
    *,
    missing_ok: bool = False,
) -> None:
    """Unlink one file without following a redirected repository directory."""

    if not filename or Path(filename).name != filename:
        raise OSError("local artifact filename must be one path component")
    root = Path(root).resolve()
    relative_directory = Path(relative_directory)
    if relative_directory.is_absolute() or ".." in relative_directory.parts:
        raise OSError("local artifact directory must stay inside the repository")
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in relative_directory.parts:
            try:
                next_fd = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=directory_fd,
                )
            except FileNotFoundError:
                if missing_ok:
                    return
                raise
            os.close(directory_fd)
            directory_fd = next_fd
        try:
            os.unlink(filename, dir_fd=directory_fd)
        except FileNotFoundError:
            if not missing_ok:
                raise
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


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


def update_evidence_receipt(
    root: Path | str,
    summary: Mapping[str, str],
    *,
    status: str,
    artifacts: Sequence[Mapping[str, str]] | None = None,
) -> dict[str, str] | None:
    """Atomically promote a non-reusable evidence draft after final stability."""

    root = Path(root).resolve()
    relative = Path(str(summary.get("path", "")))
    if relative.parent != EVIDENCE_ROOT or not relative.name:
        return None
    directory = existing_local_directory(root, EVIDENCE_ROOT)
    if directory is None:
        return None
    try:
        raw = read_local_bytes(root, EVIDENCE_ROOT, relative.name)
        receipt = json.loads(raw.decode("utf-8"))
        if (
            status != "passed"
            or not isinstance(receipt, dict)
            or receipt.get("status") != "blocked"
            or receipt.get("receipt_id") != summary.get("id")
        ):
            return None
        receipt["status"] = status
        if artifacts is not None:
            receipt["artifacts"] = [dict(item) for item in artifacts]
        destination = write_local_text_atomic(
            root,
            EVIDENCE_ROOT,
            relative.name,
            json.dumps(receipt, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        )
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return {
        "id": str(summary.get("id", receipt.get("receipt_id", ""))),
        "path": relative.as_posix(),
        "sha256": _file_digest(destination),
    }
