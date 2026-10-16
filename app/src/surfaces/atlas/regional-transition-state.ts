import { recordTileFailure } from "@/providers/render-health";

interface RegionalOperation {
  operationId: number;
  regionName: string;
  tileFailureTimes: readonly number[];
  blankFrameCount: number;
}

export type RegionalTransitionState =
  | { status: "global" | "disposed"; operationId: number }
  | (RegionalOperation & { status: "loading" | "ready" })
  | { status: "fallback"; operationId: number; regionName: string };

export type RegionalTransitionEvent =
  | { type: "regionSelected"; regionName: string }
  | { type: "selectionCleared" }
  | { type: "disposed" }
  | { type: "transitionSettled"; operationId: number; terrainReady: boolean }
  | { type: "terrainFailed"; operationId: number }
  | { type: "tileFailed"; operationId: number; atMs: number }
  | { type: "frameObserved"; operationId: number; blank: boolean };

export function initialRegionalTransitionState(): RegionalTransitionState {
  return { status: "global", operationId: 0 };
}

export function regionalOperationIsCurrent(state: RegionalTransitionState, operationId: number) {
  return (state.status === "loading" || state.status === "ready") && state.operationId === operationId;
}

export function reduceRegionalTransition(
  state: RegionalTransitionState,
  event: RegionalTransitionEvent,
): RegionalTransitionState {
  switch (event.type) {
    case "regionSelected":
      return { status: "loading", operationId: state.operationId + 1, regionName: event.regionName,
        tileFailureTimes: [], blankFrameCount: 0 };
    case "selectionCleared":
      return { status: "global", operationId: state.operationId + 1 };
    case "disposed":
      return { status: "disposed", operationId: state.operationId + 1 };
  }
  if ((state.status !== "loading" && state.status !== "ready") || state.operationId !== event.operationId) return state;
  const fallback: RegionalTransitionState = {
    status: "fallback", operationId: state.operationId, regionName: state.regionName,
  };
  switch (event.type) {
    case "transitionSettled":
      if (state.status !== "loading") return state;
      return event.terrainReady ? { ...state, status: "ready" } : fallback;
    case "terrainFailed":
      return fallback;
    case "tileFailed": {
      const tileFailureTimes = recordTileFailure(state.tileFailureTimes, event.atMs);
      return tileFailureTimes.length >= 8 ? fallback : { ...state, tileFailureTimes };
    }
    case "frameObserved": {
      if (state.status !== "ready") return state;
      const blankFrameCount = event.blank ? state.blankFrameCount + 1 : 0;
      return blankFrameCount >= 2 ? fallback : { ...state, blankFrameCount };
    }
  }
}
