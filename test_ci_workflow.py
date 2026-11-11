"""Keep the CI workflow honest about what it runs and what it may touch."""

import configparser
import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).parent
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "verify.yml"
PRIVATE_EXPORT_MARKER = "requires_private_export"
SUITE_COMMAND = (
    "python -m pytest -q --ignore=tmp -p no:cacheprovider -rs "
    f'-m "not {PRIVATE_EXPORT_MARKER}"'
)

# Installation steps. They are not gates, so they are listed exactly.
SETUP_COMMANDS = {
    "python -m pip install --upgrade pip",
    "python -m pip install -r requirements.txt",
    "npm --prefix app ci",
    "npx playwright install --with-deps chromium",
    "sudo apt-get update",
    "sudo apt-get install -y --no-install-recommends ffmpeg",
}
NPM_SCRIPT = re.compile(r"^npm (?:--prefix app )?run (?P<script>[\w:-]+)(?: -- .*)?$")


@pytest.fixture(scope="module")
def raw_workflow():
    return WORKFLOW_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def workflow(raw_workflow):
    return yaml.safe_load(raw_workflow)


def _triggers(workflow):
    # YAML 1.1 reads a bare `on` key as the boolean True.
    return workflow.get("on", workflow.get(True))


def _steps(workflow):
    for job_name, job in workflow["jobs"].items():
        for step in job["steps"]:
            yield job_name, step


def _commands(workflow):
    """Every non-empty shell line of every `run:` block, with its step."""
    for job_name, step in _steps(workflow):
        for line in step.get("run", "").splitlines():
            if line.strip():
                yield job_name, step, line.strip()


def _npm_scripts():
    package = json.loads((ROOT / "app" / "package.json").read_text(encoding="utf-8"))
    return set(package["scripts"])


def test_triggers_are_pull_requests_and_pushes_to_main(workflow):
    triggers = _triggers(workflow)

    assert set(triggers) == {"pull_request", "push"}
    assert triggers["push"] == {"branches": ["main"]}


def test_permissions_are_read_only_everywhere(workflow):
    assert workflow["permissions"] == {"contents": "read"}
    for job in workflow["jobs"].values():
        assert job.get("permissions", {"contents": "read"}) == {"contents": "read"}


def test_superseded_runs_on_the_same_ref_are_cancelled(workflow):
    concurrency = workflow["concurrency"]

    assert "github.ref" in concurrency["group"]
    assert "pull_request" in str(concurrency["cancel-in-progress"])


def test_every_job_has_a_timeout(workflow):
    for job in workflow["jobs"].values():
        assert 0 < job["timeout-minutes"] <= 60


def test_no_secrets_privileged_triggers_or_write_access(raw_workflow):
    lowered = raw_workflow.lower()

    for forbidden in (
        "secrets.",
        "pull_request_target",
        "github_token",
        "google_maps_api_key",
        "godiesel_require_provider_key",
        ": write",
    ):
        assert forbidden not in lowered, forbidden


def test_no_command_deploys_or_packages_a_deployment(workflow):
    for job_name, _, line in _commands(workflow):
        lowered = line.lower()
        for forbidden in ("wrangler", "deploy", "make-dist", "cloudflare", "pages "):
            assert forbidden not in lowered, f"{job_name}: {line}"


def test_checkouts_do_not_keep_credentials(workflow):
    checkouts = [
        step for _, step in _steps(workflow)
        if step.get("uses", "").startswith("actions/checkout@")
    ]
    assert checkouts
    assert all(step["with"]["persist-credentials"] is False for step in checkouts)


def test_only_official_actions_pinned_to_a_major_version(workflow):
    allowed = {
        "actions/checkout",
        "actions/setup-node",
        "actions/setup-python",
        "actions/upload-artifact",
        "actions/cache",
    }
    for _, step in _steps(workflow):
        if "uses" not in step:
            continue
        action, _, version = step["uses"].partition("@")
        assert action in allowed, step["uses"]
        assert re.fullmatch(r"v\d+", version), step["uses"]


def test_toolchain_versions_match_the_readme(workflow):
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    node_major = re.search(r"Node\.js (\d+) or newer", readme).group(1)
    python_version = re.search(r"Python (\d+\.\d+) or newer", readme).group(1)

    for _, step in _steps(workflow):
        uses = step.get("uses", "")
        if uses.startswith("actions/setup-node@"):
            assert str(step["with"]["node-version"]) == node_major
        if uses.startswith("actions/setup-python@"):
            assert str(step["with"]["python-version"]) == python_version


def test_every_command_is_an_existing_gate_a_setup_step_or_a_notice(workflow):
    scripts = _npm_scripts()
    seen_scripts = set()

    for job_name, step, line in _commands(workflow):
        if line in SETUP_COMMANDS or line.startswith(("echo ", "grep ")):
            continue
        if line.startswith("python -m pytest "):
            continue
        match = NPM_SCRIPT.match(line)
        assert match, f"{job_name}: unrecognised command {line!r}"
        script = match["script"]
        assert script in scripts, f"{job_name}: npm script {script!r} is not in app/package.json"
        if "--prefix app" not in line:
            assert step.get("working-directory") == "app", f"{job_name}: {line}"
        seen_scripts.add(script)

    assert {"typecheck", "test:unit", "build", "test:bundle", "test:e2e"} <= seen_scripts


def test_ci_deselects_exactly_the_registered_private_export_tests(workflow):
    parser = configparser.ConfigParser()
    parser.read(ROOT / "pytest.ini")
    assert PRIVATE_EXPORT_MARKER in parser["pytest"]["markers"]

    runs = [line for _, _, line in _commands(workflow) if line.startswith("python -m pytest")]
    assert [line for line in runs if "--collect-only" not in line] == [SUITE_COMMAND]
    assert any(
        "--collect-only" in line and f"-m {PRIVATE_EXPORT_MARKER}" in line for line in runs
    ), "CI must list the real-data tests it did not run"


def test_ci_publishes_a_visible_notice_for_everything_it_does_not_check(raw_workflow):
    assert raw_workflow.count("::warning title=") == 2
    assert raw_workflow.count('>> "$GITHUB_STEP_SUMMARY"') >= 2
    assert "requires_private_export were NOT run" in raw_workflow
    assert "Screenshot comparisons were NOT checked" in raw_workflow


def test_e2e_runs_without_traces_and_keeps_failure_evidence(workflow):
    e2e_lines = [line for _, _, line in _commands(workflow) if "test:e2e" in line]
    assert e2e_lines and all("--trace off" in line for line in e2e_lines)

    uploads = [
        step for _, step in _steps(workflow)
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    assert uploads
    for step in uploads:
        assert step["if"] == "failure()"
        assert "app/playwright-report" in step["with"]["path"]
        assert "app/test-results" in step["with"]["path"]
