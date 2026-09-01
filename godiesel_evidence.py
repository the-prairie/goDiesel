"""Compact, privacy-safe evidence receipts for capability verification."""

from __future__ import annotations

import json
import os
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


def _git(root: Path, *args: str, text: bool = True) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        check=False,
        capture_output=True,
        text=text,
        timeout=5,
    )


def _repository_snapshot(root: Path) -> dict[str, Any]:
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
        "repository": _repository_snapshot(root),
        "inputs": [dict(item) for item in inputs],
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
    destination = root / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(destination)
    return {
        "id": receipt_id,
        "path": relative_path.as_posix(),
        "sha256": _file_digest(destination),
    }
