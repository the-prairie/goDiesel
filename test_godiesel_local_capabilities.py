"""Public contracts for the canonical local capability adapters."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

from admin_curation import owner_mutation_lock
from godiesel_local_capabilities import (
    execute_owner_curation,
    execute_provider_readiness,
    execute_route_generation,
    inspect_planned_route_persistence,
)
from godiesel_control import main
from godiesel_verification import reuse_verification
from quest_meta import route_guide_preview


COMPLETE_CURATION = {
    "vibe": "Quiet gravel through the valley.",
    "ideal_use": "An unhurried morning ride.",
    "terrain": ["gravel"],
    "difficulty": "Moderate.",
    "highlights": ["Open views"],
    "caveats": ["Limited water"],
    "seasonality": "Spring through autumn.",
    "editorial_note": "Owner-authored field note.",
    "review_status": "reviewed",
}


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _install_evidence_contract(root: Path) -> None:
    source = Path(__file__).parent / "system"
    for name in ("capabilities.json", "evidence-receipt.schema.json"):
        destination = root / "system" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((source / name).read_bytes())


def _assert_valid_evidence(root: Path, result: dict[str, object]) -> None:
    evidence = result["evidence"]
    assert isinstance(evidence, dict)
    receipt = json.loads((root / evidence["path"]).read_text(encoding="utf-8"))
    schema = json.loads(
        (root / "system/evidence-receipt.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(schema).validate(receipt)


def _generation_fixture(root: Path) -> Path:
    _install_evidence_contract(root)
    _write_json(
        root / "quests.json",
        {
            "routes": [
                {"activity_id": "route-1", "status": "approved"},
                {"activity_id": "route-2", "status": "pending"},
            ]
        },
    )
    _write_json(
        root / "app/src/data/generated/routes.manifest.json",
        {"routes": [{"activity_id": "route-1", "slug": "route-1"}]},
    )
    _write_json(root / "app/src/data/generated/route-stats.json", {"route_count": 1})
    _write_json(root / "app/public/data/routes/route-1.json", {"slug": "route-1"})
    (root / "rebuild.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    return root


def _curation_fixture(root: Path) -> Path:
    _install_evidence_contract(root)
    _write_json(
        root / "quests.json",
        {
            "routes": [
                {"activity_id": "route-1", "status": "approved"},
                {
                    "activity_id": "route-2",
                    "status": "approved",
                    "curation": {**COMPLETE_CURATION, "review_status": "published"},
                },
            ]
        },
    )
    schema = Path(__file__).parent / "system/owner-curation-plan.schema.json"
    destination = root / "system/owner-curation-plan.schema.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(schema.read_bytes())
    return root


def _write_curation_request(root: Path) -> Path:
    request = root / "curation-request.json"
    _write_json(
        request,
        {
            "schema_version": 1,
            "document_type": "owner-curation-request",
            "activity_id": "route-1",
            "curation": COMPLETE_CURATION,
        },
    )
    return request


def _plan_curation(root: Path) -> Path:
    planned = execute_owner_curation(
        root,
        "plan",
        request_path=_write_curation_request(root),
    )
    assert planned["status"] == "passed"
    schema = json.loads(
        (root / "system/owner-curation-plan.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(schema).validate(planned["result"]["plan"])
    return root / planned["result"]["plan_path"]


def test_generation_inspect_reports_projection_without_mutating_it(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    watched = [
        root / "quests.json",
        root / "app/src/data/generated/routes.manifest.json",
        root / "app/src/data/generated/route-stats.json",
        root / "app/public/data/routes/route-1.json",
    ]
    before = {path: path.read_bytes() for path in watched}

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "passed"
    assert result["authority"] == "read-only"
    assert result["authorized"] is True
    assert result["result"] == {
        "canonical_public_routes": 1,
        "generated_summary_routes": 1,
        "generated_detail_routes": 1,
        "reported_route_count": 1,
        "inventory_state": "current",
        "recovery_state": "clear",
    }
    assert {path: path.read_bytes() for path in watched} == before


def test_generation_apply_requires_authority_before_invoking_writer(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    calls: list[object] = []

    result = execute_route_generation(
        root,
        "apply",
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_AUTHORITY_REQUIRED"
    assert calls == []


def test_generation_apply_delegates_to_the_existing_writer(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    calls: list[tuple[object, object]] = []

    def runner(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, "private writer output", "")

    result = execute_route_generation(
        root,
        "apply",
        authority="canonical-local",
        runner=runner,
    )

    assert calls[0][0] == [str(root / "rebuild.sh")]
    assert calls[0][1]["cwd"] == root
    assert result["status"] == "passed"
    assert result["authorized"] is True
    assert result["result"]["command"] == "./rebuild.sh"
    assert "private writer output" not in json.dumps(result)


def test_generation_apply_blocks_while_catalogue_mutation_lock_is_held(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    calls: list[object] = []

    with owner_mutation_lock(root):
        result = execute_route_generation(
            root,
            "apply",
            authority="canonical-local",
            runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_ROUTE_GENERATION_BUSY"
    assert calls == []


def test_generation_verify_uses_the_focused_public_gate(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    calls: list[object] = []

    def runner(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "1 passed", "")

    result = execute_route_generation(root, "verify", runner=runner)

    assert calls == [[
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "test_godiesel_local_capabilities.py",
        "test_react_app.py",
    ]]
    assert result["status"] == "passed"
    assert result["result"]["command"] == (
        "python -m pytest -q test_godiesel_local_capabilities.py test_react_app.py"
    )
    assert "1 passed" not in json.dumps(result)
    _assert_valid_evidence(root, result)

    reused = reuse_verification(root, "route-generation", environ={})
    assert reused["status"] == "passed"


def test_curation_inspect_reports_status_counts_without_owner_copy(tmp_path: Path):
    root = _curation_fixture(tmp_path)

    result = execute_owner_curation(root, "inspect")

    assert result["status"] == "passed"
    assert result["result"] == {
        "writer_mode": "local-owner",
        "canonical_routes": 2,
        "curation_statuses": {
            "unset": 1,
            "draft": 0,
            "reviewed": 0,
            "published": 1,
        },
    }
    assert "Owner-authored field note" not in json.dumps(result)


def test_curation_apply_requires_authority_before_reading_plan(tmp_path: Path):
    root = _curation_fixture(tmp_path)
    missing_plan = root / "missing.json"

    result = execute_owner_curation(root, "apply", plan_path=missing_plan)

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_AUTHORITY_REQUIRED"


def test_curation_apply_uses_the_shared_owner_writer(monkeypatch, tmp_path: Path):
    root = _curation_fixture(tmp_path)
    plan = _plan_curation(root)
    captured: dict[str, object] = {}

    def fake_save(checkout_root, activity_id, curation, *, acquire_lock):
        assert acquire_lock is False
        captured.update(
            root=checkout_root,
            activity_id=activity_id,
            curation=curation,
        )
        return {"activity_id": activity_id, "curation": curation}

    monkeypatch.setattr(
        "godiesel_local_capabilities.save_owner_curation",
        fake_save,
    )

    result = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert captured == {
        "root": root,
        "activity_id": "route-1",
        "curation": COMPLETE_CURATION,
    }
    assert result["status"] == "passed"
    assert result["result"] == {
        "activity_id": "route-1",
        "review_status": "reviewed",
        "generation_status": "ready",
        "plan_digest": json.loads(plan.read_text(encoding="utf-8"))["plan_digest"],
        "already_applied": False,
    }
    assert "Owner-authored field note" not in json.dumps(result)


def test_curation_apply_rejects_an_invalid_plan_before_writing(monkeypatch, tmp_path: Path):
    root = _curation_fixture(tmp_path)
    plan = root / "curation-plan.json"
    _write_json(
        plan,
        {
            "schema_version": 1,
            "document_type": "owner-curation-plan",
            "activity_id": "route-1",
            "curation": {"review_status": "reviewed", "vibe": "Incomplete"},
            "observed_state_sha256": "0" * 64,
            "plan_digest": "1" * 64,
        },
    )
    called = False

    def fake_save(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("godiesel_local_capabilities.save_owner_curation", fake_save)

    result = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_CURATION_PLAN_INVALID"
    assert called is False


def test_curation_plan_is_deterministic_and_bound_to_observed_state(tmp_path: Path):
    root = _curation_fixture(tmp_path)
    request = _write_curation_request(root)

    first = execute_owner_curation(root, "plan", request_path=request)
    second = execute_owner_curation(root, "plan", request_path=request)

    assert first["status"] == "passed"
    assert first["result"] == second["result"]
    plan = first["result"]["plan"]
    assert len(plan["observed_state_sha256"]) == 64
    assert len(plan["plan_digest"]) == 64
    assert plan["publication_strategy"] == (
        "incremental-with-full-generation-fallback"
    )
    assert plan["intended_writes"] == [
        "quests.json",
        "app/src/data/generated/routes.manifest.json",
        "app/src/data/generated/route-stats.json",
        "app/public/data/routes/**",
    ]
    assert (root / first["result"]["plan_path"]).is_file()


def test_curation_apply_blocks_when_observed_state_changed(monkeypatch, tmp_path: Path):
    root = _curation_fixture(tmp_path)
    plan = _plan_curation(root)
    config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    config["routes"][0]["status"] = "pending"
    _write_json(root / "quests.json", config)
    called = False

    def fake_save(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr("godiesel_local_capabilities.save_owner_curation", fake_save)

    result = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_CURATION_PLAN_STALE"
    assert called is False


def test_curation_apply_blocks_while_another_process_owns_mutation_lock(tmp_path: Path):
    root = _curation_fixture(tmp_path)
    plan = _plan_curation(root)

    with owner_mutation_lock(root):
        result = execute_owner_curation(
            root,
            "apply",
            plan_path=plan,
            authority="canonical-local",
        )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_OWNER_MUTATION_BUSY"


def test_curation_reapply_is_idempotent_without_reinvoking_writer(monkeypatch, tmp_path: Path):
    root = _curation_fixture(tmp_path)
    plan = _plan_curation(root)
    calls = 0

    def fake_save(checkout_root, activity_id, curation, *, acquire_lock):
        nonlocal calls
        assert acquire_lock is False
        calls += 1
        config_path = checkout_root / "quests.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["routes"][0]["curation"] = curation
        _write_json(config_path, config)
        _write_json(
            checkout_root / "app/public/data/routes" / f"{activity_id}.json",
            {"activity_id": activity_id, "curation": curation},
        )
        _write_json(
            checkout_root / "app/src/data/generated/routes.manifest.json",
            {
                "routes": [
                    {
                        "slug": activity_id,
                        "guide_preview": route_guide_preview(curation),
                    }
                ]
            },
        )

    monkeypatch.setattr("godiesel_local_capabilities.save_owner_curation", fake_save)

    first = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )
    second = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert first["status"] == second["status"] == "passed"
    assert calls == 1
    assert second["result"]["already_applied"] is True


def test_curation_reapply_rejects_incomplete_public_projection(
    monkeypatch, tmp_path: Path
):
    root = _curation_fixture(tmp_path)
    plan = _plan_curation(root)
    calls = 0

    def fake_save(checkout_root, activity_id, curation, *, acquire_lock):
        nonlocal calls
        assert acquire_lock is False
        calls += 1
        config_path = checkout_root / "quests.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["routes"][0]["curation"] = curation
        _write_json(config_path, config)

    monkeypatch.setattr("godiesel_local_capabilities.save_owner_curation", fake_save)

    first = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )
    second = execute_owner_curation(
        root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert first["status"] == "passed"
    assert second["status"] == "blocked"
    assert second["blockers"][0]["code"] == "GODIESEL_CURATION_PLAN_STALE"
    assert calls == 1


def test_curation_verify_uses_the_existing_recovery_suite(tmp_path: Path):
    root = _curation_fixture(tmp_path)
    calls: list[object] = []

    def runner(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "24 passed", "")

    result = execute_owner_curation(root, "verify", runner=runner)

    assert calls == [[
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "test_godiesel_local_capabilities.py",
        "test_admin_curation.py",
        "test_curation_publish.py",
    ]]
    assert result["status"] == "passed"
    assert "24 passed" not in json.dumps(result)
    _assert_valid_evidence(root, result)


def test_curation_proof_reuse_invalidates_when_canonical_state_changes(tmp_path: Path):
    root = _curation_fixture(tmp_path)

    result = execute_owner_curation(
        root,
        "verify",
        runner=lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "passed", ""
        ),
    )
    config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    config["routes"][0]["status"] = "pending"
    _write_json(root / "quests.json", config)

    reused = reuse_verification(root, "owner-curation", environ={})

    assert result["status"] == "passed"
    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"


def test_curation_proof_reuse_invalidates_when_generated_state_changes(tmp_path: Path):
    root = _curation_fixture(tmp_path)
    detail = root / "app/public/data/routes/route-1.json"
    _write_json(detail, {"activity_id": "route-1", "curation": COMPLETE_CURATION})

    result = execute_owner_curation(
        root,
        "verify",
        runner=lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "passed", ""
        ),
    )
    _write_json(detail, {"activity_id": "route-1", "curation": {"review_status": "draft"}})

    reused = reuse_verification(root, "owner-curation", environ={})

    assert result["status"] == "passed"
    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"


def test_planned_route_inspection_preserves_the_browser_local_boundary(tmp_path: Path):
    _write_json(
        tmp_path / "quests.json",
        {"routes": [{"activity_id": "recorded-1", "status": "approved"}]},
    )
    store = tmp_path / "app/src/data/planned-route-store.ts"
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text(
        'export const PLANNED_ROUTE_STORAGE_KEY = "godiesel.planned-routes.v1";\n'
        "const STORE_VERSION = 1 as const;\n",
        encoding="utf-8",
    )

    result = inspect_planned_route_persistence(tmp_path)

    assert result["status"] == "warning"
    assert result["result"] == {
        "runtime_owner": "browser-local-storage",
        "storage_key": "godiesel.planned-routes.v1",
        "store_version": 1,
        "inspection_state": "unavailable-from-repository-process",
        "planned_route_count": None,
        "canonical_projection": "none",
    }
    assert result["warnings"][0]["code"] == "GODIESEL_BROWSER_STATE_NOT_OBSERVED"


def test_planned_route_inspection_blocks_when_owner_metadata_is_unreadable(tmp_path: Path):
    store = tmp_path / "app/src/data/planned-route-store.ts"
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text("const unrelated = true;\n", encoding="utf-8")

    result = inspect_planned_route_persistence(tmp_path)

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_PLANNED_ROUTE_CONTRACT_UNREADABLE"


def test_provider_inspect_separates_configuration_from_live_success(tmp_path: Path):
    secret = "do-not-emit-provider-key"

    result = execute_provider_readiness(
        tmp_path,
        "inspect",
        environ={
            "GOOGLE_MAPS_API_KEY": secret,
            "GODIESEL_EARTH_ENGINE_PROJECT": "test-project",
        },
    )

    providers = {item["id"]: item for item in result["result"]["providers"]}
    assert providers["google-3d"]["configuration_state"] == "configured"
    assert providers["earth-engine"]["configuration_state"] == "configured"
    assert all(item["provider_state"] == "not_run" for item in providers.values())
    assert secret not in json.dumps(result)


def test_provider_verify_requires_an_explicit_live_target(tmp_path: Path):
    calls: list[object] = []

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_PROVIDER_TARGET_REQUIRED"
    assert calls == []


def test_provider_verify_runs_the_named_existing_live_check(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    calls: list[tuple[object, object]] = []

    def runner(command, **kwargs):
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, "live provider passed", "")

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=runner,
    )

    assert calls[0][0] == ["./scripts/verify-provider-readiness.sh", "atlas"]
    assert calls[0][1]["env"]["GODIESEL_ATLAS_PREVIEW_URL"] == "https://preview.example.test/"
    assert result["status"] == "passed"
    assert result["result"] == {
        "provider": "atlas",
        "provider_target": "https://preview.example.test/",
        "configuration_state": "configured",
        "provider_state": "passed",
        "command": "./scripts/verify-provider-readiness.sh atlas",
        "command_exit_code": 0,
    }
    assert "live provider passed" not in json.dumps(result)
    _assert_valid_evidence(tmp_path, result)

    wrong_provider = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "google-3d",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
    )
    assert wrong_provider["status"] == "blocked"


def test_provider_verify_fingerprints_env_file_presence_without_exporting_secret(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    secret = "file-only-provider-secret"
    env_file = tmp_path / "app/.env"
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text(f"VITE_GOOGLE_MAPS_API_KEY={secret}\n", encoding="utf-8")
    captured_env: dict[str, str] = {}

    def runner(command, **kwargs):
        captured_env.update(kwargs["env"])
        return subprocess.CompletedProcess(command, 0, "passed", "")

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="google-3d",
        provider_target="http://localhost:8787/",
        environ={},
        runner=runner,
    )

    assert result["status"] == "passed"
    assert "GOOGLE_MAPS_API_KEY" not in captured_env
    assert "VITE_GOOGLE_MAPS_API_KEY" not in captured_env
    assert secret not in json.dumps(result)
    evidence = result["evidence"]
    receipt = (tmp_path / evidence["path"]).read_text(encoding="utf-8")
    assert secret not in receipt


def test_provider_proof_reuse_invalidates_when_adapter_changes(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    adapter = tmp_path / "godiesel_local_capabilities.py"
    adapter.write_text("first\n", encoding="utf-8")

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "passed", ""
        ),
    )
    adapter.write_text("second\n", encoding="utf-8")

    reused = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "atlas",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
    )

    assert result["status"] == "passed"
    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"


def test_provider_proof_reuse_blocks_expired_live_evidence(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "passed", ""
        ),
    )
    receipt_path = tmp_path / result["evidence"]["path"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["finished_at"] = "2000-01-01T00:00:00+00:00"
    _write_json(receipt_path, receipt)

    reused = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "atlas",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_LIVE_PROOF_STALE"


def test_cli_dispatches_generation_with_exact_authority(monkeypatch, capsys):
    captured: dict[str, object] = {}

    def fake_execute(root, verb, **kwargs):
        captured.update(root=root, verb=verb, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.execute_route_generation", fake_execute)

    exit_code = main(
        ["apply", "route-generation", "--authorize", "canonical-local", "--json"]
    )

    assert exit_code == 0
    assert captured["verb"] == "apply"
    assert captured["authority"] == "canonical-local"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_dispatches_curation_plan(monkeypatch, capsys, tmp_path: Path):
    captured: dict[str, object] = {}

    def fake_execute(root, verb, **kwargs):
        captured.update(root=root, verb=verb, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.execute_owner_curation", fake_execute)
    plan = tmp_path / "plan.json"

    exit_code = main(
        [
            "apply",
            "owner-curation",
            "--plan",
            str(plan),
            "--authorize",
            "canonical-local",
            "--json",
        ]
    )

    assert exit_code == 0
    assert captured["verb"] == "apply"
    assert captured["plan_path"] == str(plan)
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_dispatches_curation_request_for_planning(monkeypatch, capsys, tmp_path: Path):
    captured: dict[str, object] = {}

    def fake_execute(root, verb, **kwargs):
        captured.update(root=root, verb=verb, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.execute_owner_curation", fake_execute)
    request = tmp_path / "request.json"

    exit_code = main(
        ["plan", "owner-curation", "--request", str(request), "--json"]
    )

    assert exit_code == 0
    assert captured["verb"] == "plan"
    assert captured["request_path"] == str(request)
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_dispatches_planned_route_inspection(monkeypatch, capsys):
    monkeypatch.setattr(
        "godiesel_control.inspect_planned_route_persistence",
        lambda root: {"status": "warning", "exit_code": 0},
    )

    exit_code = main(["inspect", "planned-route-persistence", "--json"])

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out)["status"] == "warning"


def test_cli_dispatches_named_provider_and_target(monkeypatch, capsys):
    captured: dict[str, object] = {}

    def fake_execute(root, verb, **kwargs):
        captured.update(root=root, verb=verb, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.execute_provider_readiness", fake_execute)

    exit_code = main(
        [
            "verify",
            "provider-readiness",
            "--provider",
            "atlas",
            "--provider-target",
            "https://preview.example.test/",
            "--json",
        ]
    )

    assert exit_code == 0
    assert captured["provider"] == "atlas"
    assert captured["provider_target"] == "https://preview.example.test/"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_reuses_generation_proof_without_running_the_gate(monkeypatch, capsys):
    captured: dict[str, object] = {}

    def fake_reuse(root, capability, **kwargs):
        captured.update(root=root, capability=capability, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.reuse_verification", fake_reuse)
    monkeypatch.setattr(
        "godiesel_control.execute_route_generation",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("verification gate must not run")
        ),
    )

    exit_code = main(["verify", "route-generation", "--reuse", "--json"])

    assert exit_code == 0
    assert captured["capability"] == "route-generation"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_binds_provider_reuse_to_provider_and_target(monkeypatch, capsys):
    captured: dict[str, object] = {}

    def fake_reuse(root, capability, **kwargs):
        captured.update(root=root, capability=capability, **kwargs)
        return {"status": "passed", "exit_code": 0}

    monkeypatch.setattr("godiesel_control.reuse_verification", fake_reuse)
    monkeypatch.setattr(
        "godiesel_control.provider_proof_environment",
        lambda root, environ: {"GOOGLE_MAPS_API_KEY": "present-without-value"},
    )

    exit_code = main(
        [
            "verify",
            "provider-readiness",
            "--provider",
            "atlas",
            "--provider-target",
            "https://preview.example.test/",
            "--reuse",
            "--json",
        ]
    )

    assert exit_code == 0
    assert captured["expected_inputs"] == {
        "provider": "atlas",
        "provider-target": "https://preview.example.test/",
    }
    assert captured["provider_target"] == "https://preview.example.test/"
    assert captured["environ"] == {
        "GOOGLE_MAPS_API_KEY": "present-without-value"
    }
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_cli_contains_local_adapter_failures_in_the_capability_contract(
    monkeypatch, capsys
):
    monkeypatch.setattr(
        "godiesel_control.execute_owner_curation",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("private detail")),
    )

    exit_code = main(["inspect", "owner-curation", "--json"])

    result = json.loads(capsys.readouterr().out)
    assert exit_code == 2
    assert result["document_type"] == "godiesel-capability-result"
    assert result["capability"] == "owner-curation"
    assert result["verb"] == "inspect"
    assert result["authority"] == "read-only"
    assert result["blockers"][0]["code"] == "GODIESEL_CONTROL_INTERNAL_ERROR"
    assert "private detail" not in json.dumps(result)
