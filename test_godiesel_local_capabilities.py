"""Public contracts for the canonical local capability adapters."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from hashlib import sha256
from pathlib import Path

import pytest
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


ROOT = Path(__file__).resolve().parent
TEST_BUILD_COMMIT = "a" * 40
TEST_BUILD_TREE = "b" * 40
TEST_BUILD_ID = "12345678-1234-4234-8234-123456789abc"


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
    for name in (
        "build-identity.schema.json",
        "capabilities.json",
        "evidence-receipt.schema.json",
    ):
        destination = root / "system" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((source / name).read_bytes())


def _matching_target_identity(_target: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "document_type": "godiesel-build-identity",
        "commit": TEST_BUILD_COMMIT,
        "tree": TEST_BUILD_TREE,
        "build_id": TEST_BUILD_ID,
    }


def _clean_repository_identity(_root: Path) -> dict[str, object]:
    return {
        "commit": TEST_BUILD_COMMIT,
        "tree": TEST_BUILD_TREE,
        "branch": "test",
        "worktree_sha256": "b" * 64,
        "dirty_state": {"clean": True, "sha256": "c" * 64},
    }


def _projection_record(activity_id: str) -> dict[str, object]:
    return {
        "activity_id": activity_id,
        "slug": activity_id,
        "source_kind": "strava-export",
        "lifecycle": "completed",
        "name": "Test region",
        "subtitle": "Test route",
        "activity_name": "Test route",
        "region": "Test region",
        "date": "2026-01-01",
        "distance_km": 1.0,
        "elevation_gain_m": None,
        "elevation_status": "unavailable",
        "type": "Run",
        "description": "",
        "completion_rule": "Complete a 1.0 km run in Test region.",
        "difficulty": "Easy",
        "theme": "Wander Run",
        "xp": 60,
        "center_lat": 50.0,
        "center_lng": -114.0,
        "replay": {
            "mode": "atlas",
            "replay_eligible": True,
            "best_in_earth": False,
            "geometry_status": "ready",
            "point_count": 3,
        },
    }


def _route_points() -> list[dict[str, object]]:
    return [
        {"lat": 50.0, "lng": -114.0, "elev": None, "d": 0.0},
        {"lat": 50.0, "lng": -114.0, "elev": None, "d": 500.0},
        {"lat": 50.0, "lng": -114.0, "elev": None, "d": 1000.0},
    ]


def _route_provenance() -> dict[str, object]:
    return {
        "temporal": {"status": "unavailable"},
        "elevation": {"status": "unavailable"},
        "track": {"segment_count": 1},
        "discontinuities": [],
    }


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
                {
                    "activity_id": "route-1",
                    "status": "approved",
                    "activity_name": "Test route",
                    "activity_type": "Run",
                    "date": "2026-01-01",
                    "description": "",
                },
                {"activity_id": "route-2", "status": "pending"},
            ]
        },
    )
    _write_json(
        root / "app/src/data/generated/routes.manifest.json",
        {
            "schema_version": 1,
            "generated_at": "2026-01-01T00:00:00Z",
            "stats": {"approved": 1, "pending": 1, "rejected": 0, "total": 2},
            "routes": [
                {
                    **_projection_record("route-1"),
                    "trace": [
                        [50.0, -114.0, None, 0.0],
                        [50.0, -114.0, None, 500.0],
                        [50.0, -114.0, None, 1000.0],
                    ],
                    "guide_preview": {"review_status": "draft"},
                }
            ]
        },
    )
    _write_json(
        root / "app/src/data/generated/route-stats.json",
        {"route_count": 1, "completed_km": 1.0},
    )
    _write_json(
        root / "app/public/data/routes/route-1.json",
        {
            **_projection_record("route-1"),
            "route": _route_points(),
            "mid_idx": 1,
            "provenance": _route_provenance(),
        },
    )
    (root / "rebuild.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    return root


def _curation_fixture(root: Path) -> Path:
    _install_evidence_contract(root)
    _write_json(
        root / "quests.json",
        {
            "routes": [
                {
                    "activity_id": "route-1",
                    "status": "approved",
                    "activity_name": "Test route",
                    "activity_type": "Run",
                    "date": "2026-01-01",
                    "description": "",
                },
                {
                    "activity_id": "route-2",
                    "status": "approved",
                    "visibility": "hidden",
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


def _write_complete_curation_projection(
    root: Path,
    activity_id: str,
    curation: dict[str, object],
) -> None:
    config_path = root / "quests.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    route = next(
        route for route in config["routes"] if route["activity_id"] == activity_id
    )
    route["curation"] = curation
    _write_json(config_path, config)
    projected = _projection_record(activity_id)
    _write_json(
        root / "app/public/data/routes" / f"{activity_id}.json",
        {
            **projected,
            "route": _route_points(),
            "mid_idx": 1,
            "provenance": _route_provenance(),
            "curation": curation,
        },
    )
    _write_json(
        root / "app/src/data/generated/routes.manifest.json",
        {
            "schema_version": 1,
            "generated_at": "2026-01-01T00:00:00Z",
            "stats": {"approved": 1, "pending": 0, "rejected": 0, "total": 2},
            "routes": [
                {
                    **projected,
                    "trace": [
                        [50.0, -114.0, None, 0.0],
                        [50.0, -114.0, None, 500.0],
                        [50.0, -114.0, None, 1000.0],
                    ],
                    "guide_preview": route_guide_preview(curation),
                }
            ]
        },
    )
    _write_json(
        root / "app/src/data/generated/route-stats.json",
        {"route_count": 1, "completed_km": 1.0},
    )


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
        "reported_completed_km": 1.0,
        "expected_completed_km": 1.0,
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


def test_generation_inspect_rejects_stale_fields_and_statistics(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    manifest_path = root / "app/src/data/generated/routes.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["routes"][0]["distance_km"] = 99.0
    _write_json(manifest_path, manifest)
    _write_json(
        root / "app/src/data/generated/route-stats.json",
        {"route_count": 1, "completed_km": -4.0},
    )

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert {blocker["code"] for blocker in result["blockers"]} == {
        "GODIESEL_GENERATED_PROJECTION_DRIFT",
        "GODIESEL_GENERATED_STATS_DRIFT",
    }


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
            runner=lambda command, **kwargs: (
                calls.append((command, kwargs))
                or subprocess.CompletedProcess(
                    command,
                    2,
                    "",
                    "Another catalogue mutation is in progress.\n",
                )
            ),
        )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_ROUTE_GENERATION_BUSY"
    assert len(calls) == 1


def test_retained_route_commands_honor_catalogue_mutation_lock(tmp_path: Path):
    proposal = tmp_path / "proposal.json"
    _write_json(proposal, {})
    watched = [
        ROOT / "quests.json",
        ROOT / "app/src/data/generated/routes.manifest.json",
        ROOT / "app/src/data/generated/route-stats.json",
    ]
    before = {path: path.read_bytes() for path in watched}

    with owner_mutation_lock(ROOT):
        create = subprocess.run(
            [str(ROOT / "scripts/route.sh"), "create", "--proposal", str(proposal)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        build = subprocess.run(
            [str(ROOT / "scripts/route.sh"), "build"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    assert create.returncode == 2
    assert json.loads(create.stderr)["error"]["code"] == "repository.mutation_busy"
    assert build.returncode == 2
    assert "Another catalogue mutation is in progress." in build.stderr
    assert {path: path.read_bytes() for path in watched} == before


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


def test_generation_verify_blocks_when_covered_inputs_change_during_gate(
    tmp_path: Path,
):
    root = _generation_fixture(tmp_path)

    def runner(command, **kwargs):
        config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
        config["routes"][0]["status"] = "pending"
        _write_json(root / "quests.json", config)
        return subprocess.CompletedProcess(command, 0, "passed", "")

    result = execute_route_generation(root, "verify", runner=runner)

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_VERIFICATION_INPUTS_CHANGED"
    receipt = json.loads(
        (root / result["evidence"]["path"]).read_text(encoding="utf-8")
    )
    assert receipt["status"] == "blocked"
    reused = reuse_verification(root, "route-generation", environ={})
    assert reused["status"] == "blocked"


@pytest.mark.parametrize(
    ("target", "mutation"),
    [
        (
            "detail",
            lambda value: value.update(
                route=[
                    {"lat": 999, "lng": -114, "elev": None, "d": -1},
                    {"lat": 50, "lng": -114, "elev": None, "d": 1000},
                ]
            ),
        ),
        ("detail", lambda value: value.update(provenance={})),
        (
            "summary",
            lambda value: value.update(
                trace=[[999, -114, None, -1], [50, -114, None, 1000]]
            ),
        ),
    ],
)
def test_generation_inspect_blocks_structurally_invalid_projection(
    tmp_path: Path,
    target: str,
    mutation,
):
    root = _generation_fixture(tmp_path)
    path = (
        root / "app/public/data/routes/route-1.json"
        if target == "detail"
        else root / "app/src/data/generated/routes.manifest.json"
    )
    payload = json.loads(path.read_text(encoding="utf-8"))
    record = payload if target == "detail" else payload["routes"][0]
    mutation(record)
    _write_json(path, payload)

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_GENERATED_PROJECTION_DRIFT"


@pytest.mark.parametrize(
    ("target", "field", "value"),
    [
        ("summary", "trace", [[50.0, -114.0, None, 0.0], [50.1, -114.0, None, 500.0], [50.0, -114.0, None, 1000.0]]),
        ("detail", "mid_idx", 0),
        ("both", "xp", 999),
    ],
)
def test_generation_inspect_blocks_semantically_stale_projection(
    tmp_path: Path,
    target: str,
    field: str,
    value: object,
):
    root = _generation_fixture(tmp_path)
    summary_path = root / "app/src/data/generated/routes.manifest.json"
    detail_path = root / "app/public/data/routes/route-1.json"
    if target in {"summary", "both"}:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        summary["routes"][0][field] = value
        _write_json(summary_path, summary)
    if target in {"detail", "both"}:
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        detail[field] = value
        _write_json(detail_path, detail)

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_GENERATED_PROJECTION_DRIFT"


def test_generation_inspect_blocks_coordinated_source_metadata_drift(tmp_path: Path):
    root = _generation_fixture(tmp_path)
    summary_path = root / "app/src/data/generated/routes.manifest.json"
    detail_path = root / "app/public/data/routes/route-1.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    summary["routes"][0]["date"] = "2099-12-31"
    detail["date"] = "2099-12-31"
    _write_json(summary_path, summary)
    _write_json(detail_path, detail)

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_GENERATED_PROJECTION_DRIFT"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 99),
        ("generated_at", "not-a-timestamp"),
        ("stats", {"approved": 999, "pending": 0, "rejected": 0, "total": 999}),
    ],
)
def test_generation_inspect_blocks_manifest_metadata_drift(
    tmp_path: Path,
    field: str,
    value: object,
):
    root = _generation_fixture(tmp_path)
    manifest_path = root / "app/src/data/generated/routes.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[field] = value
    _write_json(manifest_path, manifest)

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_GENERATED_INVENTORY_DRIFT"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("replay_mode", "earth"),
        (
            "annotations",
            [
                {
                    "id": "owner-note",
                    "at_distance_m": 500,
                    "kind": "note",
                    "evidence": "recorded",
                    "body": "A route note.",
                }
            ],
        ),
    ],
)
def test_generation_inspect_compares_canonical_replay_and_annotations(
    tmp_path: Path,
    field: str,
    value: object,
):
    root = _generation_fixture(tmp_path)
    config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    config["routes"][0][field] = value
    _write_json(root / "quests.json", config)

    result = execute_route_generation(root, "inspect")

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_GENERATED_PROJECTION_DRIFT"


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
        _write_complete_curation_projection(checkout_root, activity_id, curation)
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
    assert len(plan["context"]["implementation_sha256"]) == 64
    assert len(plan["context"]["repository"]["worktree_sha256"]) == 64
    assert plan["change_summary"]["review_status_before"] == "unset"
    assert plan["change_summary"]["review_status_after"] == "reviewed"
    assert plan["change_summary"]["changed_fields"] == sorted(COMPLETE_CURATION)
    assert COMPLETE_CURATION["editorial_note"] not in json.dumps(plan["change_summary"])
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


def test_curation_plan_cannot_be_applied_in_another_checkout(tmp_path: Path):
    first_root = _curation_fixture(tmp_path / "checkout-a")
    plan = _plan_curation(first_root)
    second_root = tmp_path / "checkout-b"
    shutil.copytree(first_root, second_root)

    result = execute_owner_curation(
        second_root,
        "apply",
        plan_path=plan,
        authority="canonical-local",
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_CURATION_PLAN_CONTEXT_MISMATCH"
    )
    config = json.loads((second_root / "quests.json").read_text(encoding="utf-8"))
    assert "curation" not in config["routes"][0]


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

    def changing_repository_identity(checkout_root: Path) -> dict[str, object]:
        dirty_digest = sha256((checkout_root / "quests.json").read_bytes()).hexdigest()
        return {
            "commit": TEST_BUILD_COMMIT,
            "branch": "test",
            "worktree_sha256": "b" * 64,
            "dirty_state": {"clean": False, "sha256": dirty_digest},
        }

    monkeypatch.setattr(
        "godiesel_local_capabilities.repository_snapshot",
        changing_repository_identity,
    )
    plan = _plan_curation(root)
    calls = 0

    def fake_save(checkout_root, activity_id, curation, *, acquire_lock):
        nonlocal calls
        assert acquire_lock is False
        calls += 1
        _write_complete_curation_projection(checkout_root, activity_id, curation)

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

    assert first["status"] == "blocked"
    assert first["blockers"][0]["code"] == (
        "GODIESEL_CURATION_PROJECTION_INCOMPLETE"
    )
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


def test_provider_verify_rejects_path_scoped_target(tmp_path: Path):
    calls: list[object] = []

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/identity-proxy",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_PROVIDER_TARGET_REQUIRED"
    assert calls == []


def test_provider_verify_rejects_target_built_from_another_commit(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    calls: list[object] = []

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        target_identity_reader=lambda _target: {
            **_matching_target_identity(""),
            "commit": "d" * 40,
        },
        repository_reader=_clean_repository_identity,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_PROVIDER_BUILD_IDENTITY_MISMATCH"
    )
    assert calls == []


def test_provider_verify_rejects_malformed_build_instance_id(tmp_path: Path):
    _install_evidence_contract(tmp_path)

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda *args, **kwargs: None,
        target_identity_reader=lambda _target: {
            **_matching_target_identity(""),
            "build_id": "not-a-uuid",
        },
        repository_reader=_clean_repository_identity,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == "GODIESEL_PROVIDER_BUILD_IDENTITY_UNREADABLE"


def test_provider_verify_rejects_dirty_or_uncommitted_local_build(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    calls: list[object] = []
    dirty_repository = _clean_repository_identity(tmp_path)
    dirty_repository["dirty_state"] = {"clean": False, "sha256": "e" * 64}

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="google-3d",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda *args, **kwargs: calls.append((args, kwargs)),
        target_identity_reader=_matching_target_identity,
        repository_reader=lambda _root: dirty_repository,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_PROVIDER_LOCAL_BUILD_UNBOUND"
    )
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
    )

    assert calls[0][0] == ["./scripts/verify-provider-readiness.sh", "atlas"]
    assert calls[0][1]["env"]["GODIESEL_ATLAS_PREVIEW_URL"] == "https://preview.example.test/"
    assert result["status"] == "passed"
    assert result["result"] == {
        "provider": "atlas",
        "provider_target": "https://preview.example.test/",
        "configuration_state": "configured",
        "provider_state": "passed",
        "build_identity": _matching_target_identity(""),
        "command": "./scripts/verify-provider-readiness.sh atlas",
        "command_exit_code": 0,
    }
    assert "live provider passed" not in json.dumps(result)
    _assert_valid_evidence(tmp_path, result)
    receipt = json.loads(
        (tmp_path / result["evidence"]["path"]).read_text(encoding="utf-8")
    )
    assert receipt["external_target"]["immutable_id"] == TEST_BUILD_ID

    reused = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "atlas",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
    )
    assert reused["status"] == "passed"
    Draft202012Validator(
        json.loads(
            (ROOT / "system/verification-reuse.schema.json").read_text(
                encoding="utf-8"
            )
        )
    ).validate(reused["result"])

    wrong_provider = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "google-3d",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
    )
    assert wrong_provider["status"] == "blocked"


def test_provider_verify_blocks_when_deployed_identity_changes_during_gate(
    tmp_path: Path,
):
    _install_evidence_contract(tmp_path)
    identities = [
        _matching_target_identity(""),
        {**_matching_target_identity(""), "build_id": "87654321-4321-4321-8321-cba987654321"},
    ]

    result = execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "passed", ""
        ),
        target_identity_reader=lambda _target: identities.pop(0),
        repository_reader=_clean_repository_identity,
    )

    assert result["status"] == "blocked"
    assert result["blockers"][0]["code"] == (
        "GODIESEL_PROVIDER_BUILD_IDENTITY_CHANGED"
    )
    receipt = json.loads(
        (tmp_path / result["evidence"]["path"]).read_text(encoding="utf-8")
    )
    assert receipt["status"] == "blocked"
    assert identities == []


def test_provider_reuse_refetches_and_rejects_changed_deployed_identity(
    tmp_path: Path,
):
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
    )

    reused = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "atlas",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
        target_identity_reader=lambda _target: {
            **_matching_target_identity(""),
            "commit": "d" * 40,
        },
        repository_reader=_clean_repository_identity,
    )

    assert result["status"] == "passed"
    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == (
        "GODIESEL_PROVIDER_BUILD_IDENTITY_MISMATCH"
    )


def test_provider_reuse_rejects_same_commit_redeployment(tmp_path: Path):
    _install_evidence_contract(tmp_path)
    execute_provider_readiness(
        tmp_path,
        "verify",
        provider="atlas",
        provider_target="https://preview.example.test/",
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        runner=lambda command, **kwargs: subprocess.CompletedProcess(command, 0, "passed", ""),
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
    )

    reused = reuse_verification(
        tmp_path,
        "provider-readiness",
        expected_inputs={
            "provider": "atlas",
            "provider-target": "https://preview.example.test/",
        },
        environ={"GOOGLE_MAPS_API_KEY": "secret"},
        provider_target="https://preview.example.test/",
        target_identity_reader=lambda _target: {
            **_matching_target_identity(""),
            "build_id": "87654321-4321-4321-8321-cba987654321",
        },
        repository_reader=_clean_repository_identity,
    )

    assert reused["status"] == "blocked"
    assert reused["blockers"][0]["code"] == "GODIESEL_PROOF_INVALIDATED"


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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
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
        target_identity_reader=_matching_target_identity,
        repository_reader=_clean_repository_identity,
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
