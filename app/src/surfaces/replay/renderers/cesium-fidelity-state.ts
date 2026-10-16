import { recordTileFailure } from "@/providers/render-health";
import type { ReplayStatus } from "../renderer-port";

type FidelityContext = {
  operationId: number;
  tileFailureTimes: readonly number[];
  blankFrameCount: number;
};
export type CesiumFidelityState = FidelityContext &
  (
    | { phase: "idle" | "loading" | "disposed" }
    | { phase: "ready"; initialTiles: "loaded" | "timeout" }
    | { phase: "partial"; reason: "tileFailures" | "blankFrames" }
  );
export type CesiumFidelityEvent =
  | { type: "sessionStarted"; operationId: number }
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
    tileFailureTimes: [],
    blankFrameCount: 0,
  };
}

export function reduceCesiumFidelity(
  state: CesiumFidelityState,
  event: CesiumFidelityEvent,
): CesiumFidelityState {
  if (event.type === "disposed") {
    return {
      phase: "disposed",
      operationId: state.operationId,
      tileFailureTimes: [],
      blankFrameCount: 0,
    };
  }
  if (event.type === "sessionStarted") {
    if (event.operationId <= state.operationId) return state;
    return state.phase === "partial"
      ? { ...state, operationId: event.operationId }
      : {
          phase: "loading",
          operationId: event.operationId,
          tileFailureTimes: state.tileFailureTimes,
          blankFrameCount: state.blankFrameCount,
        };
  }
  if (
    state.operationId !== event.operationId ||
    state.phase === "idle" ||
    state.phase === "disposed" ||
    state.phase === "partial"
  )
    return state;
  switch (event.type) {
    case "initialTilesSettled":
      return state.phase === "loading" && event.result !== "cancelled"
        ? { ...state, phase: "ready", initialTiles: event.result }
        : state;
    case "tileFailed": {
      const tileFailureTimes = recordTileFailure(
        state.tileFailureTimes,
        event.atMs,
      );
      return tileFailureTimes.length >= 8
        ? {
            ...state,
            phase: "partial",
            reason: "tileFailures",
            tileFailureTimes,
          }
        : { ...state, tileFailureTimes };
    }
    case "frameObserved": {
      if (state.phase !== "ready") return state;
      const blankFrameCount = event.blank ? state.blankFrameCount + 1 : 0;
      return blankFrameCount >= 2
        ? { ...state, phase: "partial", reason: "blankFrames", blankFrameCount }
        : { ...state, blankFrameCount };
    }
  }
}

export function cesiumFidelityStatus(
  state: CesiumFidelityState,
): ReplayStatus | undefined {
  switch (state.phase) {
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
      return {
        state: "partial",
        title: "3D tiles partially unavailable",
        message:
          state.reason === "tileFailures"
            ? "Several photorealistic tiles failed to load. Replay can continue with gaps."
            : "The 3D scene is not rendering fully. Replay can continue in Atlas instead.",
      };
    case "idle":
    case "loading":
    case "disposed":
      return undefined;
  }
}
