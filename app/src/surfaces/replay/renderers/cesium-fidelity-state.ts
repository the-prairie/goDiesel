import { recordTileFailure } from "@/providers/render-health";
import type { ReplayStatus } from "../renderer-port";

export type CesiumPartialReason = "tileFailures" | "blankFrames";
export type CesiumRejectedInput = "geometry" | "webgl" | "credentials";
export type CesiumUnavailableReason = CesiumRejectedInput | "provider";

type FidelityContext = {
  /** The single identity of the current Replay run. Allocated by `sessionStarted`. */
  operationId: number;
  /** Increments exactly when a transition publishes `cesiumFidelityStatus` to the consumer. */
  statusRevision: number;
  tileFailureTimes: readonly number[];
  blankFrameCount: number;
};
export type CesiumFidelityState = FidelityContext &
  (
    | { phase: "idle" | "loading" | "disposed" }
    | { phase: "ready"; initialTiles: "loaded" | "timeout" }
    | {
        phase: "partial";
        reason: CesiumPartialReason;
        /**
         * True when a later session inherited this degradation because the
         * engine was mounted again without disposal. That session announced
         * loading and never announces ready or partial.
         */
        carriedOver: boolean;
      }
    | {
        phase: "unavailable";
        reason: CesiumUnavailableReason;
        /** Inherited partial fidelity that a later session will carry over again. */
        retainedPartial?: CesiumPartialReason;
      }
  );
export type CesiumFidelityEvent =
  | { type: "sessionStarted" }
  | { type: "inputsRejected"; operationId: number; reason: CesiumRejectedInput }
  | { type: "loadFailed"; operationId: number }
  | {
      type: "initialTilesSettled";
      operationId: number;
      result: "loaded" | "timeout" | "cancelled";
    }
  | { type: "tileFailed"; operationId: number; atMs: number }
  | { type: "frameObserved"; operationId: number; blank: boolean }
  | { type: "disposed" };

export function initialCesiumFidelityState(): CesiumFidelityState {
  return {
    phase: "idle",
    operationId: 0,
    statusRevision: 0,
    tileFailureTimes: [],
    blankFrameCount: 0,
  };
}

function announced(state: CesiumFidelityState): CesiumFidelityState {
  return { ...state, statusRevision: state.statusRevision + 1 };
}

function startSession(state: CesiumFidelityState): CesiumFidelityState {
  const context = {
    operationId: state.operationId + 1,
    statusRevision: state.statusRevision + 1,
    tileFailureTimes: state.tileFailureTimes,
    blankFrameCount: state.blankFrameCount,
  };
  if (state.phase === "partial")
    return { ...context, phase: "partial", reason: state.reason, carriedOver: true };
  if (state.phase === "unavailable" && state.retainedPartial)
    return {
      ...context,
      phase: "partial",
      reason: state.retainedPartial,
      carriedOver: true,
    };
  return { ...context, phase: "loading" };
}

export function reduceCesiumFidelity(
  state: CesiumFidelityState,
  event: CesiumFidelityEvent,
): CesiumFidelityState {
  if (event.type === "disposed") {
    return {
      phase: "disposed",
      operationId: state.operationId,
      statusRevision: state.statusRevision,
      tileFailureTimes: [],
      blankFrameCount: 0,
    };
  }
  if (event.type === "sessionStarted") return startSession(state);
  if (
    state.operationId !== event.operationId ||
    state.phase === "idle" ||
    state.phase === "disposed" ||
    state.phase === "unavailable"
  )
    return state;
  switch (event.type) {
    case "inputsRejected":
      if (state.phase !== "loading" && state.phase !== "partial") return state;
      return announced({
        operationId: state.operationId,
        statusRevision: state.statusRevision,
        tileFailureTimes: state.tileFailureTimes,
        blankFrameCount: state.blankFrameCount,
        phase: "unavailable",
        reason: event.reason,
        ...(state.phase === "partial" ? { retainedPartial: state.reason } : {}),
      });
    case "loadFailed":
      return announced({
        operationId: state.operationId,
        statusRevision: state.statusRevision,
        tileFailureTimes: [],
        blankFrameCount: 0,
        phase: "unavailable",
        reason: "provider",
      });
  }
  if (state.phase === "partial") return state;
  switch (event.type) {
    case "initialTilesSettled":
      return state.phase === "loading" && event.result !== "cancelled"
        ? announced({ ...state, phase: "ready", initialTiles: event.result })
        : state;
    case "tileFailed": {
      const tileFailureTimes = recordTileFailure(
        state.tileFailureTimes,
        event.atMs,
      );
      return tileFailureTimes.length >= 8
        ? announced({
            ...state,
            phase: "partial",
            reason: "tileFailures",
            carriedOver: false,
            tileFailureTimes,
          })
        : { ...state, tileFailureTimes };
    }
    case "frameObserved": {
      if (state.phase !== "ready") return state;
      const blankFrameCount = event.blank ? state.blankFrameCount + 1 : 0;
      return blankFrameCount >= 2
        ? announced({
            ...state,
            phase: "partial",
            reason: "blankFrames",
            carriedOver: false,
            blankFrameCount,
          })
        : { ...state, blankFrameCount };
    }
  }
}

/**
 * Whether outcomes captured for `operationId` still belong to the live run.
 * Disposal and a failed load (which released the run's resources) end a run;
 * rejected inputs release nothing, so they do not.
 */
export function cesiumRunIsCurrent(
  state: CesiumFidelityState,
  operationId: number,
) {
  return (
    state.operationId === operationId &&
    state.phase !== "disposed" &&
    !(state.phase === "unavailable" && state.reason === "provider")
  );
}

const UNAVAILABLE: Record<
  CesiumUnavailableReason,
  { title: string; message: string }
> = {
  geometry: {
    title: "Route geometry unavailable",
    message: "This completed route does not contain enough points to replay.",
  },
  webgl: {
    title: "WebGL unavailable",
    message: "This browser cannot start the photorealistic replay.",
  },
  credentials: {
    title: "Map tiles unavailable",
    message: "A Google Map Tiles browser key is required for Earth Replay.",
  },
  provider: {
    title: "Photorealistic world unavailable",
    message: "Google 3D tiles could not load for this route.",
  },
};

const LOADING: ReplayStatus = {
  state: "loading",
  title: "Building your route world",
  message: "Loading the bundled Earth engine and photorealistic tiles.",
};

/** The only source of statuses the Cesium Replay engine publishes. */
export function cesiumFidelityStatus(
  state: CesiumFidelityState,
): ReplayStatus | undefined {
  switch (state.phase) {
    case "loading":
      return { ...LOADING };
    case "ready":
      return {
        state: "ready",
        title: "Earth Replay ready",
        message:
          state.initialTiles === "loaded"
            ? "The route thread is ready to move."
            : "The route is ready while finer tile detail continues loading.",
      };
    case "partial":
      if (state.carriedOver) return { ...LOADING };
      return {
        state: "partial",
        title: "3D tiles partially unavailable",
        message:
          state.reason === "tileFailures"
            ? "Several photorealistic tiles failed to load. Replay can continue with gaps."
            : "The 3D scene is not rendering fully. Replay can continue in Atlas instead.",
      };
    case "unavailable":
      return { state: "unavailable", ...UNAVAILABLE[state.reason] };
    case "idle":
    case "disposed":
      return undefined;
  }
}
