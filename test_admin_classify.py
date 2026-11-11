from admin_classify import initial_classify_state, public_classify_state, reduce_classify


def test_classify_starts_idle_and_ignores_work_before_a_run():
    idle = initial_classify_state()
    assert public_classify_state(idle) == {
        "phase": "idle",
        "running": False,
        "done": 0,
        "total": 0,
        "updated": 0,
        "last_label": "",
        "finished_at": None,
    }
    assert reduce_classify(idle, {"type": "progress", "done": 1, "label": "Kyoto"}) is idle
    assert reduce_classify(idle, {"type": "finish", "finished_at": 1}) is idle
    assert reduce_classify(idle, {"type": "start", "total": 0}) is idle


def test_classify_run_cannot_finish_while_it_is_running_or_skip_ahead():
    running = reduce_classify(initial_classify_state(), {"type": "start", "total": 2})
    assert public_classify_state(running)["running"] is True
    assert public_classify_state(running)["finished_at"] is None
    assert reduce_classify(running, {"type": "start", "total": 9}) is running
    assert reduce_classify(running, {"type": "progress", "done": 2, "label": "Osaka"}) is running

    labeled = reduce_classify(running, {"type": "progress", "done": 1, "label": "Kyoto"})
    blank = reduce_classify(labeled, {"type": "progress", "done": 2, "label": ""})
    assert public_classify_state(blank) == {
        "phase": "running",
        "running": True,
        "done": 2,
        "total": 2,
        "updated": 1,
        "last_label": "Kyoto",
        "finished_at": None,
    }
    assert reduce_classify(blank, {"type": "progress", "done": 3, "label": "Extra"}) is blank

    finished = reduce_classify(blank, {"type": "finish", "finished_at": 10})
    assert public_classify_state(finished)["running"] is False
    assert public_classify_state(finished)["finished_at"] == 10
    assert reduce_classify(finished, {"type": "progress", "done": 3, "label": "Late"}) is finished


def test_a_crashed_classify_run_stops_and_can_start_again():
    running = reduce_classify(initial_classify_state(), {"type": "start", "total": 2})
    partial = reduce_classify(running, {"type": "progress", "done": 1, "label": "Kyoto"})
    failed = reduce_classify(partial, {"type": "fail"})
    assert failed["phase"] == "failed"
    assert "finished_at" not in failed
    assert public_classify_state(failed) == {
        "phase": "failed",
        "running": False,
        "done": 1,
        "total": 2,
        "updated": 1,
        "last_label": "Kyoto",
        "finished_at": None,
    }
    idle = initial_classify_state()
    assert reduce_classify(idle, {"type": "fail"}) is idle
    restarted = reduce_classify(failed, {"type": "start", "total": 1})
    assert public_classify_state(restarted)["running"] is True
    assert public_classify_state(restarted)["done"] == 0


def test_a_finished_classify_run_can_start_again():
    finished = reduce_classify(
        reduce_classify(initial_classify_state(), {"type": "start", "total": 1}),
        {"type": "finish", "finished_at": 4},
    )
    restarted = reduce_classify(finished, {"type": "start", "total": 3})
    assert public_classify_state(restarted) == {
        "phase": "running",
        "running": True,
        "done": 0,
        "total": 3,
        "updated": 0,
        "last_label": "",
        "finished_at": None,
    }


LEGACY_KEYS = {"running", "done", "total", "updated", "last_label", "finished_at"}


def test_snapshot_names_each_phase_without_changing_the_legacy_keys():
    idle = initial_classify_state()
    running = reduce_classify(idle, {"type": "start", "total": 2})
    partial = reduce_classify(running, {"type": "progress", "done": 1, "label": "Kyoto"})
    finished = reduce_classify(partial, {"type": "finish", "finished_at": 7})
    failed = reduce_classify(partial, {"type": "fail"})
    expected = {
        "idle": (idle, {"running": False, "done": 0, "total": 0, "updated": 0, "last_label": "", "finished_at": None}),
        "running": (partial, {"running": True, "done": 1, "total": 2, "updated": 1, "last_label": "Kyoto", "finished_at": None}),
        "finished": (finished, {"running": False, "done": 1, "total": 2, "updated": 1, "last_label": "Kyoto", "finished_at": 7}),
        "failed": (failed, {"running": False, "done": 1, "total": 2, "updated": 1, "last_label": "Kyoto", "finished_at": None}),
    }
    for phase, (state, legacy) in expected.items():
        snapshot = public_classify_state(state)
        assert snapshot["phase"] == phase
        assert {key: snapshot[key] for key in LEGACY_KEYS} == legacy
        assert set(snapshot) == LEGACY_KEYS | {"phase"}
