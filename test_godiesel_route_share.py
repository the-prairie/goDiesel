import json
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

import godiesel_route_share
from admin_curation import owner_mutation_lock
from godiesel_route_share import execute_route_share
from godiesel_verification import reuse_verification


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


def release_output(share_name: str = "ridge") -> str:
    target = {
        "immutable_deployment_url": "https://a1b2c3.godiesel.pages.dev/",
        "stable_alias": f"https://share-{share_name}.godiesel.pages.dev/",
        "commit": "a" * 40,
        "tree": "b" * 40,
        "build_id": "12345678-1234-4234-8234-123456789abc",
        "artifact_manifest_sha256": "c" * 64,
        "smoke_status": "passed",
    }
    return "GODIESEL_RELEASE_TARGET=" + json.dumps(target) + "\n"


def release_observed_output(share_name: str = "ridge") -> str:
    return "GODIESEL_RELEASE_OBSERVED=" + json.dumps(
        {
            "immutable_deployment_url": "https://a1b2c3.godiesel.pages.dev/",
            "stable_alias": f"https://share-{share_name}.godiesel.pages.dev/",
            "external_status": "externally-unknown",
        }
    ) + "\n"


def release_attempted_output(share_name: str = "ridge") -> str:
    return "GODIESEL_RELEASE_ATTEMPTED=" + json.dumps(
        {
            "stable_alias": f"https://share-{share_name}.godiesel.pages.dev/",
            "external_status": "externally-unknown",
        }
    ) + "\n"


def establish_route_lineage(
    tmp_path: Path,
    runner: RecordingRunner,
    *,
    route_slug: str = "route-1",
) -> None:
    install_evidence_contract(tmp_path)
    schema_destination = tmp_path / "system" / "route-share-receipt.schema.json"
    schema_destination.parent.mkdir(parents=True, exist_ok=True)
    schema_destination.write_text(
        (ROOT / "system" / "route-share-receipt.schema.json").read_text(
            encoding="utf-8"
        ),
        encoding="utf-8",
    )
    proposal = {
        "document_type": "route-share-proposal",
        "proposal_id": "proposal-1",
        "route_spec": {"activity_id": route_slug},
    }
    creation = {
        "document_type": "route-share-creation-report",
        "proposal_id": "proposal-1",
        "slug": route_slug,
        "result": "created",
    }
    runner.results.extend(
        [
            completed([], stdout=json.dumps(proposal)),
            completed([], stdout=json.dumps(creation)),
            completed([], stdout="verified\n"),
        ]
    )
    request_path = tmp_path / "request.json"
    request_path.write_text("{}\n", encoding="utf-8")
    planned = execute_route_share(
        tmp_path,
        "plan",
        request_path=request_path,
        runner=runner,
    )
    execute_route_share(
        tmp_path,
        "apply",
        proposal_path=tmp_path / planned["receipt"]["result_path"],
        authority="canonical-local",
        runner=runner,
    )
    execute_route_share(
        tmp_path,
        "verify",
        slug=route_slug,
        runner=runner,
    )


