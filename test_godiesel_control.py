import json
import os
import subprocess
from hashlib import sha256
from pathlib import Path

from jsonschema import Draft202012Validator

from godiesel_control import doctor_system, inspect_system, main


ROOT = Path(__file__).resolve().parent


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def _make_repository_fixture(root: Path, *, generated_ids: list[str] | None = None) -> Path:
    generated_ids = ["route-1"] if generated_ids is None else generated_ids
    capability = {
        "id": "route-generation",
        "entity": "generated-route-projection",
        "summary": "Fixture route projection.",
        "verbs": ["inspect"],
        "authority": {"inspect": "read-only"},
        "inputs": {"inspect": []},
        "reads": ["quests.json"],
        "writes": ["app/src/data/generated/**", "app/public/data/routes/**"],
        "external_effects": [],
        "required_files": ["build.py"],
        "configuration": [
            {
                "name": "GOOGLE_MAPS_API_KEY",
                "required_for": ["inspect"],
                "sensitive": True,
            }
        ],
        "commands": {"inspect": []},
        "preconditions": [],
        "idempotency": {"inspect": "read-only"},
        "recovery": {"inspect": "No recovery is required."},
        "artifacts": [],
        "invariants": ["single-writer"],
        "verification": {"focused": [], "ticket": [], "release": [], "live": []},
        "documents": [],
    }
    _write_json(
        root / "system" / "capabilities.schema.json",
        json.loads(
            (ROOT / "system" / "capabilities.schema.json").read_text(
                encoding="utf-8"
            )
        ),
    )
    _write_json(
        root / "system" / "capabilities.json",
        {
            "schema_version": 1,
            "document_type": "godiesel-capability-manifest",
            "capabilities": [capability],
            "impact_rules": [
                {
                    "id": "fixture-implementation",
                    "paths": ["build.py"],
                    "capabilities": ["route-generation"],
                    "category": "implementation",
                    "gates": [
                        {"capability": "route-generation", "tier": "focused"}
                    ],
                    "invariants": [
                        {"capability": "route-generation", "id": "single-writer"}
                    ],
                    "reason": "Exercise the fixture capability through its public seam."
                }
            ],
        },
    )
    _write_json(
        root / "quests.json",
        {"routes": [{"activity_id": "route-1", "status": "approved"}]},
    )
    _write_json(
        root / "app" / "src" / "data" / "generated" / "routes.manifest.json",
        {
            "schema_version": 1,
            "routes": [
                {"activity_id": route_id, "slug": route_id} for route_id in generated_ids
            ],
        },
    )
    _write_json(
        root / "app" / "src" / "data" / "generated" / "route-stats.json",
        {"route_count": len(generated_ids)},
    )
    for route_id in generated_ids:
        _write_json(root / "app" / "public" / "data" / "routes" / f"{route_id}.json", {})
    for path in ("admin.py", "build.py", "curation_publish.py", "route_create.py"):
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("# fixture\n", encoding="utf-8")
    for directory in (root / "docs" / "adr", root / "docs" / "plans"):
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "README.md").write_text("# Index\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "fixture@example.test"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Fixture"], cwd=root, check=True)
    subprocess.run(["git", "add", "."], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=root, check=True)
    return root


