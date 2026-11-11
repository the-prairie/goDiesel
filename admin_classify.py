from __future__ import annotations

from typing import Literal, TypedDict


class _Counts(TypedDict):
    done: int
    total: int
    updated: int
    last_label: str


class IdleClassify(TypedDict):
    phase: Literal["idle"]


class RunningClassify(_Counts):
    phase: Literal["running"]


class FinishedClassify(_Counts):
    phase: Literal["finished"]
    finished_at: float | None


class FailedClassify(_Counts):
    phase: Literal["failed"]


ClassifyState = IdleClassify | RunningClassify | FinishedClassify | FailedClassify


class ClassifySnapshot(TypedDict):
    running: bool
    done: int
    total: int
    updated: int
    last_label: str
    finished_at: float | None


def initial_classify_state() -> ClassifyState:
    return {"phase": "idle"}


def reduce_classify(state: ClassifyState, event: dict) -> ClassifyState:
    kind = event.get("type")
    if kind == "start":
        if state["phase"] == "running":
            return state
        total = event.get("total")
        if not isinstance(total, int) or isinstance(total, bool) or total < 1:
            return state
        return {
            "phase": "running",
            "done": 0,
            "total": total,
            "updated": 0,
            "last_label": "",
        }
    if state["phase"] != "running":
        return state
    if kind == "progress":
        done = event.get("done")
        label = event.get("label") or ""
        if (
            isinstance(done, bool)
            or not isinstance(done, int)
            or done != state["done"] + 1
            or done > state["total"]
            or not isinstance(label, str)
        ):
            return state
        return {
            "phase": "running",
            "done": done,
            "total": state["total"],
            "updated": state["updated"] + (1 if label else 0),
            "last_label": label or state["last_label"],
        }
    if kind == "finish":
        return {
            "phase": "finished",
            "done": state["done"],
            "total": state["total"],
            "updated": state["updated"],
            "last_label": state["last_label"],
            "finished_at": event.get("finished_at"),
        }
    if kind == "fail":
        return {
            "phase": "failed",
            "done": state["done"],
            "total": state["total"],
            "updated": state["updated"],
            "last_label": state["last_label"],
        }
    return state


def public_classify_state(state: ClassifyState) -> ClassifySnapshot:
    if state["phase"] == "idle":
        return {
            "running": False,
            "done": 0,
            "total": 0,
            "updated": 0,
            "last_label": "",
            "finished_at": None,
        }
    return {
        "running": state["phase"] == "running",
        "done": state["done"],
        "total": state["total"],
        "updated": state["updated"],
        "last_label": state["last_label"],
        "finished_at": state["finished_at"] if state["phase"] == "finished" else None,
    }
