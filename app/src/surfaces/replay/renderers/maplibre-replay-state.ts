import type { ReplayStatus } from "../renderer-port";

type MapOperation = { operationId: number; errorCount: number };
export type MapLibreReplayState = MapOperation &
  (
    | { phase: "idle" | "loading" | "ready" | "disposed" }
    | { phase: "unavailable"; reason: "errors" | "deadline" }
  );
export type MapLibreReplayEvent =
  | { type: "mapStarted"; operationId: number }
  | { type: "mapLoaded"; operationId: number }
  | { type: "mapError"; operationId: number }
  | { type: "deadlineReached"; operationId: number }
  | { type: "disposed" };

export function initialMapLibreReplayState(): MapLibreReplayState {
  return { phase: "idle", operationId: 0, errorCount: 0 };
}

export function reduceMapLibreReplay(
  state: MapLibreReplayState,
  event: MapLibreReplayEvent,
): MapLibreReplayState {
  if (event.type === "disposed") {
    return { phase: "disposed", operationId: state.operationId, errorCount: 0 };
  }
  if (event.type === "mapStarted") {
    if (event.operationId <= state.operationId) return state;
    return {
      phase: state.phase === "ready" ? "ready" : "loading",
      operationId: event.operationId,
      errorCount: state.errorCount,
    };
  }
  if (
    state.phase === "disposed" ||
    state.phase === "idle" ||
    state.operationId !== event.operationId
  )
    return state;
  switch (event.type) {
    case "mapLoaded":
      return {
        phase: "ready",
        operationId: state.operationId,
        errorCount: state.errorCount,
      };
    case "mapError": {
      const errorCount = Math.min(4, state.errorCount + 1);
      if (state.phase === "ready") return { ...state, errorCount };
      return errorCount >= 4
        ? {
            phase: "unavailable",
            reason: "errors",
            operationId: state.operationId,
            errorCount,
          }
        : { ...state, errorCount };
    }
    case "deadlineReached":
      return state.phase === "ready"
        ? state
        : { ...state, phase: "unavailable", reason: "deadline" };
  }
}

export function mapLibreReplayStatus(
  state: MapLibreReplayState,
): ReplayStatus | undefined {
  switch (state.phase) {
    case "loading":
      return {
        state: "loading",
        title: "Opening Atlas replay",
        message: "Loading the route map and replay thread.",
      };
    case "ready":
      return {
        state: "ready",
        title: "Atlas replay ready",
        message: "The fallback route thread is ready to move.",
      };
    case "unavailable":
      return state.reason === "errors"
        ? {
            state: "unavailable",
            title: "Atlas replay unavailable",
            message: "The fallback map could not load in this browser session.",
          }
        : {
            state: "unavailable",
            title: "Atlas replay timed out",
            message: "The fallback map did not become ready in time.",
          };
    case "idle":
    case "disposed":
      return undefined;
  }
}
