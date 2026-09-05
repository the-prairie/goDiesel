"""Independent adapter contract probes. The fake child is not product evidence."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest

import godiesel_app_walk as walk


def args(*extra):
    value = walk.parser().parse_args(["verify", "app-walk", "--target", "http://127.0.0.1:8792/", *extra])
    value.target = walk.normalize_target(value.target, value.profile)
    return value


@pytest.fixture
def repository(tmp_path):
    (tmp_path / "system").mkdir()
    # The helper checks schema presence. Full schema validation belongs to repository CI.
    schema = Path(__file__).parent / "system/evidence-receipt.schema.json"
    (tmp_path / "system/evidence-receipt.schema.json").write_text(schema.read_text() if schema.exists() else '{"type":"object"}')
    (tmp_path / "app/walks").mkdir(parents=True)
    (tmp_path / "app/walks/run.mjs").write_text("// runner input\n")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    return tmp_path


def child_factory(status="passed", mutate=None):
    def child(command, root, timeout):
        run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-") + uuid.uuid4().hex[:8]
        directory = root / ".godiesel/walks" / run_id
        directory.mkdir(parents=True)
        now = walk.timestamp()
        report = {"schema_version": 1, "document_type": "godiesel-app-walk", "id": run_id,
                  "status": status, "profile": "controlled", "target": "http://127.0.0.1:8792", "mission": "memory", "driver": "guided",
                  "started_at": now, "finished_at": now,
                  "checks": [{"id": "mission", "status": status}], "findings": [],
                  "actions": [{"step": 1}], "checkpoints": [{"image": "frame-001.png"}]}
        payload = {"status": status, "id": run_id, "report": str(directory.relative_to(root) / "report.json"), "html": str(directory.relative_to(root) / "index.html")}
        (directory / "frame-001.png").write_bytes(b"fixture-not-a-real-screenshot")
        (directory / "index.html").write_text("<p>adapter fixture</p>")
        code = walk.STATUS_EXIT[status]
        if mutate: mutate(report, payload, directory, root)
        (directory / "report.json").write_text(json.dumps(report))
        return subprocess.CompletedProcess(command, code, json.dumps(payload), "private error never forwarded")
    return child


@pytest.mark.parametrize("status", ["passed", "failed", "blocked"])
def test_adapter_preserves_observed_status_in_general_receipt(repository, status):
    result = walk.verify(repository, args(), runner=child_factory(status))
    assert result["exit_code"] == walk.STATUS_EXIT[status]
    assert result["result"]["status"] == status
    assert result["status"] == ("passed" if status == "passed" else "blocked")
    evidence = json.loads((repository / result["evidence"]["path"]).read_text())
    assert evidence["status"] == status
    assert evidence["capability"] == "app-walk"
    assert evidence["gates"][0]["status"] == status
    assert evidence["artifacts"][0]["kind"] == "app-walk-report"
    assert evidence["external_target"]["name_sha256"] == walk.digest("http://127.0.0.1:8792")
    assert "private error" not in json.dumps(result)


@pytest.mark.parametrize("mutation", [
    lambda r,p,d,root: r.update(target="https://evil.test"),
    lambda r,p,d,root: r.update(started_at="2000-01-01T00:00:00Z"),
    lambda r,p,d,root: r.update(finished_at="2999-01-01T00:00:00Z"),
    lambda r,p,d,root: r.update(driver="agent"),
    lambda r,p,d,root: r.update(checks=[{"id":"mission","status":"passed"},{"id":"provider","status":"failed"}]),
    lambda r,p,d,root: r.update(checks=[{"id":"mission","status":"banana"}]),
    lambda r,p,d,root: r.update(checks=[{"id":"mission","status":"passed"}]*2),
    lambda r,p,d,root: r.update(checkpoints=[]),
    lambda r,p,d,root: r.update(actions=[]),
    lambda r,p,d,root: p.update(report="../report.json"),
    lambda r,p,d,root: p.update(html="../index.html"),
    lambda r,p,d,root: r.update(checkpoints=[{"image":"../../secret.png"}]),
    lambda r,p,d,root: r.update(findings=[{"kind":"defect"}]),
])
def test_forged_or_inconsistent_success_is_blocked(repository, mutation):
    result = walk.verify(repository, args(), runner=child_factory(mutate=mutation))
    assert result["exit_code"] == 2
    assert result["result"]["status"] == "blocked"
    assert result["blockers"][0]["code"].endswith("INCOMPLETE_RESULT")


def test_reuse_never_invokes_child_or_creates_evidence(repository):
    def forbidden(*unused): raise AssertionError("must not run")
    result = walk.verify(repository, args("--reuse"), runner=forbidden)
    assert result["exit_code"] == 2
    assert not (repository / ".godiesel").exists()


def test_input_change_during_walk_invalidates_green_report(repository):
    result = walk.verify(repository, args(), runner=child_factory(mutate=lambda r,p,d,root: (root / "app/walks/run.mjs").write_text("changed")))
    assert result["exit_code"] == 2
    assert result["result"]["status"] == "blocked"
    assert result["result"]["observation_status"] == "passed"
    assert result["blockers"][0]["code"].endswith("INPUTS_CHANGED")


def test_ignored_evidence_link_cannot_escape_root(repository, tmp_path):
    outside = tmp_path / "outside"; outside.mkdir()
    (repository / ".godiesel").symlink_to(outside, target_is_directory=True)
    result = walk.verify(repository, args(), runner=lambda *unused: pytest.fail("must not run"))
    assert result["exit_code"] == 2
    assert not list(outside.iterdir())


def test_missing_schema_cannot_claim_a_valid_receipt(repository):
    (repository / "system/evidence-receipt.schema.json").unlink()
    result = walk.verify(repository, args(), runner=child_factory())
    assert result["exit_code"] == 2
    assert result["result"]["status"] == "blocked"


def test_fingerprints_cover_absence_content_and_mode(repository):
    before = walk.fingerprint(repository)
    file = repository / "app/walks/run.mjs"
    file.chmod(0o755)
    assert before != walk.fingerprint(repository)
    file.unlink()
    assert before != walk.fingerprint(repository)


@pytest.mark.parametrize("target", ["https://evil.test/", "https://godiesel.pages.dev.evil.test/", "https://u:p@godiesel.pages.dev/", "https://godiesel.pages.dev/?token=x", "https://godiesel.pages.dev/#/admin", "http://godiesel.pages.dev/"])
def test_live_target_restrictions_match_browser_contract(target):
    with pytest.raises(ValueError): walk.normalize_target(target, "live")


def test_shell_dispatch_preserves_other_capabilities(tmp_path):
    (tmp_path / "scripts").mkdir()
    script = tmp_path / "scripts/godiesel"
    shutil.copyfile(Path(__file__).parent / "scripts/godiesel", script); script.chmod(0o755)
    for name in ["godiesel_control.py", "godiesel_app_walk.py"]:
        (tmp_path / name).write_text("import sys,json; print(json.dumps([__file__.split('/')[-1],sys.argv[1:]]));sys.exit(7)")
    for argv, expected in [(["inspect","system","--json"],"godiesel_control.py"),(["inspect","app-walk","--json"],"godiesel_app_walk.py")]:
        result = subprocess.run([str(script),*argv], capture_output=True, text=True)
        assert result.returncode == 7
        assert json.loads(result.stdout) == [expected, argv]
