from admin_classify import initial_classify_state, public_classify_state, reduce_classify


def test_classify_starts_idle_and_ignores_work_before_a_run():
    idle = initial_classify_state()
    assert public_classify_state(idle) == {
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


def test_a_finished_classify_run_can_start_again():
    finished = reduce_classify(
        reduce_classify(initial_classify_state(), {"type": "start", "total": 1}),
        {"type": "finish", "finished_at": 4},
    )
    restarted = reduce_classify(finished, {"type": "start", "total": 3})
    assert public_classify_state(restarted) == {
        "running": True,
        "done": 0,
        "total": 3,
        "updated": 0,
        "last_label": "",
        "finished_at": None,
    }
