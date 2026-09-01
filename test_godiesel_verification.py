import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from godiesel_control import main
from godiesel_route_share import execute_route_share
from godiesel_verification import (
    build_proof_snapshot,
    explain_verification,
    reuse_verification,
)


ROOT = Path(__file__).resolve().parent


class RecordingRunner:
    def __init__(self):
        self.calls: list[list[str]] = []

    def __call__(self, command: list[str], **kwargs: object):
        self.calls.append(command)
        return __import__("subprocess").CompletedProcess(
            command,
            0,
            "verified\n",
            "",
        )


def _write_reuse_fixture(root: Path) -> None:
    (root / "system").mkdir()
    for name in ("evidence-receipt.schema.json", "verification-reuse.schema.json"):
        (root / "system" / name).write_text(
            (ROOT / "system" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    capability = {
        "id": "route-share",
        "configuration": [
            {
                "name": "PROVIDER_PROJECT",
                "required_for": ["verify:live"],
                "sensitive": False,
            }
        ],
        "verification": {
            "focused": [{"command": "verify-focused", "cwd": "."}],
            "ticket": [],
            "live": [{"command": "verify-live", "cwd": "."}],
        },
    }
    categories = {
        "implementation": "implementation.py",
        "contract": "contract.json",
        "fixture": "fixture.json",
        "configuration": ".gitignore",
        "data": "data.json",
        "provider": "provider.json",
    }
    impact_rules = [
        {
            "id": f"fixture-{category}",
            "paths": [path],
            "capabilities": ["route-share"],
            "category": category,
            "gates": [{"capability": "route-share", "tier": "focused"}],
            "reason": f"Fixture {category} input.",
        }
        for category, path in categories.items()
    ]
    impact_rules.extend(
        [
            {
                "id": "fixture-live-provider",
                "paths": ["provider.json"],
                "capabilities": ["route-share"],
                "category": "provider",
                "gates": [{"capability": "route-share", "tier": "live"}],
                "reason": "Fixture live provider input.",
            },
            {
                "id": "fixture-documentation",
                "paths": ["docs/**"],
                "capabilities": ["route-share"],
                "category": "documentation",
                "gates": [],
                "reason": "Fixture documentation input.",
            },
        ]
    )
    (root / "system/capabilities.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "document_type": "godiesel-capability-manifest",
                "capabilities": [capability],
                "impact_rules": impact_rules,
            }
        ),
        encoding="utf-8",
    )
    for path in categories.values():
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            ".godiesel/\n.route-share/\n"
            if path == ".gitignore"
            else f"{path}\n",
            encoding="utf-8",
        )
    (root / "docs").mkdir()
    (root / "docs/guide.md").write_text("guide\n", encoding="utf-8")
    __import__("subprocess").run(["git", "init", "-q"], cwd=root, check=True)
    __import__("subprocess").run(
        ["git", "config", "user.email", "fixture@example.test"],
        cwd=root,
        check=True,
    )
    __import__("subprocess").run(
        ["git", "config", "user.name", "Fixture"], cwd=root, check=True
    )
    __import__("subprocess").run(["git", "add", "."], cwd=root, check=True)
    __import__("subprocess").run(
        ["git", "commit", "-qm", "fixture"], cwd=root, check=True
    )


def _record_proof(root: Path) -> tuple[dict[str, object], RecordingRunner]:
    runner = RecordingRunner()
    result = execute_route_share(
        root,
        "verify",
        slug="route-1",
        environ={},
        runner=runner,
    )
    assert result["status"] == "passed"
    return result, runner


def test_verification_explanation_schema_is_valid():
    schema = json.loads(
        (ROOT / "system/verification-explanation.schema.json").read_text()
    )
    reuse_schema = json.loads(
        (ROOT / "system/verification-reuse.schema.json").read_text()
    )

    Draft202012Validator.check_schema(schema)
    Draft202012Validator.check_schema(reuse_schema)


@pytest.mark.parametrize(
    ("changed_path", "capability", "category", "required_tier"),
    [
        ("godiesel_control.py", "route-share", "implementation", "focused"),
        ("system/result.schema.json", "route-share", "contract", "focused"),
        ("test_godiesel_route_share.py", "route-share", "fixture", "focused"),
        (".gitignore", "route-share", "configuration", "focused"),
        (
            "app/src/services/google-maps-loader.ts",
            "application-release",
            "provider",
            "live",
        ),
    ],
)
def test_explain_maps_paths_to_capabilities_and_required_gates(
    changed_path: str,
    capability: str,
    category: str,
    required_tier: str,
):
    result = explain_verification(ROOT, changed_paths=[changed_path])

    assert result["status"] == "passed"
    explanation = result["result"]
    classification = explanation["classifications"][0]
    assert classification["path"] == changed_path
    assert capability in classification["capabilities"]
    assert category in classification["categories"]
    assert required_tier in {gate["tier"] for gate in explanation["selected_gates"]}
    Draft202012Validator(
        json.loads(
            (ROOT / "system/verification-explanation.schema.json").read_text()
        )
    ).validate(explanation)


