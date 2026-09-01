import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from godiesel_control import main
from godiesel_verification import explain_verification


ROOT = Path(__file__).resolve().parent


def test_verification_explanation_schema_is_valid():
    schema = json.loads(
        (ROOT / "system/verification-explanation.schema.json").read_text()
    )

    Draft202012Validator.check_schema(schema)


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