def test_capability_manifest_is_valid_and_declares_the_system_boundaries():
    schema = json.loads((ROOT / "system" / "capabilities.schema.json").read_text())
    manifest = json.loads((ROOT / "system" / "capabilities.json").read_text())

    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(manifest)

    capabilities = {item["id"]: item for item in manifest["capabilities"]}
    assert set(capabilities) == {
        "application-release",
        "owner-curation",
        "planned-route-persistence",
        "provider-readiness",
        "route-generation",
        "route-share",
    }
    assert capabilities["route-share"]["authority"]["inspect"] == "read-only"
    assert capabilities["route-share"]["authority"]["apply"] == "canonical-local"
    assert capabilities["route-share"]["authority"]["release"] == "external-durable"
    assert capabilities["route-share"]["commands"]["release"][0]["command"] == (
        "./scripts/godiesel release route-share <slug> <share-name> "
        "--authorize external-durable --authorize-target <share-name> --json"
    )
    assert capabilities["application-release"]["commands"]["release"][0]["command"] == (
        "npx wrangler pages deploy dist --project-name=godiesel --branch=production"
    )
    assert capabilities["route-generation"]["commands"]["apply"][0]["command"] == (
        "./scripts/godiesel apply route-generation --authorize canonical-local --json"
    )
    assert capabilities["owner-curation"]["commands"]["apply"][0]["command"] == (
        "./scripts/godiesel apply owner-curation --plan <plan-path> "
        "--authorize canonical-local --json"
    )
    assert capabilities["planned-route-persistence"]["writes"] == []
    assert capabilities["provider-readiness"]["authority"]["inspect"] == "read-only"
    assert capabilities["provider-readiness"]["authority"]["verify"] == "ephemeral-local"
    assert "app/public/data/.route-generation-backup/**" in capabilities[
        "route-share"
    ]["writes"]
    assert any(
        artifact["kind"] == "route-generation-recovery"
        and artifact["location"] == "app/public/data/.route-generation-backup/**"
        for artifact in capabilities["route-share"]["artifacts"]
    )
    for capability_id in ("route-share", "route-generation", "owner-curation"):
        assert "app/public/data/.routes-staging-*/**" in capabilities[
            capability_id
        ]["writes"]
        assert any(
            artifact["kind"] == "route-generation-staging"
            for artifact in capabilities[capability_id]["artifacts"]
        )
    assert ".quests.json.rollback" in capabilities["owner-curation"]["writes"]
    assert "app/public/data/.route-generation-backup/**" in capabilities[
        "owner-curation"
    ]["writes"]
    assert "$GIT_COMMON_DIR/godiesel-provider-preview.lock" in capabilities[
        "provider-readiness"
    ]["writes"]
    assert "/app/public/data/.route-generation-backup/" in (
        ROOT / ".gitignore"
    ).read_text(encoding="utf-8").splitlines()
    assert "/app/public/data/.routes-staging-*/" in (
        ROOT / ".gitignore"
    ).read_text(encoding="utf-8").splitlines()
    for capability in capabilities.values():
        verbs = set(capability["verbs"])
        assert set(capability["authority"]) == verbs
        assert set(capability["commands"]) == verbs
        assert set(capability["inputs"]) == verbs
        assert set(capability["idempotency"]) == verbs
        assert set(capability["recovery"]) == verbs


def test_release_cli_forwards_exact_target_authority(monkeypatch, capsys):
    captured: dict[str, object] = {}

    def fake_execute(root: Path, verb: str, **kwargs: object) -> dict[str, object]:
        captured.update({"root": root, "verb": verb, **kwargs})
        return {
            "status": "passed",
            "exit_code": 0,
        }

    monkeypatch.setattr("godiesel_control.execute_route_share", fake_execute)

    exit_code = main(
        [
            "release",
            "route-share",
            "route-1",
            "ridge",
            "--authorize",
            "external-durable",
            "--authorize-target",
            "ridge",
            "--json",
        ]
    )

    assert exit_code == 0
    assert captured["verb"] == "release"
    assert captured["authority"] == "external-durable"
    assert captured["target_authority"] == "ridge"
    assert json.loads(capsys.readouterr().out)["status"] == "passed"


def test_inspect_system_returns_a_redacted_operator_view():
    secret = "never-emit-this-provider-secret"

    result = inspect_system(ROOT, environ={"GOOGLE_MAPS_API_KEY": secret})

    assert result["schema_version"] == 1
    assert result["document_type"] == "godiesel-system-inspection"
    assert result["status"] in {"passed", "warning", "blocked"}
    assert len(result["repository"]["commit"]) == 40
    assert isinstance(result["repository"]["worktree"]["clean"], bool)
    assert isinstance(result["repository"]["worktree"]["changed_paths"], list)
    assert {item["id"] for item in result["capabilities"]} == {
        "application-release",
        "owner-curation",
        "planned-route-persistence",
        "provider-readiness",
        "route-generation",
        "route-share",
    }
    route_share = next(item for item in result["capabilities"] if item["id"] == "route-share")
    assert route_share["next_transitions"][0] == {
        "verb": "inspect",
        "authority": "read-only",
        "command": "./scripts/godiesel inspect route-share --json",
    }
    assert result["next_transitions"] == [
        {
            "verb": "inspect",
            "authority": "read-only",
            "command": "./scripts/godiesel doctor --json",
        }
    ]
    serialized = json.dumps(result)
    assert secret not in serialized
    assert "GM LEGENDS" not in serialized


