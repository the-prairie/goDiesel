"""The owner rebuild lifecycle: one background `build.py` run at a time.

A pure reducer in the `admin_classify.py` style. `admin.py` owns the lock, the
thread, the subprocess, the clock, and the run id, and passes them in as events.
"""
from __future__ import annotations

from typing import Literal, TypedDict

# Enough of stderr to show a traceback's last frames, never the bulk of a run.
STDERR_TAIL_BYTES = 2048


class IdleRebuild(TypedDict):
    phase: Literal["idle"]


class RunningRebuild(TypedDict):
    phase: Literal["running"]
    id: str
    started_at: float


class SucceededRebuild(TypedDict):
    phase: Literal["succeeded"]
    id: str
    finished_at: float


class FailedRebuild(TypedDict):
    phase: Literal["failed"]
    id: str
    finished_at: float
    exit_code: int | None
    stderr_tail: str


RebuildState = IdleRebuild | RunningRebuild | SucceededRebuild | FailedRebuild

RebuildPhase = Literal["idle", "running", "succeeded", "failed"]


class RebuildSnapshot(TypedDict):
    phase: RebuildPhase
    id: str | None
    started_at: float | None
    finished_at: float | None
    exit_code: int | None
    stderr_tail: str | None


def initial_rebuild_state() -> RebuildState:
    return {"phase": "idle"}


def reduce_rebuild(state: RebuildState, event: dict) -> RebuildState:
    kind = event.get("type")
    if kind == "start":
        if state["phase"] == "running":
            return state
        run_id = event.get("id")
        if not isinstance(run_id, str) or not run_id:
            return state
        return {"phase": "running", "id": run_id, "started_at": event.get("started_at")}
    if state["phase"] != "running" or event.get("id") != state["id"]:
        return state
    if kind == "succeed":
        return {"phase": "succeeded", "id": state["id"], "finished_at": event.get("finished_at")}
    if kind == "fail":
        exit_code = event.get("exit_code")
        return {
            "phase": "failed",
            "id": state["id"],
            "finished_at": event.get("finished_at"),
            "exit_code": exit_code if isinstance(exit_code, int) else None,
            "stderr_tail": str(event.get("stderr_tail") or ""),
        }
    return state


def public_rebuild_state(state: RebuildState) -> RebuildSnapshot:
    return {
        "phase": state["phase"],
        "id": state.get("id"),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
        "exit_code": state.get("exit_code"),
        "stderr_tail": state.get("stderr_tail"),
    }


def stderr_tail(data: bytes) -> str:
    """Decode the last STDERR_TAIL_BYTES of a process's stderr."""
    return data[-STDERR_TAIL_BYTES:].decode("utf-8", errors="replace")
