import { lowerTier, type QualityTier } from "@/labs/overland/model/town-quality";

/**
 * Opening a 3D town: the renderer's chunk loads, WebGL starts, the town is
 * baked and drawn. Any failure on the way, or a lost WebGL context later,
 * falls back to the pixel town, which is final for that load. While ready,
 * the quality tier only steps down. The town component owns the renderer
 * and dispatches each outcome with the load id it was started with.
 */
export type TownFailure = "webgl" | "chunk" | "context" | "error";

export type OverlandTownState =
  | { phase: "idle"; lastLoadId: number }
  | { phase: "loading"; loadId: number; tier: QualityTier }
  | { phase: "ready"; loadId: number; tier: QualityTier }
  | { phase: "fallback"; loadId: number; reason: TownFailure };

export type OverlandTownEvent =
  | { type: "loadStarted"; tier: QualityTier }
  | { type: "rendererReady"; loadId: number }
  | { type: "rendererFailed"; loadId: number; reason: Exclude<TownFailure, "context"> }
  | { type: "contextLost"; loadId: number }
  | { type: "qualityLowered"; loadId: number; tier: QualityTier }
  | { type: "disposed" };

export function initialOverlandTownState(): OverlandTownState {
  return { phase: "idle", lastLoadId: 0 };
}

export function reduceOverlandTown(state: OverlandTownState, event: OverlandTownEvent): OverlandTownState {
  switch (event.type) {
    case "loadStarted":
      if (state.phase !== "idle") return state;
      return { phase: "loading", loadId: state.lastLoadId + 1, tier: event.tier };
    case "disposed":
      return state.phase === "idle" ? state : { phase: "idle", lastLoadId: state.loadId };
    default:
      break;
  }
  if (state.phase === "idle" || state.phase === "fallback" || event.loadId !== state.loadId) return state;
  switch (event.type) {
    case "rendererReady":
      return state.phase === "loading" ? { phase: "ready", loadId: state.loadId, tier: state.tier } : state;
    case "rendererFailed":
      return { phase: "fallback", loadId: state.loadId, reason: event.reason };
    case "contextLost":
      return { phase: "fallback", loadId: state.loadId, reason: "context" };
    case "qualityLowered":
      return state.phase === "ready" && lowerTier(state.tier, event.tier) ? { ...state, tier: event.tier } : state;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function townShowsFallback(state: OverlandTownState) {
  return state.phase === "fallback";
}
