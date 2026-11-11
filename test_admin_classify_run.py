import importlib.util
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent


def load_admin(tmp_path, monkeypatch):
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    (inputs / "activities.csv").write_text("Activity Date,Filename,Distance\n")
    (tmp_path / "quests.json").write_text('{"routes": []}\n')
    (tmp_path / ".geo_cache.json").write_text("{}\n")
    monkeypatch.setenv("GODIESEL_CHECKOUT_ROOT", str(tmp_path))
    monkeypatch.setenv("GODIESEL_DIESEL_DIARIES_ROOT", str(inputs))
    monkeypatch.setenv("GODIESEL_TRAVEL_ROOT", str(inputs))
    spec = importlib.util.spec_from_file_location(
        f"admin_classify_run_{tmp_path.name}", ROOT / "admin.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_one_classifier_starts_when_many_callers_race(tmp_path, monkeypatch):
    admin = load_admin(tmp_path, monkeypatch)
    entered = threading.Event()
    workers = []

    def stub(candidates):
        workers.append(list(candidates))
        entered.set()

    admin.classify_unmapped_worker = stub
    admin._unmapped_route_ids = lambda: [("route-1", 35.0, 135.0)]
    admin._classify_state = {"phase": "idle"}
    gate = threading.Barrier(32)
    outcomes = []
    lock = threading.Lock()

    def call():
        gate.wait()
        outcome = admin.start_classify_if_needed()
        with lock:
            outcomes.append(outcome)

    threads = [threading.Thread(target=call) for _ in range(32)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert outcomes.count("started") == 1
    assert outcomes.count("running") == 31
    assert entered.wait(2)
    assert workers == [[("route-1", 35.0, 135.0)]]


def test_a_worker_crash_ends_the_run_and_allows_another_start(tmp_path, monkeypatch):
    admin = load_admin(tmp_path, monkeypatch)
    admin._classify_state = admin.reduce_classify(
        admin.initial_classify_state(), {"type": "start", "total": 1}
    )

    def explode(lat, lng):
        raise RuntimeError("geocode failed")

    admin.cached_reverse_geocode = explode
    with pytest.raises(RuntimeError, match="geocode failed"):
        admin.classify_unmapped_worker([("route-1", 35.0, 135.0)])
    assert admin._classify_state["phase"] == "failed"
    snapshot = admin._classify_snapshot()
    assert set(snapshot) == {
        "running",
        "done",
        "total",
        "updated",
        "last_label",
        "finished_at",
    }
    assert snapshot["running"] is False
    assert snapshot["finished_at"] is None
    admin.classify_unmapped_worker = lambda candidates: None
    admin._unmapped_route_ids = lambda: [("route-1", 35.0, 135.0)]
    assert admin.start_classify_if_needed() == "started"
