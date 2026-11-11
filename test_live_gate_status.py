"""The live gate records whether its evidence is a pass.

scripts/verify-live-pipeline.sh cannot run here: it needs providers,
credentials, and the private Strava export. These tests run the real script
with every command it calls stubbed, so they exercise only its status
protocol: status.json is `running` from the start, advances per step, becomes
`passed` only at the very end, and the trap writes `failed` or `interrupted`.
"""

import json
import os
import shutil
import signal
import stat
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).parent
STEPS = [
    "1/8 source census and rebuild",
    "2/8 deterministic release gate",
    "3/8 live route matrix",
    "4/8 Earth Engine route intelligence",
    "5/8 credentialed preview",
    "6/8 hardware-backed journeys",
    "7/8 route-only Pages publish",
    "8/8 complete",
]


def executable(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class LiveGateHarness:
    def __init__(self, tmp_path: Path):
        self.root = tmp_path / "checkout"
        scripts = self.root / "scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(ROOT / "scripts" / "verify-live-pipeline.sh", scripts / "verify-live-pipeline.sh")
        reader = ROOT / "scripts" / "live-gate-status.sh"
        if reader.exists():
            shutil.copy2(reader, scripts / "live-gate-status.sh")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid",
             "commit", "-q", "--allow-empty", "-m", "fixture"],
            cwd=self.root, check=True,
        )
        self.calls = tmp_path / "calls.log"
        self.hung = tmp_path / "hung"
        # Every stub records its call, fails when STUB_FAIL matches, and hangs
        # when STUB_HANG matches, so a test can interrupt a known step.
        stub = f"""#!/bin/bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> {self.calls}
if [[ -n "${{STUB_HANG:-}}" && "$(basename "$0") $*" == *"$STUB_HANG"* ]]; then
  touch {self.hung}
  sleep 30
fi
if [[ -n "${{STUB_FAIL:-}}" && "$(basename "$0") $*" == *"$STUB_FAIL"* ]]; then
  exit 7
fi
exit 0
"""
        executable(self.root / ".venv" / "bin" / "python", stub)
        executable(scripts / "publish-route-microsite.sh", stub)
        executable(self.root / "app" / "node_modules" / ".bin" / "vite", "#!/bin/bash\nexec sleep 30\n")
        bin_dir = tmp_path / "bin"
        for name in ("npm", "npx", "curl"):
            executable(bin_dir / name, stub)
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{bin_dir}:{self.environment['PATH']}"
        self.environment["GODIESEL_EARTH_ENGINE_PROJECT"] = "playground-406023"
        self.environment["GODIESEL_PIPELINE_SHARE_NAME"] = "pipeline-proof"

    def command(self):
        return [str(self.root / "scripts" / "verify-live-pipeline.sh")]

    def run(self, **extra: str):
        return subprocess.run(
            self.command(), cwd=self.root, env=dict(self.environment, **extra),
            capture_output=True, text=True, check=False,
        )

    def evidence_dirs(self) -> list[Path]:
        return sorted((self.root / "app" / "artifacts" / "live-pipeline").iterdir())

    def status(self) -> dict:
        (directory,) = self.evidence_dirs()
        return json.loads((directory / "status.json").read_text(encoding="utf-8"))

    def read_status(self, target: str):
        return subprocess.run(
            [str(self.root / "scripts" / "live-gate-status.sh"), target],
            cwd=self.root, capture_output=True, text=True, check=False,
        )


def test_a_complete_run_is_the_only_way_to_passed(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)

    result = harness.run()

    assert result.returncode == 0, result.stderr
    status = harness.status()
    assert status["gate"] == "verify-live-pipeline"
    assert status["state"] == "passed"
    assert status["steps"] == STEPS
    assert status["completed_steps"] == STEPS
    assert status["current_step"] is None
    assert status["exit_code"] == 0
    assert status["started_at"].endswith("Z")
    (directory,) = harness.evidence_dirs()
    assert harness.read_status(str(directory)).returncode == 0
    latest = harness.read_status("latest")
    assert latest.returncode == 0
    assert "passed" in latest.stdout


def test_a_failed_step_is_recorded_as_failed_with_its_exit_code(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)

    result = harness.run(STUB_FAIL="npm --prefix app run verify")

    assert result.returncode == 7
    status = harness.status()
    assert status["state"] == "failed"
    assert status["current_step"] == "2/8 deterministic release gate"
    assert status["completed_steps"] == STEPS[:1]
    assert status["exit_code"] == 7
    assert status["signal"] is None
    reader = harness.read_status("latest")
    assert reader.returncode != 0
    assert "failed" in reader.stdout
    assert "2/8 deterministic release gate" in reader.stdout


def interrupt_during(harness: LiveGateHarness, hang: str, signal_number: int):
    process = subprocess.Popen(
        harness.command(), cwd=harness.root, env=dict(harness.environment, STUB_HANG=hang),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    deadline = time.monotonic() + 15
    while not harness.hung.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert harness.hung.exists()
    running = harness.status()
    os.killpg(process.pid, signal_number)
    process.wait(timeout=15)
    return process, running


def test_an_interrupted_run_is_recorded_as_interrupted(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)

    process, running = interrupt_during(harness, "playwright test", signal.SIGINT)

    assert running["state"] == "running"
    assert running["current_step"] == "6/8 hardware-backed journeys"
    assert process.returncode != 0
    status = harness.status()
    assert status["state"] == "interrupted"
    assert status["signal"] == "INT"
    assert status["current_step"] == "6/8 hardware-backed journeys"
    assert status["completed_steps"] == STEPS[:5]
    reader = harness.read_status("latest")
    assert reader.returncode != 0
    assert "interrupted" in reader.stdout


def test_a_terminated_run_is_recorded_as_interrupted(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)

    process, _ = interrupt_during(harness, "test:e2e:live-pipeline", signal.SIGTERM)

    assert process.returncode != 0
    status = harness.status()
    assert status["state"] == "interrupted"
    assert status["signal"] == "TERM"
    assert status["current_step"] == "3/8 live route matrix"


def test_a_running_gate_is_not_a_pass(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)
    process = subprocess.Popen(
        harness.command(), cwd=harness.root,
        env=dict(harness.environment, STUB_HANG="--live-nominatim"),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 15
        while not harness.hung.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        reader = harness.read_status("latest")
        assert reader.returncode != 0
        assert "running" in reader.stdout
    finally:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=15)


def test_evidence_without_a_status_is_blocked(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)
    evidence = harness.root / "app" / "artifacts" / "live-pipeline"
    (evidence / "20260101T000000Z").mkdir(parents=True)
    (evidence / "20260101T000000Z" / "source-to-product.json").write_text("{}", encoding="utf-8")

    reader = harness.read_status("latest")

    assert reader.returncode != 0
    assert "blocked" in reader.stdout
    assert "no status.json" in reader.stdout


def test_latest_is_the_newest_evidence_directory(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)
    assert harness.run().returncode == 0
    (passed,) = harness.evidence_dirs()
    older = passed.parent / "20000101T000000Z"
    older.mkdir()

    assert harness.read_status("latest").returncode == 0
    assert harness.read_status(str(older)).returncode != 0


def test_no_evidence_at_all_is_blocked(tmp_path: Path):
    harness = LiveGateHarness(tmp_path)

    reader = harness.read_status("latest")

    assert reader.returncode != 0
    assert "blocked" in reader.stdout
