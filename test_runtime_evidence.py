import hashlib
import json
from pathlib import Path

import pytest

from runtime_evidence import validate_runtime_evidence


def evidence(artifact: Path, *, digest: str) -> dict:
    return {
        "schemaVersion": 1,
        "sourceCommit": "a" * 40,
        "generatedAt": "2026-08-26T00:00:00Z",
        "protocol": {
            "warmups": 3,
            "measuredRepetitions": 100,
            "quantileMethod": "nearest-rank",
        },
        "environment": {
            "hostname": "fixed-host",
            "platform": "darwin",
            "arch": "arm64",
            "cpuModel": "test",
            "cpuCount": 1,
        },
        "distributions": [
            {
                "name": "latency",
                "unit": "ms",
                "sampleCount": 2,
                "min": 1,
                "max": 2,
                "mean": 1.5,
                "sampleStdDev": 0.707,
                "coefficientOfVariation": 0.471,
                "medianAbsoluteDeviation": 0,
                "p50": {"value": 1, "status": "available", "minimumSamples": 2},
                "p95": {"value": None, "status": "insufficient-samples", "minimumSamples": 20},
                "p99": {"value": None, "status": "insufficient-samples", "minimumSamples": 100},
            }
        ],
        "artifacts": [
            {
                "kind": "json",
                "path": artifact.name,
                "bytes": artifact.stat().st_size,
                "sha256": digest,
                "retention": "local-artifact",
            }
        ],
    }


def test_evidence_schema_and_checksum_pass(tmp_path: Path):
    artifact = tmp_path / "raw.json"
    artifact.write_text("{}\n", encoding="utf-8")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    report = tmp_path / "evidence.json"
    report.write_text(json.dumps(evidence(artifact, digest=digest)), encoding="utf-8")

    result = validate_runtime_evidence(
        report, artifact_root=tmp_path, require_artifacts=True
    )

    assert result["schema"] == "valid"
    assert result["verified_artifacts"] == ["raw.json"]


def test_checksum_tampering_fails(tmp_path: Path):
    artifact = tmp_path / "raw.json"
    artifact.write_text("{}\n", encoding="utf-8")
    report = tmp_path / "evidence.json"
    report.write_text(
        json.dumps(evidence(artifact, digest="0" * 64)), encoding="utf-8"
    )

    with pytest.raises(ValueError, match="checksum mismatch"):
        validate_runtime_evidence(
            report, artifact_root=tmp_path, require_artifacts=True
        )
