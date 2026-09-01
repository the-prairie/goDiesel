import json
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from godiesel_route_share import execute_route_share


ROOT = Path(__file__).resolve().parent
RESULT_VALIDATOR = Draft202012Validator(
    json.loads((ROOT / "system/result.schema.json").read_text())
)


def assert_valid_result(result: object) -> None:
    RESULT_VALIDATOR.validate(result)


class RecordingRunner:
    def __init__(self, *results: subprocess.CompletedProcess[str]):
        self.results = list(results)
        self.calls: list[list[str]] = []

    def __call__(self, command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.calls.append(command)
        return self.results.pop(0)


def completed(
    command: list[str],
    *,
    returncode: int = 0,
    stdout: str = "",
    stderr: str = "",
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(command, returncode, stdout, stderr)


def test_result_and_receipt_schemas_are_valid():
    result_schema = json.loads((ROOT / "system/result.schema.json").read_text())
    receipt_schema = json.loads(
        (ROOT / "system/route-share-receipt.schema.json").read_text()
    )

    Draft202012Validator.check_schema(result_schema)
    Draft202012Validator.check_schema(receipt_schema)


def test_plan_wraps_the_unchanged_proposal_and_writes_a_digest_receipt(tmp_path: Path):
    request = tmp_path / "request.json"
    request.write_text("{}\n", encoding="utf-8")
    proposal = {
        "document_type": "route-share-proposal",
        "proposal_id": "proposal-1",
        "route_spec": {"activity_id": "route-1"},
        "blocking_errors": [],
    }
    runner = RecordingRunner(
        completed([], stdout=json.dumps(proposal, indent=2) + "\n")
    )

    result = execute_route_share(
        tmp_path,
        "plan",
        request_path=request,
        runner=runner,
    )

    assert runner.calls == [
        [str(tmp_path / "scripts/route.sh"), "propose", "--request", str(request)]
    ]
    assert result["status"] == "passed"
    assert result["authority"] == "ephemeral-local"
    assert result["result"] == proposal
    assert result["result_contract"] == "route_create.schema.json#/$defs/proposal"
    assert_valid_result(result)
    receipt_path = tmp_path / result["receipt"]["path"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert receipt["proposal"] == {
        "id": "proposal-1",
        "path": ".route-share/proposals/proposal-1.json",
        "sha256": result["receipt"]["result_sha256"],
    }
    assert receipt["route_slug"] == "route-1"
    assert result["receipt"]["result_path"] == receipt["proposal"]["path"]
    assert json.loads((tmp_path / receipt["proposal"]["path"]).read_text()) == proposal
    evidence = json.loads((tmp_path / receipt["result_artifact"]["path"]).read_text())
    assert evidence == proposal
    assert sha256(
        json.dumps(evidence, separators=(",", ":"), sort_keys=True).encode()
    ).hexdigest() == receipt["result_artifact"]["sha256"]
    Draft202012Validator(
        json.loads((ROOT / "system/route-share-receipt.schema.json").read_text())
    ).validate(receipt)


def test_apply_refuses_missing_authority_before_any_effect(tmp_path: Path):
    proposal = tmp_path / "proposal.json"
    proposal.write_text('{"proposal_id":"proposal-1"}\n', encoding="utf-8")
    runner = RecordingRunner()

    result = execute_route_share(
        tmp_path,
        "apply",
        proposal_path=proposal,
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_AUTHORITY_REQUIRED"
    assert_valid_result(result)
    assert runner.calls == []
    assert not (tmp_path / ".route-share").exists()


def test_apply_preserves_idempotent_creation_report_and_links_proposal(tmp_path: Path):
    proposal_path = tmp_path / "proposal.json"
    proposal = {
        "proposal_id": "proposal-1",
        "route_spec": {"activity_id": "route-1"},
    }
    proposal_path.write_text(json.dumps(proposal), encoding="utf-8")
    report = {
        "ok": True,
        "document_type": "route-share-creation-report",
        "proposal_id": "proposal-1",
        "slug": "route-1",
        "result": "already_applied",
    }
    runner = RecordingRunner(completed([], stdout=json.dumps(report)))

    result = execute_route_share(
        tmp_path,
        "apply",
        proposal_path=proposal_path,
        authority="canonical-local",
        runner=runner,
    )

    assert result["result"] == report
    assert_valid_result(result)
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["proposal"]["id"] == "proposal-1"
    assert receipt["creation_report"]["result"] == "already_applied"
    assert receipt["route_slug"] == "route-1"


@pytest.mark.parametrize(
    ("preview", "detach", "expected"),
    [
        (False, False, ["check", "route-1"]),
        (True, False, ["preview", "route-1"]),
        (True, True, ["preview", "route-1", "--detach"]),
    ],
)
def test_verify_maps_check_and_loopback_preview_modes(
    tmp_path: Path,
    preview: bool,
    detach: bool,
    expected: list[str],
):
    runner = RecordingRunner(completed([], stdout="verified\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        preview=preview,
        detach=detach,
        runner=runner,
    )

    assert runner.calls == [[str(tmp_path / "scripts/route.sh"), *expected]]
    assert result["result"] == {"stdout": "verified\n", "stderr": ""}
    assert result["receipt"]["path"].startswith(".route-share/runs/")
    assert_valid_result(result)


def test_release_requires_exact_authority_and_preserves_replacement_guard(tmp_path: Path):
    runner = RecordingRunner()

    refused = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        replace_existing=True,
        runner=runner,
    )

    assert refused["status"] == "blocked"
    assert runner.calls == []

    output = "\n".join(
        [
            "4/4 Publishing https://share-ridge.godiesel.pages.dev/",
            "Deployment complete: https://a1b2c3.godiesel.pages.dev",
            "Published route guide: https://share-ridge.godiesel.pages.dev/#/routes/route-1",
        ]
    )
    replacement_refused = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        replace_existing=True,
        authority="external-durable",
        runner=runner,
    )
    assert replacement_refused["blockers"][0]["code"] == (
        "GODIESEL_REPLACEMENT_AUTHORITY_REQUIRED"
    )
    assert_valid_result(replacement_refused)
    assert runner.calls == []

    runner.results.append(completed([], stdout=output + "\n"))
    released = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        replace_existing=True,
        authority="external-durable",
        replacement_authority="ridge",
        runner=runner,
    )

    assert runner.calls == [
        [
            str(tmp_path / "scripts/route.sh"),
            "publish",
            "route-1",
            "ridge",
            "--replace-existing",
        ]
    ]
    receipt = json.loads((tmp_path / released["receipt"]["path"]).read_text())
    assert receipt["release_target"] == {
        "immutable_deployment_url": "https://a1b2c3.godiesel.pages.dev/",
        "stable_alias": "https://share-ridge.godiesel.pages.dev/",
        "guide_url": "https://share-ridge.godiesel.pages.dev/#/routes/route-1",
        "replay_url": "https://share-ridge.godiesel.pages.dev/#/replay/route-1",
        "replacement_authorized": True,
        "smoke_status": "passed",
    }
    assert_valid_result(released)
    Draft202012Validator(
        json.loads((ROOT / "system/route-share-receipt.schema.json").read_text())
    ).validate(receipt)


def test_failed_domain_json_is_preserved_in_blocked_envelope(tmp_path: Path):
    error = {
        "ok": False,
        "error": {"code": "request.schema", "message": "request is invalid"},
    }
    runner = RecordingRunner(completed([], returncode=2, stderr=json.dumps(error)))

    result = execute_route_share(
        tmp_path,
        "plan",
        request_path=tmp_path / "request.json",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["result"] == error
    assert_valid_result(result)


def test_release_without_immutable_url_is_incomplete_and_blocks_handoff(tmp_path: Path):
    runner = RecordingRunner(completed([], stdout="Published route guide\n"))

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_EVIDENCE_INCOMPLETE"
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    assert "immutable_deployment_url" not in receipt["release_target"]
    assert_valid_result(result)


def test_release_receipt_links_the_complete_route_transition_lineage(tmp_path: Path):
    proposal = {
        "document_type": "route-share-proposal",
        "proposal_id": "proposal-1",
        "route_spec": {"activity_id": "route-1"},
    }
    creation = {
        "document_type": "route-share-creation-report",
        "proposal_id": "proposal-1",
        "slug": "route-1",
        "result": "created",
    }
    release_output = "Deployment complete: https://a1b2c3.godiesel.pages.dev\n"
    runner = RecordingRunner(
        completed([], stdout=json.dumps(proposal)),
        completed([], stdout=json.dumps(creation)),
        completed([], stdout="verified\n"),
        completed([], stdout=release_output),
    )
    request_path = tmp_path / "request.json"
    request_path.write_text("{}\n", encoding="utf-8")

    planned = execute_route_share(
        tmp_path,
        "plan",
        request_path=request_path,
        runner=runner,
    )
    proposal_path = tmp_path / planned["receipt"]["result_path"]
    execute_route_share(
        tmp_path,
        "apply",
        proposal_path=proposal_path,
        authority="canonical-local",
        runner=runner,
    )
    execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=runner,
    )
    released = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        runner=runner,
    )

    receipt = json.loads((tmp_path / released["receipt"]["path"]).read_text())
    assert [link["verb"] for link in receipt["lineage"]] == [
        "plan",
        "apply",
        "verify",
    ]
    assert all(link["path"].startswith(".route-share/runs/") for link in receipt["lineage"])
    assert all(len(link["result_sha256"]) == 64 for link in receipt["lineage"])
    assert receipt["proposal_sha256"] == json.loads(
        (tmp_path / receipt["lineage"][0]["path"]).read_text()
    )["proposal_sha256"]


def test_unified_status_is_observably_equivalent_to_compatibility_path():
    slug = "3519505225411091950"
    compatibility = subprocess.run(
        ["./scripts/route.sh", "status", slug],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    unified = subprocess.run(
        ["./scripts/godiesel", "inspect", "route-share", slug, "--json"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    envelope = json.loads(unified.stdout)
    assert_valid_result(envelope)
    assert envelope["result"] == {
        "stdout": compatibility.stdout,
        "stderr": compatibility.stderr,
    }
    assert envelope["receipt"] is None


def test_unified_plan_is_observably_equivalent_to_compatibility_path(tmp_path: Path):
    request = tmp_path / "request.json"
    request.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "existing_slug": "3519505225411091950",
                "proposed_share_name": "appian-way-review",
            }
        ),
        encoding="utf-8",
    )
    compatibility = subprocess.run(
        ["./scripts/route.sh", "propose", "--request", str(request)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    unified = subprocess.run(
        [
            "./scripts/godiesel",
            "plan",
            "route-share",
            "--request",
            str(request),
            "--json",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    unified_envelope = json.loads(unified.stdout)
    assert_valid_result(unified_envelope)
    unified_proposal = unified_envelope["result"]
    compatibility_proposal = json.loads(compatibility.stdout)
    assert len(unified_proposal.pop("proposal_id")) == 32
    assert len(compatibility_proposal.pop("proposal_id")) == 32
    assert unified_proposal == compatibility_proposal