def test_documentation_only_change_selects_no_runtime_gate():
    result = explain_verification(
        ROOT,
        changed_paths=["docs/agents/route-share.md"],
    )

    assert result["status"] == "passed"
    assert result["result"]["selected_gates"] == []
    assert result["result"]["classifications"][0]["categories"] == [
        "documentation"
    ]


def test_unclassified_path_blocks_instead_of_choosing_a_small_gate():
    result = explain_verification(ROOT, changed_paths=["mystery/input.bin"])

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["result"]["unclassified_paths"] == ["mystery/input.bin"]
    assert result["blockers"][0]["code"] == "GODIESEL_UNCLASSIFIED_PATH"


def test_cli_verify_explain_emits_json_without_executing_a_gate(monkeypatch, capsys):
    def fail_execute(*args: object, **kwargs: object) -> object:
        raise AssertionError("route verification must not execute during explanation")

    monkeypatch.setattr("godiesel_control.execute_route_share", fail_execute)

    exit_code = main(
        [
            "verify",
            "system",
            "--explain",
            "--changed-path",
            "godiesel_control.py",
            "--json",
        ]
    )

    assert exit_code == 0
    result = json.loads(capsys.readouterr().out)
    assert result["capability"] == "system"
    assert result["verb"] == "verify"
    assert result["result"]["execution"] == "not_run"
    assert result["receipt"] is None
    assert result["evidence"] is None


def test_reuse_returns_the_existing_proof_without_executing_a_gate(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    recorded, runner = _record_proof(tmp_path)

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert runner.calls == [[str(tmp_path / "scripts/route.sh"), "check", "route-1"]]
    assert reused["status"] == "passed"
    assert reused["result"]["reused"] is True
    assert reused["result"]["source_receipt"] == recorded["evidence"]["path"]
    assert reused["evidence"] == recorded["evidence"]
    assert reused["receipt"] is None
    Draft202012Validator(
        json.loads((ROOT / "system/verification-reuse.schema.json").read_text())
    ).validate(reused["result"])


def test_documentation_change_does_not_invalidate_runtime_proof(tmp_path: Path):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    (tmp_path / "docs/guide.md").write_text("updated guide\n", encoding="utf-8")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "passed"


@pytest.mark.parametrize(
    ("category", "path"),
    [
        ("implementation", "implementation.py"),
        ("contract", "contract.json"),
        ("fixture", "fixture.json"),
        ("configuration", ".gitignore"),
        ("data", "data.json"),
        ("provider", "provider.json"),
    ],
)
def test_covered_input_change_blocks_reuse(
    tmp_path: Path,
    category: str,
    path: str,
):
    _write_reuse_fixture(tmp_path)
    _record_proof(tmp_path)
    with (tmp_path / path).open("a", encoding="utf-8") as destination:
        destination.write("changed\n")

    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"
    assert category in {
        item["category"] for item in reused["result"]["invalidated_inputs"]
    }


def test_provider_target_changes_the_live_proof_fingerprint(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    first = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={"PROVIDER_PROJECT": "target-a"},
        provider_target="target-a",
    )
    second = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={"PROVIDER_PROJECT": "target-b"},
        provider_target="target-b",
    )

    assert first["proof_fingerprint"] != second["proof_fingerprint"]
    assert "provider" in {item["category"] for item in first["covered_inputs"]}


def test_missing_live_configuration_is_blocked_not_passed(tmp_path: Path):
    _write_reuse_fixture(tmp_path)

    snapshot = build_proof_snapshot(
        tmp_path,
        "route-share",
        tiers=["live"],
        environ={},
        provider_target="target-a",
    )

    assert snapshot["status"] == "blocked"
    assert snapshot["blockers"][0]["code"] == "GODIESEL_LIVE_CONFIGURATION_MISSING"


def test_cli_verify_reuse_dispatches_without_running_route_verification(
    monkeypatch,
    capsys,
):
    captured: dict[str, object] = {}

    def fake_reuse(root: Path, capability: str, **kwargs: object):
        captured.update({"root": root, "capability": capability, **kwargs})
        return {
            "status": "passed",
            "exit_code": 0,
            "capability": capability,
            "verb": "verify",
        }

    def fail_execute(*args: object, **kwargs: object):
        raise AssertionError("route verification must not execute during reuse")

    monkeypatch.setattr("godiesel_control.reuse_verification", fake_reuse)
    monkeypatch.setattr("godiesel_control.execute_route_share", fail_execute)

    exit_code = main(
        ["verify", "route-share", "route-1", "--reuse", "--json"]
    )

    assert exit_code == 0
    assert captured["capability"] == "route-share"
    assert captured["slug"] == "route-1"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"
