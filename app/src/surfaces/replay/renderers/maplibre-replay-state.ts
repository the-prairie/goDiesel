import type { ReplayStatus } from "../renderer-port";

type MapOperation = {
  /** The single identity of the current Replay map. Allocated by `mapStarted`. */
  operationId: number;
  /** Increments exactly when a transition publishes `mapLibreReplayStatus` to the consumer. */
  statusRevision: number;
  errorCount: number;
};
export type MapLibreReplayState = MapOperation &
  (
    | { phase: "idle" | "loading" | "disposed" }
    | {
        phase: "ready";
        /**
         * True when a new map started while the previous map of this engine
         * was ready and never disposed. It follows the pose immediately and
         * announces loading until its own map loads.
         */
        carriedOver: boolean;
      }
    | { phase: "unavailable"; reason: "errors" | "deadline" }
    | {
        phase: "unavailable";
        /** The map could not be constructed (no WebGL2 context); final for this run. */
        reason: "unsupported";
      }
    | {
        phase: "unavailable";
        reason: "geometry";
        /** A ready map from an undisposed earlier run is still on screen and following. */
        previousMapReady: boolean;
      }
  );
export type MapLibreReplayEvent =
  | { type: "mapStarted" }
  | { type: "inputsRejected"; operationId: number }
  | { type: "mapLoaded"; operationId: number }
  | { type: "mapError"; operationId: number }
  | { type: "mapUnsupported"; operationId: number }
  | { type: "deadlineReached"; operationId: number }
  | { type: "disposed" };

export function initialMapLibreReplayState(): MapLibreReplayState {
  return { phase: "idle", operationId: 0, statusRevision: 0, errorCount: 0 };
}

export function reduceMapLibreReplay(
  state: MapLibreReplayState,
  event: MapLibreReplayEvent,
): MapLibreReplayState {
  if (event.type === "disposed") {
    return {
      phase: "disposed",
      operationId: state.operationId,
      statusRevision: state.statusRevision,
      errorCount: 0,
    };
  }
  const operation = {
    operationId: state.operationId,
    statusRevision: state.statusRevision,
    errorCount: state.errorCount,
  };
  if (event.type === "mapStarted") {
    const next = {
      ...operation,
      operationId: state.operationId + 1,
      statusRevision: state.statusRevision + 1,
    };
    return mapLibreFollowsPose(state)
      ? { ...next, phase: "ready", carriedOver: true }
      : { ...next, phase: "loading" };
  }
  if (
    state.phase === "disposed" ||
    state.phase === "idle" ||
    state.operationId !== event.operationId ||
    (state.phase === "unavailable" &&
      (state.reason === "geometry" || state.reason === "unsupported"))
  )
    return state;
  const announced = operation.statusRevision + 1;
  switch (event.type) {
    case "inputsRejected":
      if (state.phase !== "loading" && !(state.phase === "ready" && state.carriedOver))
        return state;
      return {
        ...operation,
        statusRevision: announced,
        phase: "unavailable",
        reason: "geometry",
        previousMapReady: state.phase === "ready",
      };
    case "mapUnsupported":
      return {
        ...operation,
        statusRevision: announced,
        phase: "unavailable",
        reason: "unsupported",
      };
    case "mapLoaded":
      return {
        ...operation,
        statusRevision: announced,
        phase: "ready",
        carriedOver: false,
      };
    case "mapError": {
      const errorCount = Math.min(4, state.errorCount + 1);
      if (state.phase === "ready" || errorCount < 4)
        return { ...state, errorCount };
      return {
        ...operation,
        statusRevision: announced,
        errorCount,
        phase: "unavailable",
        reason: "errors",
      };
    }
    case "deadlineReached":
      return state.phase === "ready"
        ? state
        : {
            ...operation,
            statusRevision: announced,
            phase: "unavailable",
            reason: "deadline",
          };
  }
}

/** Whether outcomes captured for `operationId` still belong to the live map. */
export function mapLibreRunIsCurrent(
  state: MapLibreReplayState,
  operationId: number,
) {
  return state.operationId === operationId && state.phase !== "disposed";
}

/** Whether `setPose` may move the engine's map. */
export function mapLibreFollowsPose(state: MapLibreReplayState) {
  return (
    state.phase === "ready" ||
    (state.phase === "unavailable" &&
      state.reason === "geometry" &&
      state.previousMapReady)
  );
}

const LOADING = {
  title: "Opening Atlas replay",
  message: "Loading the route map and replay thread.",
};
const UNAVAILABLE = {
  geometry: {
    title: "Route geometry unavailable",
    message: "This route does not contain enough points for Atlas replay.",
  },
  errors: {
    title: "Atlas replay unavailable",
    message: "The fallback map could not load in this browser session.",
  },
  deadline: {
    title: "Atlas replay timed out",
    message: "The fallback map did not become ready in time.",
  },
  unsupported: {
    title: "Atlas replay isn\u2019t supported here",
    message:
      "This browser couldn\u2019t start the map graphics (WebGL 2) that Atlas replay draws on.",
  },
};

/** The only source of statuses the MapLibre Replay engine publishes. */
export function mapLibreReplayStatus(
  state: MapLibreReplayState,
): ReplayStatus | undefined {
  switch (state.phase) {
    case "loading":
      return { state: "loading", ...LOADING };
    case "ready":
      return state.carriedOver
        ? { state: "loading", ...LOADING }
        : {
            state: "ready",
            title: "Atlas replay ready",
            message: "The fallback route thread is ready to move.",
          };
    case "unavailable":
      return { state: "unavailable", ...UNAVAILABLE[state.reason] };
    case "idle":
    case "disposed":
      return undefined;
  }
}