def install_evidence_contract(tmp_path: Path) -> None:
    (tmp_path / "app/public/data").mkdir(parents=True, exist_ok=True)
    system = tmp_path / "system"
    system.mkdir(exist_ok=True)
    for name in ("evidence-receipt.schema.json", "capabilities.json"):
        (system / name).write_text(
            (ROOT / "system" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )


def test_result_and_receipt_schemas_are_valid():
    result_schema = json.loads((ROOT / "system/result.schema.json").read_text())
    receipt_schema = json.loads(
        (ROOT / "system/route-share-receipt.schema.json").read_text()
    )
    evidence_schema = json.loads(
        (ROOT / "system/evidence-receipt.schema.json").read_text()
    )

    Draft202012Validator.check_schema(result_schema)
    Draft202012Validator.check_schema(receipt_schema)
    Draft202012Validator.check_schema(evidence_schema)


def test_verify_writes_a_general_redacted_evidence_receipt(tmp_path: Path):
    (tmp_path / "app/public/data").mkdir(parents=True)
    (tmp_path / "system").mkdir()
    (tmp_path / "system/evidence-receipt.schema.json").write_text(
        (ROOT / "system/evidence-receipt.schema.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (tmp_path / "system/capabilities.json").write_text(
        (ROOT / "system/capabilities.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (tmp_path / ".gitignore").write_text(
        ".godiesel/\n.route-share/\n",
        encoding="utf-8",
    )
    (tmp_path / "tracked.txt").write_text("fixture\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "fixture@example.test"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Fixture"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=tmp_path, check=True)
    secret = "never-write-this-provider-key"
    runner = RecordingRunner(completed([], stdout="verified\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        environ={"GOOGLE_MAPS_API_KEY": secret},
        runner=runner,
    )

    assert result["status"] == "passed"
    assert result["evidence"]["path"].startswith(".godiesel/evidence/")
    evidence_path = tmp_path / result["evidence"]["path"]
    receipt = json.loads(evidence_path.read_text(encoding="utf-8"))
    Draft202012Validator(
        json.loads((ROOT / "system/evidence-receipt.schema.json").read_text())
    ).validate(receipt)
    assert receipt["capability"] == "route-share"
    assert receipt["verb"] == "verify"
    assert receipt["status"] == "passed"
    assert len(receipt["repository"]["commit"]) == 40
    assert receipt["repository"]["dirty_state"]["clean"] is True
    assert len(receipt["repository"]["dirty_state"]["sha256"]) == 64
    assert receipt["gates"] == [
        {
            "command": "./scripts/route.sh check <slug>",
            "cwd": ".",
            "exit_code": 0,
            "finished_at": receipt["finished_at"],
            "id": "route-share-check",
            "output_sha256": result["receipt"]["result_sha256"],
            "provider": "deterministic-local",
            "started_at": receipt["started_at"],
            "status": "passed",
            "tier": "focused",
        }
    ]
    assert {item["name"] for item in receipt["inputs"]} == {
        "route-slug",
        "verification-result",
    }
    assert receipt["configuration"] == []
    assert len(receipt["proof_fingerprint"]) == 64
    assert receipt["selection"]["mode"] == "explicit"
    assert receipt["selection"]["tiers"] == ["focused"]
    assert receipt["selection"]["impact_rules"]
    assert {
        item["category"] for item in receipt["covered_inputs"]
    }.issuperset({"implementation", "contract", "fixture", "configuration", "data"})
    assert secret not in evidence_path.read_text(encoding="utf-8")


def test_verify_withdraws_promoted_proof_when_input_changes_during_promotion(
    tmp_path: Path,
    monkeypatch,
):
    install_evidence_contract(tmp_path)
    implementation = tmp_path / "godiesel_route_share.py"
    implementation.write_text("stable\n", encoding="utf-8")
    original_set_outcome = godiesel_route_share._set_receipt_outcome

    def mutating_set_outcome(root, summary, outcome):
        promoted = original_set_outcome(root, summary, outcome)
        if outcome == "passed":
            implementation.write_text("changed during promotion\n", encoding="utf-8")
        return promoted

    monkeypatch.setattr(
        godiesel_route_share,
        "_set_receipt_outcome",
        mutating_set_outcome,
    )
    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=RecordingRunner(completed([], stdout="verified\n")),
    )

    assert result["status"] == "blocked"
    assert result["evidence"] is None
    assert "GODIESEL_VERIFICATION_INPUTS_CHANGED" in {
        issue["code"] for issue in result["blockers"]
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    evidence_receipts = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in (tmp_path / ".godiesel/evidence").glob("*.json")
    ]
    assert evidence_receipts
    assert all(receipt["status"] != "passed" for receipt in evidence_receipts)


def test_verify_rejects_a_mutated_receipt_draft_with_the_same_identity(
    tmp_path: Path,
    monkeypatch,
):
    install_evidence_contract(tmp_path)
    original_write = godiesel_route_share._write_receipt

    def rewriting_write(*args, **kwargs):
        summary = original_write(*args, **kwargs)
        path = tmp_path / summary["path"]
        receipt = json.loads(path.read_text(encoding="utf-8"))
        path.write_text(json.dumps(receipt), encoding="utf-8")
        return summary

    monkeypatch.setattr(godiesel_route_share, "_write_receipt", rewriting_write)
    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=RecordingRunner(completed([], stdout="verified\n")),
    )

    assert result["status"] == "blocked"
    assert result["blockers"][-1]["code"] == "GODIESEL_RECEIPT_PROMOTION_FAILED"


def test_route_share_verify_and_reuse_block_while_generation_recovery_is_pending(
    tmp_path: Path,
):
    install_evidence_contract(tmp_path)
    successful = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=RecordingRunner(completed([], stdout="verified\n")),
    )
    backup = tmp_path / "app/public/data/.route-generation-backup"
    backup.mkdir()
    (backup / "ready").touch()
    runner = RecordingRunner(completed([], stdout="must not run\n"))

    fresh = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=runner,
    )
    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )

    assert successful["status"] == "passed"
    assert fresh["status"] == "blocked"
    assert fresh["evidence"] is None
    assert fresh["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING"
    )
    assert runner.calls == []
    assert reused["status"] == "blocked"
    assert reused["result"]["reused"] is False
    assert reused["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING"
    )