def test_doctor_is_read_only_and_reports_configuration_without_values(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    watched_paths = [
        root / "quests.json",
        root / "app" / "src" / "data" / "generated" / "routes.manifest.json",
        root / "app" / "src" / "data" / "generated" / "route-stats.json",
    ]
    before = {path: sha256(path.read_bytes()).hexdigest() for path in watched_paths}
    secret = "never-emit-this-doctor-secret"

    result = doctor_system(
        root,
        environ={"PATH": os.environ["PATH"], "GOOGLE_MAPS_API_KEY": secret},
    )

    after = {path: sha256(path.read_bytes()).hexdigest() for path in watched_paths}
    assert after == before
    assert result["schema_version"] == 1
    assert result["document_type"] == "godiesel-system-doctor-report"
    assert {check["id"] for check in result["checks"]} == {
        "capability-files",
        "command-references",
        "configuration",
        "documentation-indexes",
        "generated-projection",
        "manifest",
        "repository",
        "runtimes",
        "writers",
    }
    configuration = {item["name"]: item for item in result["configuration"]}
    assert configuration["GOOGLE_MAPS_API_KEY"]["status"] == "configured"
    assert secret not in json.dumps(result)
    assert "GM LEGENDS" not in json.dumps(result)


def test_doctor_uses_stable_codes_for_missing_dependencies(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")

    result = doctor_system(root, environ={"PATH": ""})

    codes = {issue["code"] for issue in result["warnings"] + result["blockers"]}
    assert "GODIESEL_RUNTIME_MISSING_GIT" in codes
    assert "GODIESEL_RUNTIME_MISSING_NODE" in codes
    assert "GODIESEL_RUNTIME_MISSING_NPM" in codes
    assert all(issue["remediation"] for issue in result["warnings"] + result["blockers"])


def test_doctor_reports_missing_configuration_from_an_isolated_fixture(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")

    result = doctor_system(root, environ={"PATH": os.environ["PATH"]})

    configuration = {item["name"]: item for item in result["configuration"]}
    assert configuration["GOOGLE_MAPS_API_KEY"]["status"] == "missing"
    assert "GODIESEL_CONFIGURATION_MISSING" in {
        issue["code"] for issue in result["warnings"]
    }


def test_inspect_classifies_clean_and_dirty_worktrees(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")

    clean = inspect_system(root)
    (root / "untracked.txt").write_text("changed\n", encoding="utf-8")
    dirty = inspect_system(root)

    assert clean["repository"]["worktree"] == {"clean": True, "changed_paths": []}
    assert dirty["repository"]["worktree"] == {
        "clean": False,
        "changed_paths": ["untracked.txt"],
    }


def test_doctor_blocks_stale_generated_inventory(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository", generated_ids=[])

    result = doctor_system(root)

    assert result["status"] == "blocked"
    assert "GODIESEL_GENERATED_INVENTORY_DRIFT" in {
        issue["code"] for issue in result["blockers"]
    }


def test_doctor_blocks_duplicate_generated_routes(tmp_path):
    root = _make_repository_fixture(
        tmp_path / "repository", generated_ids=["route-1", "route-1"]
    )

    result = doctor_system(root)

    assert "GODIESEL_GENERATED_INVENTORY_DRIFT" in {
        issue["code"] for issue in result["blockers"]
    }


def test_doctor_blocks_unindexed_architecture_records(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    (root / "docs" / "adr" / "0001-unindexed.md").write_text("# Unindexed\n", encoding="utf-8")

    result = doctor_system(root)

    assert "GODIESEL_DOCUMENTATION_INDEX_DRIFT" in {
        issue["code"] for issue in result["blockers"]
    }


def test_doctor_blocks_index_references_to_deleted_records(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    (root / "docs" / "adr" / "README.md").write_text(
        "# Index\n\n[Deleted](0002-deleted.md)\n", encoding="utf-8"
    )

    result = doctor_system(root)

    assert "GODIESEL_DOCUMENTATION_INDEX_DRIFT" in {
        issue["code"] for issue in result["blockers"]
    }


def test_cli_inspect_emits_only_the_json_result_envelope():
    completed = subprocess.run(
        [str(ROOT / "scripts" / "godiesel"), "inspect", "system", "--json"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    result = json.loads(completed.stdout)
    assert completed.returncode == 0
    assert completed.stderr == ""
    assert result["document_type"] == "godiesel-system-inspection"
    assert result["schema_version"] == 1


def test_cli_doctor_uses_the_documented_short_form():
    completed = subprocess.run(
        [str(ROOT / "scripts" / "godiesel"), "doctor", "--json"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    result = json.loads(completed.stdout)
    assert completed.returncode == 0
    assert completed.stderr == ""
    assert result["document_type"] == "godiesel-system-doctor-report"


def test_inspect_redacts_private_source_paths(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    private_path = root / "route_sources" / 'private "activity id".gpx'
    private_path.parent.mkdir(parents=True)
    private_path.write_text("private\n", encoding="utf-8")

    result = inspect_system(root)

    serialized = json.dumps(result)
    assert "private" not in serialized
    assert result["repository"]["worktree"]["changed_paths"] == [
        "route_sources/<redacted>"
    ]


def test_malformed_manifest_returns_a_blocker_without_reading_capabilities(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    _write_json(root / "system" / "capabilities.json", {"schema_version": 1})

    result = inspect_system(root)

    assert result["status"] == "blocked"
    assert result["capabilities"] == []
    assert {issue["code"] for issue in result["blockers"]} == {
        "GODIESEL_MANIFEST_INVALID"
    }


def test_schema_invalid_manifest_returns_the_stable_manifest_blocker(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    manifest_path = root / "system" / "capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["capabilities"][0]["authority"]["inspect"] = "invented-authority"
    manifest["capabilities"][0]["unexpected"] = True
    _write_json(manifest_path, manifest)

    result = inspect_system(root)

    assert result["status"] == "blocked"
    assert result["capabilities"] == []
    assert {issue["code"] for issue in result["blockers"]} == {
        "GODIESEL_MANIFEST_INVALID"
    }


def test_missing_manifest_schema_returns_a_stable_blocker(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    (root / "system" / "capabilities.schema.json").unlink()

    result = inspect_system(root)

    assert result["status"] == "blocked"
    assert result["capabilities"] == []
    assert {issue["code"] for issue in result["blockers"]} == {
        "GODIESEL_MANIFEST_SCHEMA_MISSING"
    }


def test_doctor_rejects_missing_pytest_and_route_subcommand_targets(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    manifest_path = root / "system" / "capabilities.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    capability = manifest["capabilities"][0]
    capability["commands"]["inspect"] = [
        {"command": "./scripts/route.sh missing-command", "cwd": "."}
    ]
    capability["verification"]["focused"] = [
        {"command": "python -m pytest -q missing_test.py", "cwd": "."}
    ]
    route_script = root / "scripts" / "route.sh"
    route_script.parent.mkdir(parents=True)
    route_script.write_text(
        "#!/bin/sh\ncase \"${1:-}\" in\n  status) exit 0 ;;\nesac\n",
        encoding="utf-8",
    )
    _write_json(manifest_path, manifest)

    result = doctor_system(root)

    command_issues = [
        issue
        for issue in result["blockers"]
        if issue["code"] == "GODIESEL_COMMAND_REFERENCE_INVALID"
    ]
    assert len(command_issues) == 2


def test_inspect_redacts_both_paths_in_a_private_source_rename(tmp_path):
    root = _make_repository_fixture(tmp_path / "repository")
    original = root / "route_sources" / "original.gpx"
    original.parent.mkdir(parents=True)
    original.write_text("private\n", encoding="utf-8")
    subprocess.run(["git", "add", str(original)], cwd=root, check=True)
    subprocess.run(["git", "commit", "-qm", "add private source"], cwd=root, check=True)
    renamed = original.with_name('renamed "private id".gpx')
    subprocess.run(["git", "mv", str(original), str(renamed)], cwd=root, check=True)

    result = inspect_system(root)

    serialized = json.dumps(result)
    assert "original.gpx" not in serialized
    assert "private id" not in serialized
    assert result["repository"]["worktree"]["changed_paths"] == [
        "route_sources/<redacted>"
    ]
