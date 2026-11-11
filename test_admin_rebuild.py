import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from test_admin_classify_run import load_admin

BUSY = "another owner mutation is in progress"


@pytest.fixture
def admin(tmp_path, monkeypatch):
    yield load_admin(tmp_path, monkeypatch)
    # Open the gate of any slow stub build a failed assertion left waiting.
    (tmp_path / "release-build").write_text("")


@pytest.fixture
def served(admin):
    server = ThreadingHTTPServer(("127.0.0.1", 0), admin.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def request(url, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


# ── Characterization: what the status endpoint and busy responses already say ──


def test_status_keeps_its_existing_fields(admin, served):
    status, body = request(f"{served}/api/admin/status")
    assert status == 200
    assert body["writer_available"] is True
    assert body["mode"] == "local-owner"
    assert body["generation_status"] == "missing"
    assert body["generated_at"] is None


def test_status_reports_ready_generation_from_the_manifest(admin, served):
    manifest = admin.QUESTS / "app" / "src" / "data" / "generated" / "routes.manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text('{"routes": []}')
    status, body = request(f"{served}/api/admin/status")
    assert status == 200
    assert body["generation_status"] == "ready"
    assert isinstance(body["generated_at"], str)


@pytest.mark.parametrize(
    "path, payload",
    [
        ("/api/save", {"routes": []}),
        ("/api/curation/save", {"activity_id": "1", "curation": {}}),
        ("/api/annotations/save", {"activity_id": "1", "annotations": []}),
        ("/api/rebuild", {}),
    ],
)
def test_a_held_mutation_lock_refuses_with_409_and_the_existing_error(
    admin, served, path, payload
):
    assert admin.OWNER_MUTATION_LOCK.acquire(blocking=False)
    try:
        status, body = request(f"{served}{path}", "POST", payload)
    finally:
        admin.OWNER_MUTATION_LOCK.release()
    assert status == 409
    assert body["error"] == BUSY


# ── Pure rebuild lifecycle ──

from admin_rebuild import (  # noqa: E402
    STDERR_TAIL_BYTES,
    initial_rebuild_state,
    public_rebuild_state,
    reduce_rebuild,
    stderr_tail,
)

SNAPSHOT_KEYS = {"phase", "id", "started_at", "finished_at", "exit_code", "stderr_tail"}


def test_rebuild_starts_idle_and_ignores_outcomes_without_a_run():
    idle = initial_rebuild_state()
    assert public_rebuild_state(idle) == {
        "phase": "idle",
        "id": None,
        "started_at": None,
        "finished_at": None,
        "exit_code": None,
        "stderr_tail": None,
    }
    assert reduce_rebuild(idle, {"type": "succeed", "id": "a", "finished_at": 1}) is idle
    assert reduce_rebuild(idle, {"type": "fail", "id": "a", "finished_at": 1, "exit_code": 2, "stderr_tail": ""}) is idle
    assert reduce_rebuild(idle, {"type": "start", "id": "", "started_at": 1}) is idle
    assert reduce_rebuild(idle, {"type": "unknown"}) is idle


def test_a_second_start_while_running_returns_the_same_state():
    running = reduce_rebuild(initial_rebuild_state(), {"type": "start", "id": "a", "started_at": 5})
    assert running == {"phase": "running", "id": "a", "started_at": 5}
    assert reduce_rebuild(running, {"type": "start", "id": "b", "started_at": 6}) is running
    assert public_rebuild_state(running) == {
        "phase": "running",
        "id": "a",
        "started_at": 5,
        "finished_at": None,
        "exit_code": None,
        "stderr_tail": None,
    }


def test_only_the_running_rebuild_can_settle_it():
    running = reduce_rebuild(initial_rebuild_state(), {"type": "start", "id": "a", "started_at": 5})
    assert reduce_rebuild(running, {"type": "succeed", "id": "stale", "finished_at": 9}) is running
    succeeded = reduce_rebuild(running, {"type": "succeed", "id": "a", "finished_at": 9})
    assert succeeded == {"phase": "succeeded", "id": "a", "finished_at": 9}
    assert reduce_rebuild(succeeded, {"type": "fail", "id": "a", "finished_at": 10, "exit_code": 1, "stderr_tail": "x"}) is succeeded
    assert public_rebuild_state(succeeded)["phase"] == "succeeded"
    assert set(public_rebuild_state(succeeded)) == SNAPSHOT_KEYS


def test_a_failed_rebuild_keeps_its_exit_code_and_stderr_tail_and_can_restart():
    running = reduce_rebuild(initial_rebuild_state(), {"type": "start", "id": "a", "started_at": 5})
    failed = reduce_rebuild(
        running,
        {"type": "fail", "id": "a", "finished_at": 9, "exit_code": 3, "stderr_tail": "Traceback"},
    )
    assert failed == {
        "phase": "failed",
        "id": "a",
        "finished_at": 9,
        "exit_code": 3,
        "stderr_tail": "Traceback",
    }
    assert public_rebuild_state(failed) == {
        "phase": "failed",
        "id": "a",
        "started_at": None,
        "finished_at": 9,
        "exit_code": 3,
        "stderr_tail": "Traceback",
    }
    restarted = reduce_rebuild(failed, {"type": "start", "id": "b", "started_at": 11})
    assert restarted["phase"] == "running" and restarted["id"] == "b"


def test_stderr_tail_keeps_only_the_last_bytes_as_text():
    assert stderr_tail(b"") == ""
    assert stderr_tail(b"short\n") == "short\n"
    long = b"a" * 5000 + b"END"
    tail = stderr_tail(long)
    assert tail.endswith("END")
    assert len(tail.encode()) == STDERR_TAIL_BYTES
    assert stderr_tail("é".encode() * 2000)  # a split code point does not raise


# ── Adapter: admin.py drives the lifecycle and owns the lock ──

# Waits for the test to open its gate, and never outlives a forgotten one.
SLOW_BUILD = """
import sys, time, pathlib
gate = pathlib.Path(__file__).with_name("release-build")
deadline = time.monotonic() + 20
while not gate.exists():
    if time.monotonic() > deadline or not gate.parent.exists():
        sys.exit(9)
    time.sleep(0.01)
sys.exit(0)
"""

FAILING_BUILD = """
import sys
sys.stdout.write("progress line\\n" * 20000)
sys.stderr.write("noise\\n" * 2000)
sys.stderr.write("Traceback: the real reason\\n")
sys.exit(3)
"""


def wait_for_phase(admin, phase, timeout=10):
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = admin._rebuild_snapshot()
        if snapshot["phase"] == phase:
            return snapshot
        time.sleep(0.01)
    raise AssertionError(f"rebuild never reached {phase}: {admin._rebuild_snapshot()}")


def lock_is_free(admin):
    if admin.OWNER_MUTATION_LOCK.acquire(blocking=False):
        admin.OWNER_MUTATION_LOCK.release()
        return True
    return False


def test_concurrent_rebuild_requests_start_exactly_one_build(admin):
    (admin.QUESTS / "build.py").write_text(SLOW_BUILD)
    gate = threading.Barrier(16)
    outcomes = []
    guard = threading.Lock()

    def call():
        gate.wait()
        outcome = admin.start_rebuild()
        with guard:
            outcomes.append(outcome)

    threads = [threading.Thread(target=call) for _ in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    statuses = sorted(status for status, _ in outcomes)
    assert statuses == [200] + [409] * 15
    running = admin._rebuild_snapshot()
    assert running["phase"] == "running"
    for status, body in outcomes:
        if status == 200:
            assert body["ok"] is True
            assert body["msg"] == "Rebuild started in background."
            assert body["rebuild"]["id"] == running["id"]
        else:
            assert body["error"] == BUSY
            assert running["id"] in body["reason"]
            assert "rebuild" in body["reason"]
    (admin.QUESTS / "release-build").write_text("")
    succeeded = wait_for_phase(admin, "succeeded")
    assert succeeded["id"] == running["id"]
    assert succeeded["exit_code"] is None
    assert lock_is_free(admin)


def test_a_save_during_a_rebuild_names_the_rebuild(admin, served):
    (admin.QUESTS / "build.py").write_text(SLOW_BUILD)
    status, body = request(f"{served}/api/rebuild", "POST", {})
    assert status == 200
    rebuild_id = body["rebuild"]["id"]
    try:
        status, body = request(f"{served}/api/save", "POST", {"routes": []})
        assert status == 409
        assert body["error"] == BUSY
        assert body["reason"] == (
            f"rebuild {rebuild_id} is running; saves and rebuilds are refused until it finishes"
        )
        status, body = request(f"{served}/api/admin/status")
        assert body["rebuild"]["phase"] == "running"
        assert body["rebuild"]["id"] == rebuild_id
    finally:
        (admin.QUESTS / "release-build").write_text("")
    wait_for_phase(admin, "succeeded")
    status, body = request(f"{served}/api/save", "POST", {"routes": []})
    assert (status, body) == (200, {"ok": True, "updated": 0})


def test_a_lock_held_by_something_else_adds_no_rebuild_reason(admin, served):
    assert admin.OWNER_MUTATION_LOCK.acquire(blocking=False)
    try:
        status, body = request(f"{served}/api/save", "POST", {"routes": []})
    finally:
        admin.OWNER_MUTATION_LOCK.release()
    assert (status, body) == (409, {"error": BUSY})


def test_a_failing_build_records_exit_code_and_stderr_tail_and_frees_the_lock(admin, served):
    (admin.QUESTS / "build.py").write_text(FAILING_BUILD)
    status, _ = request(f"{served}/api/rebuild", "POST", {})
    assert status == 200
    failed = wait_for_phase(admin, "failed")
    assert failed["exit_code"] == 3
    assert failed["stderr_tail"].endswith("Traceback: the real reason\n")
    assert len(failed["stderr_tail"].encode()) <= STDERR_TAIL_BYTES
    assert "progress line" not in failed["stderr_tail"]
    assert isinstance(failed["finished_at"], float)
    assert lock_is_free(admin)
    status, body = request(f"{served}/api/admin/status")
    assert body["rebuild"] == failed


def test_a_rebuild_thread_that_cannot_start_fails_and_frees_the_lock(admin, monkeypatch):
    class NoThreads:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            raise RuntimeError("can't start new thread")

    monkeypatch.setattr(admin.threading, "Thread", NoThreads)
    status, body = admin.start_rebuild()
    monkeypatch.undo()
    assert status == 500
    assert body["error"] == "Rebuild could not start."
    snapshot = admin._rebuild_snapshot()
    assert snapshot["phase"] == "failed"
    assert snapshot["exit_code"] is None
    assert "can't start new thread" in snapshot["stderr_tail"]
    assert lock_is_free(admin)


def test_a_build_that_cannot_be_launched_fails_and_frees_the_lock(admin, monkeypatch):
    def refuse(*args, **kwargs):
        raise OSError("no interpreter")

    monkeypatch.setattr(admin, "_run_build", refuse)
    status, _ = admin.start_rebuild()
    assert status == 200
    failed = wait_for_phase(admin, "failed")
    assert failed["exit_code"] is None
    assert "no interpreter" in failed["stderr_tail"]
    assert lock_is_free(admin)


# ── Status names the serving checkout and process ──


def test_status_names_the_serving_checkout_and_process(admin, served):
    import os

    status, body = request(f"{served}/api/admin/status")
    assert status == 200
    assert body["checkout_root"] == str(admin.QUESTS)
    assert os.path.isabs(body["checkout_root"])
    assert body["pid"] == os.getpid()
    assert set(body) == {
        "writer_available",
        "mode",
        "generation_status",
        "generated_at",
        "rebuild",
        "checkout_root",
        "pid",
    }


# build.py lets GeneratorPublicationActive escape when another run holds the
# generator lock, so Python prints the traceback to stderr and exits 1.
LOCKED_BUILD = """
class GeneratorPublicationActive(RuntimeError):
    pass

raise GeneratorPublicationActive(
    "another generator run is publishing /checkout/app/public/data; "
    "this run stopped without touching its backup"
)
"""


def test_a_build_refused_by_the_generator_lock_reports_why(admin, served):
    (admin.QUESTS / "build.py").write_text(LOCKED_BUILD)
    status, _ = request(f"{served}/api/rebuild", "POST", {})
    assert status == 200
    failed = wait_for_phase(admin, "failed")
    assert failed["exit_code"] == 1
    assert "another generator run is publishing" in failed["stderr_tail"]
    assert lock_is_free(admin)
    status, body = request(f"{served}/api/admin/status")
    assert body["rebuild"]["phase"] == "failed"
    assert "another generator run is publishing" in body["rebuild"]["stderr_tail"]
