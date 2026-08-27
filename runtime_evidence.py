"""Validate runtime statistical evidence and retained artifact checksums."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
DEFAULT_SCHEMA = (
    ROOT
    / "docs/performance/runtime-gauntlet/statistical-baseline/evidence-schema.json"
)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_runtime_evidence(
    evidence_path: Path,
    *,
    schema_path: Path = DEFAULT_SCHEMA,
    artifact_root: Path = ROOT / "app",
    require_artifacts: bool = False,
) -> dict[str, Any]:
    evidence = load_json(evidence_path)
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(evidence), key=lambda error: list(error.path))
    if errors:
        details = "\n".join(
            f"{'.'.join(map(str, error.path)) or '<root>'}: {error.message}"
            for error in errors
        )
        raise ValueError(f"Evidence schema validation failed:\n{details}")

    missing: list[str] = []
    verified: list[str] = []
    artifact_root = artifact_root.resolve()
    seen_paths: set[str] = set()
    for artifact in evidence["artifacts"]:
        declared_path = artifact["path"]
        if declared_path in seen_paths:
            raise ValueError(f"Duplicate artifact path: {declared_path}")
        seen_paths.add(declared_path)
        relative_path = Path(declared_path)
        artifact_path = (artifact_root / relative_path).resolve()
        if relative_path.is_absolute() or not artifact_path.is_relative_to(artifact_root):
            raise ValueError(
                f"Artifact path escapes artifact root: {declared_path}"
            )
        if not artifact_path.is_file():
            missing.append(declared_path)
            continue
        actual_size = artifact_path.stat().st_size
        actual_sha256 = sha256(artifact_path)
        if actual_size != artifact["bytes"] or actual_sha256 != artifact["sha256"]:
            raise ValueError(
                f"Artifact checksum mismatch: {declared_path} "
                f"expected {artifact['bytes']} bytes/{artifact['sha256']}, "
                f"received {actual_size} bytes/{actual_sha256}"
            )
        verified.append(declared_path)

    if require_artifacts and missing:
        raise ValueError("Required artifacts are missing:\n" + "\n".join(missing))
    return {
        "schema": "valid",
        "verified_artifacts": verified,
        "missing_external_artifacts": missing,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--artifact-root", type=Path, default=ROOT / "app")
    parser.add_argument("--require-artifacts", action="store_true")
    args = parser.parse_args()
    result = validate_runtime_evidence(
        args.evidence,
        schema_path=args.schema,
        artifact_root=args.artifact_root,
        require_artifacts=args.require_artifacts,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