def test_route_share_blocks_while_route_share_recovery_is_pending(tmp_path: Path):
    install_evidence_contract(tmp_path)
    recovery = tmp_path / ".route-share/recovery/unresolved.json"
    recovery.parent.mkdir(parents=True)
    recovery.write_text("{}\n", encoding="utf-8")
    runner = RecordingRunner(completed([], stdout="must not run\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING"
    )
    assert runner.calls == []


def test_route_share_receipts_do_not_follow_route_share_symlink(tmp_path: Path):
    install_evidence_contract(tmp_path)
    external = tmp_path / "external"
    external.mkdir()
    (tmp_path / ".route-share").symlink_to(external, target_is_directory=True)
    request = tmp_path / "request.json"
    request.write_text("{}\n", encoding="utf-8")
    proposal = {
        "document_type": "route-share-proposal",
        "proposal_id": "proposal-1",
        "route_spec": {"activity_id": "route-1"},
    }

    result = execute_route_share(
        tmp_path,
        "plan",
        request_path=request,
        runner=RecordingRunner(completed([], stdout=json.dumps(proposal))),
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_LOCAL_ARTIFACT_ROOT_UNSAFE"
    )
    assert list(external.iterdir()) == []


def test_route_share_preview_verify_blocks_while_generation_recovery_is_pending(
    tmp_path: Path,
):
    install_evidence_contract(tmp_path)
    (tmp_path / "app/public/data/.routes-staging-interrupted").mkdir()
    runner = RecordingRunner(completed([], stdout="must not run\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        preview=True,
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["evidence"] is None
    assert result["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING"
    )
    assert runner.calls == []


@pytest.mark.parametrize("remove_residue", [False, True])
def test_route_share_preview_verify_blocks_when_recovery_changes_during_command(
    tmp_path: Path,
    remove_residue: bool,
):
    install_evidence_contract(tmp_path)
    staging = tmp_path / "app/public/data/.routes-staging-interrupted"

    def mutating_runner(command, **kwargs):
        staging.mkdir()
        if remove_residue:
            staging.rmdir()
        return completed(command, stdout="preview ready\n")

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        preview=True,
        runner=mutating_runner,
    )

    blocker_codes = {blocker["code"] for blocker in result["blockers"]}
    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["evidence"] is None
    assert (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED"
        if remove_residue
        else "GODIESEL_ROUTE_GENERATION_RECOVERY_PENDING"
    ) in blocker_codes
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"


def test_route_share_verify_observes_recovery_changes_before_proof_snapshot(
    tmp_path: Path,
    monkeypatch,
):
    install_evidence_contract(tmp_path)
    staging = tmp_path / "app/public/data/.routes-staging-interrupted"
    original_snapshot = godiesel_route_share._focused_proof_snapshot
    calls = 0

    def racing_snapshot(root, environ):
        nonlocal calls
        if calls == 0:
            staging.mkdir()
            staging.rmdir()
        calls += 1
        return original_snapshot(root, environ)

    monkeypatch.setattr(godiesel_route_share, "_focused_proof_snapshot", racing_snapshot)

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=RecordingRunner(completed([], stdout="verified\n")),
    )

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert {blocker["code"] for blocker in result["blockers"]} >= {
        "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED"
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    evidence = json.loads((tmp_path / result["evidence"]["path"]).read_text())
    assert evidence["status"] == "blocked"


def test_verify_blocks_when_the_evidence_contract_is_missing(tmp_path: Path):
    system = tmp_path / "system"
    system.mkdir()
    (system / "capabilities.json").write_text(
        (ROOT / "system/capabilities.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    runner = RecordingRunner(completed([], stdout="verified\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_EVIDENCE_SCHEMA_UNAVAILABLE"
    assert result["evidence"] is None
    assert runner.calls == []
    assert_valid_result(result)


def test_verify_blocks_when_the_capability_manifest_is_missing(tmp_path: Path):
    system = tmp_path / "system"
    system.mkdir()
    (system / "evidence-receipt.schema.json").write_text(
        (ROOT / "system/evidence-receipt.schema.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    runner = RecordingRunner(completed([], stdout="verified\n"))

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_MANIFEST_UNAVAILABLE"
    assert result["evidence"] is None
    assert runner.calls == []
    assert_valid_result(result)


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


def test_apply_blocks_while_catalogue_mutation_lock_is_held(tmp_path: Path):
    proposal_path = tmp_path / "proposal.json"
    proposal_path.write_text('{"proposal_id":"proposal-1"}\n', encoding="utf-8")
    runner = RecordingRunner(
        completed(
            [],
            returncode=2,
            stderr=json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "repository.mutation_busy",
                        "message": "another catalogue mutation is in progress",
                    },
                }
            ),
        )
    )

    with owner_mutation_lock(tmp_path):
        result = execute_route_share(
            tmp_path,
            "apply",
            proposal_path=proposal_path,
            authority="canonical-local",
            runner=runner,
        )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_ROUTE_MUTATION_BUSY"
    assert len(runner.calls) == 1


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
    install_evidence_contract(tmp_path)
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
    assert (result["evidence"] is None) is preview
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

    target_refused = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        runner=runner,
    )
    assert target_refused["blockers"][0]["code"] == (
        "GODIESEL_RELEASE_TARGET_AUTHORITY_REQUIRED"
    )
    assert runner.calls == []

    mismatched_target_refused = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="summit",
        runner=runner,
    )
    assert mismatched_target_refused["blockers"][0]["code"] == (
        "GODIESEL_RELEASE_TARGET_AUTHORITY_REQUIRED"
    )
    assert runner.calls == []

    output = "\n".join(
        [
            "4/4 Publishing https://share-ridge.godiesel.pages.dev/",
            release_output().strip(),
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
        target_authority="ridge",
        runner=runner,
    )
    assert replacement_refused["blockers"][0]["code"] == (
        "GODIESEL_REPLACEMENT_AUTHORITY_REQUIRED"
    )
    assert_valid_result(replacement_refused)
    assert runner.calls == []

    establish_route_lineage(tmp_path, runner)
    runner.results.append(completed([], stdout=output + "\n"))
    released = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        replace_existing=True,
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert runner.calls[-1] == [
        str(tmp_path / "scripts/route.sh"),
        "publish",
        "route-1",
        "ridge",
        "--replace-existing",
    ]
    assert runner.calls == [
        [
            str(tmp_path / "scripts/route.sh"),
            "propose",
            "--request",
            str(tmp_path / "request.json"),
        ],
        [
            str(tmp_path / "scripts/route.sh"),
            "create",
            "--proposal",
            str(tmp_path / ".route-share/proposals/proposal-1.json"),
        ],
        [str(tmp_path / "scripts/route.sh"), "check", "route-1"],
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
        "authorized_share_name": "ridge",
        "replacement_authorized": True,
        "smoke_status": "passed",
        "commit": "a" * 40,
        "tree": "b" * 40,
        "build_id": "12345678-1234-4234-8234-123456789abc",
        "artifact_manifest_sha256": "c" * 64,
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
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    runner.results.append(completed([], stdout="Published route guide\n"))

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["exit_code"] == 2
    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_EVIDENCE_INCOMPLETE"
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    assert "immutable_deployment_url" not in receipt["release_target"]
    assert_valid_result(result)


def test_release_records_ambiguous_external_state_before_any_retry(tmp_path: Path):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    runner.results.append(
        completed([], returncode=1, stdout=release_observed_output())
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert "GODIESEL_RELEASE_EXTERNAL_STATE_UNKNOWN" in {
        issue["code"] for issue in result["blockers"]
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["release_target"]["external_status"] == "externally-unknown"
    assert receipt["release_target"]["immutable_deployment_url"] == (
        "https://a1b2c3.godiesel.pages.dev/"
    )
    assert_valid_result(result)


def test_release_records_an_attempt_when_upload_fails_before_a_url_is_known(
    tmp_path: Path,
):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    runner.results.append(
        completed([], returncode=1, stdout=release_attempted_output())
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert "GODIESEL_RELEASE_EXTERNAL_STATE_UNKNOWN" in {
        issue["code"] for issue in result["blockers"]
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    assert receipt["release_target"] == {
        "stable_alias": "https://share-ridge.godiesel.pages.dev/",
        "external_status": "externally-unknown",
        "authorized_share_name": "ridge",
        "replacement_authorized": True,
    }


def test_release_observes_transient_recovery_changes_during_publication(tmp_path: Path):
    lineage_runner = RecordingRunner()
    establish_route_lineage(tmp_path, lineage_runner)
    staging = tmp_path / "app/public/data/.routes-staging-interrupted"

    def mutating_release(command, **kwargs):
        staging.mkdir()
        staging.rmdir()
        return completed(
            command,
            stdout=release_output(),
        )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=mutating_release,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_ROUTE_GENERATION_RECOVERY_CHANGED"
    )
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"


def test_release_observes_transient_covered_input_changes_during_publication(
    tmp_path: Path,
):
    implementation = tmp_path / "godiesel_route_share.py"
    implementation.write_text("stable\n", encoding="utf-8")
    lineage_runner = RecordingRunner()
    establish_route_lineage(tmp_path, lineage_runner)

    def mutating_release(command, **kwargs):
        implementation.write_text("transient\n", encoding="utf-8")
        implementation.write_text("stable\n", encoding="utf-8")
        return completed(
            command,
            stdout=release_output(),
        )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=mutating_release,
    )

    assert result["status"] == "blocked"
    assert any(
        issue["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
        for issue in result["blockers"]
    )
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"


def test_release_monitors_the_reused_evidence_artifact_during_publication(
    tmp_path: Path,
):
    lineage_runner = RecordingRunner()
    establish_route_lineage(tmp_path, lineage_runner)
    evidence_path = sorted((tmp_path / ".godiesel/evidence").glob("*.json"))[-1]
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    artifact = tmp_path / evidence["artifacts"][0]["path"]
    original = artifact.read_bytes()

    def mutating_release(command, **kwargs):
        artifact.write_bytes(b"transient release artifact\n")
        artifact.write_bytes(original)
        return completed(command, stdout=release_output())

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=mutating_release,
    )

    assert result["status"] == "blocked"
    assert "GODIESEL_VERIFICATION_INPUTS_CHANGED" in {
        issue["code"] for issue in result["blockers"]
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"


def test_release_monitor_stays_live_through_receipt_finalization(
    tmp_path: Path,
    monkeypatch,
):
    lineage_runner = RecordingRunner()
    establish_route_lineage(tmp_path, lineage_runner)
    evidence_path = sorted((tmp_path / ".godiesel/evidence").glob("*.json"))[-1]
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    artifact = tmp_path / evidence["artifacts"][0]["path"]
    original_artifact = artifact.read_bytes()
    original_write = godiesel_route_share._write_receipt

    def mutating_write(*args, **kwargs):
        summary = original_write(*args, **kwargs)
        artifact.write_bytes(b"transient finalization artifact\n")
        artifact.write_bytes(original_artifact)
        return summary

    monkeypatch.setattr(godiesel_route_share, "_write_receipt", mutating_write)

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=RecordingRunner(completed([], stdout=release_output())),
    )

    assert result["status"] == "blocked"
    assert "GODIESEL_VERIFICATION_INPUTS_CHANGED" in {
        issue["code"] for issue in result["blockers"]
    }
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"


def test_release_monitor_stays_live_for_lineage_receipt_finalization(
    tmp_path: Path,
    monkeypatch,
):
    lineage_runner = RecordingRunner()
    establish_route_lineage(tmp_path, lineage_runner)
    plan_receipt = sorted((tmp_path / ".route-share/runs").glob("*.json"))[0]
    original_receipt = plan_receipt.read_bytes()
    original_write = godiesel_route_share._write_receipt

    def mutating_write(*args, **kwargs):
        summary = original_write(*args, **kwargs)
        plan_receipt.write_bytes(b"{}\n")
        plan_receipt.write_bytes(original_receipt)
        return summary

    monkeypatch.setattr(godiesel_route_share, "_write_receipt", mutating_write)
    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=RecordingRunner(completed([], stdout=release_output())),
    )

    assert result["status"] == "blocked"
    assert "GODIESEL_VERIFICATION_INPUTS_CHANGED" in {
        issue["code"] for issue in result["blockers"]
    }


def test_verify_late_recovery_invalidates_transition_and_general_evidence(
    tmp_path: Path,
    monkeypatch,
):
    install_evidence_contract(tmp_path)
    original_write = godiesel_route_share._write_receipt

    def recovering_write(*args, **kwargs):
        summary = original_write(*args, **kwargs)
        recovery = tmp_path / ".route-share/recovery/unresolved.json"
        recovery.parent.mkdir(parents=True, exist_ok=True)
        recovery.write_text("{}\n", encoding="utf-8")
        return summary

    monkeypatch.setattr(godiesel_route_share, "_write_receipt", recovering_write)

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=RecordingRunner(completed([], stdout="verified\n")),
    )

    assert result["status"] == "blocked"
    assert result["evidence"] is None
    receipt = json.loads((tmp_path / result["receipt"]["path"]).read_text())
    assert receipt["outcome"] == "incomplete"
    evidence_receipts = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in (tmp_path / ".godiesel/evidence").glob("*.json")
    ]
    assert evidence_receipts
    assert all(item["status"] != "passed" for item in evidence_receipts)
    reused = reuse_verification(
        tmp_path,
        "route-share",
        slug="route-1",
        environ={},
    )
    assert reused["status"] == "blocked"


def test_route_share_verify_blocks_when_covered_inputs_change_during_gate(
    tmp_path: Path,
):
    install_evidence_contract(tmp_path)
    implementation = tmp_path / "godiesel_route_share.py"
    implementation.write_text("before\n", encoding="utf-8")

    def mutating_runner(command, **kwargs):
        implementation.write_text("after\n", encoding="utf-8")
        return completed(command, stdout="verified\n")

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=mutating_runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
    receipt = json.loads(
        (tmp_path / result["evidence"]["path"]).read_text(encoding="utf-8")
    )
    assert receipt["status"] == "blocked"


def test_route_share_verify_blocks_transient_covered_input_change(tmp_path: Path):
    install_evidence_contract(tmp_path)
    implementation = tmp_path / "godiesel_route_share.py"
    implementation.write_text("before\n", encoding="utf-8")

    def mutating_runner(command, **kwargs):
        implementation.write_text("during\n", encoding="utf-8")
        implementation.write_text("before\n", encoding="utf-8")
        return completed(command, stdout="verified\n")

    result = execute_route_share(
        tmp_path,
        "verify",
        slug="route-1",
        runner=mutating_runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"


def test_release_requires_complete_passed_route_transition_lineage(tmp_path: Path):
    runner = RecordingRunner()

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_LINEAGE_REQUIRED"
    assert result["receipt"] is None
    assert runner.calls == []
    assert_valid_result(result)


def test_release_blocks_when_the_verification_proof_is_invalidated(tmp_path: Path):
    system = tmp_path / "system"
    system.mkdir()
    for name in ("evidence-receipt.schema.json", "capabilities.json"):
        (system / name).write_text(
            (ROOT / "system" / name).read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    (tmp_path / "godiesel_control.py").write_text(
        "# changed after verification\n",
        encoding="utf-8",
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_PROOF_INVALIDATED"
    assert len(runner.calls) == 3
    assert_valid_result(result)


def test_release_blocks_when_the_evidence_contract_is_missing(tmp_path: Path):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    (tmp_path / "system/evidence-receipt.schema.json").unlink()

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_PROOF_REQUIRED"
    assert result["blockers"][1]["code"] == "GODIESEL_EVIDENCE_SCHEMA_UNAVAILABLE"
    assert "Restore system/evidence-receipt.schema.json" in result["blockers"][1][
        "remediation"
    ]
    assert len(runner.calls) == 3
    assert_valid_result(result)


def test_release_rejects_corrupted_lineage_result_artifact(tmp_path: Path):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    verify_receipt_path = sorted((tmp_path / ".route-share/runs").glob("*.json"))[-1]
    verify_receipt = json.loads(verify_receipt_path.read_text(encoding="utf-8"))
    (tmp_path / verify_receipt["result_artifact"]["path"]).write_text(
        json.dumps({"stdout": "changed after verification", "stderr": ""}),
        encoding="utf-8",
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_LINEAGE_INVALID"
    assert len(runner.calls) == 3
    assert_valid_result(result)


def test_release_rejects_corrupted_plan_proposal_artifact(tmp_path: Path):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    proposal_path = tmp_path / ".route-share/proposals/proposal-1.json"
    proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
    proposal["route_spec"]["activity_id"] = "different-route"
    proposal_path.write_text(
        json.dumps(proposal, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_LINEAGE_INVALID"
    assert len(runner.calls) == 3
    assert_valid_result(result)


def test_release_rejects_lineage_link_that_does_not_match_its_receipt(tmp_path: Path):
    runner = RecordingRunner()
    establish_route_lineage(tmp_path, runner)
    verify_receipt_path = sorted((tmp_path / ".route-share/runs").glob("*.json"))[-1]
    verify_receipt = json.loads(verify_receipt_path.read_text(encoding="utf-8"))
    verify_receipt["lineage"][0]["result_sha256"] = "0" * 64
    verify_receipt_path.write_text(
        json.dumps(verify_receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_LINEAGE_INVALID"
    assert len(runner.calls) == 3
    assert_valid_result(result)


def test_release_rejects_fabricated_receipts_without_linked_artifacts(tmp_path: Path):
    receipt_root = tmp_path / ".route-share" / "runs"
    receipt_root.mkdir(parents=True)
    for index, verb in enumerate(("plan", "apply", "verify")):
        (receipt_root / f"{index}-{verb}.json").write_text(
            json.dumps(
                {
                    "verb": verb,
                    "route_slug": "route-1",
                    "outcome": "passed",
                    "proposal_sha256": "a" * 64,
                }
            ),
            encoding="utf-8",
        )
    runner = RecordingRunner()

    result = execute_route_share(
        tmp_path,
        "release",
        slug="route-1",
        share_name="ridge",
        authority="external-durable",
        target_authority="ridge",
        replacement_authority="ridge",
        runner=runner,
    )

    assert result["blockers"][0]["code"] == "GODIESEL_RELEASE_LINEAGE_INVALID"
    assert runner.calls == []
    assert_valid_result(result)


def test_release_receipt_links_the_complete_route_transition_lineage(tmp_path: Path):
    install_evidence_contract(tmp_path)
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
    published_output = release_output()
    runner = RecordingRunner(
        completed([], stdout=json.dumps(proposal)),
        completed([], stdout=json.dumps(creation)),
        completed([], stdout="verified\n"),
        completed([], stdout=published_output),
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
        target_authority="ridge",
        replacement_authority="ridge",
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
