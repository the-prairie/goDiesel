import type { AtlasWorldStatus } from "@/surfaces/atlas/atlas-world";

/**
 * Whether the selected region's route cards are in front of the person.
 *
 * Route cards come from bundled data. A region waits only while a working
 * world is moving to it, and never on the network:
 * - `waiting`: the world is still flying to the region or loading its terrain.
 * - `ready`: the world settled on the region in any outcome (terrain, a loaded
 *   or an unavailable fallback map, or an unavailable world). A later
 *   `ready`/`region-loading` status for a working world hides the cards again.
 * - `shown`: the deadline passed while the region was waiting. The cards stay;
 *   the world keeps catching up behind them.
 */
type RegionPresentation =
  | { state: "none" }
  | { state: "waiting" | "ready" | "shown"; regionName: string };

/**
 * `opening` until any engine first shows the globe or a region. Without a
 * world to act on, Atlas offers its places from bundled data instead.
 */
type WorldPresentation = "opening" | "open";

export interface AtlasPresentationState {
  engineId: number | null;
  status: AtlasWorldStatus;
  world: WorldPresentation;
  region: RegionPresentation;
}

/** The longest a selected region's cards wait for the world to reach it. */
export const ATLAS_REGION_PRESENTATION_DEADLINE_MS = 4_000;

export type AtlasPresentationEvent =
  | { type: "selectionChanged"; regionName?: string }
  | { type: "engineStarted"; engineId: number }
  | { type: "engineStopped"; engineId: number }
  | { type: "engineStatusReceived"; engineId: number; status: AtlasWorldStatus }
  | { type: "fallbackReady" | "fallbackUnavailable"; engineId: number; regionName: string }
  | { type: "presentationDeadlinePassed"; regionName: string };

export function initialAtlasPresentationState(
  regionName?: string,
): AtlasPresentationState {
  return {
    engineId: null,
    status: { state: "loading", message: "Opening the Atlas world." },
    world: "opening",
    region: regionName ? { state: "waiting", regionName } : { state: "none" },
  };
}

export function reduceAtlasPresentation(
  state: AtlasPresentationState,
  event: AtlasPresentationEvent,
): AtlasPresentationState {
  switch (event.type) {
    case "selectionChanged": {
      const regionName = state.region.state === "none"
        ? undefined
        : state.region.regionName;
      if (regionName === event.regionName) return state;
      if (!event.regionName) return { ...state, region: { state: "none" } };
      // An unavailable world sends no further status, so a region picked after
      // the failure is presented at once instead of waiting for terrain.
      return {
        ...state,
        region: {
          state: state.status.state === "unavailable" ? "ready" : "waiting",
          regionName: event.regionName,
        },
      };
    }
    case "engineStarted":
      return { ...state, engineId: event.engineId };
    case "engineStopped":
      return state.engineId === event.engineId
        ? { ...state, engineId: null }
        : state;
    case "engineStatusReceived": {
      if (state.engineId !== event.engineId) return state;
      const status = event.status;
      if (
        "regionName" in status &&
        (state.region.state === "none" || state.region.regionName !== status.regionName)
      ) return state;
      let region = state.region;
      let world = state.world;
      switch (status.state) {
        case "ready":
        case "region-loading":
          world = "open";
          if (region.state === "waiting" || region.state === "ready") {
            region = { state: "waiting", regionName: region.regionName };
          }
          break;
        case "region-ready":
          world = "open";
          if (region.state === "waiting") region = { state: "ready", regionName: region.regionName };
          break;
        case "unavailable":
          if (region.state === "waiting") region = { state: "ready", regionName: region.regionName };
          break;
        case "region-fallback":
          world = "open";
          break;
        case "loading":
          break;
        default: {
          const unhandled: never = status;
          throw new Error(`Unhandled Atlas status: ${JSON.stringify(unhandled)}`);
        }
      }
      return { ...state, status, world, region };
    }
    case "fallbackReady":
    case "fallbackUnavailable":
      // The fallback map settled, either way: the cards no longer wait for it.
      if (
        state.engineId !== event.engineId ||
        state.status.state !== "region-fallback" ||
        state.status.regionName !== event.regionName ||
        state.region.state !== "waiting" ||
        state.region.regionName !== event.regionName
      ) return state;
      return { ...state, region: { state: "ready", regionName: event.regionName } };
    case "presentationDeadlinePassed":
      if (state.region.state !== "waiting" || state.region.regionName !== event.regionName) {
        return state;
      }
      return { ...state, region: { state: "shown", regionName: event.regionName } };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Atlas presentation event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function isAtlasRegionPresented(
  state: AtlasPresentationState,
  regionName?: string,
): boolean {
  return (state.region.state === "ready" || state.region.state === "shown") &&
    state.region.regionName === regionName;
}

/** The region whose cards are waiting for the world, if any. */
export function atlasRegionAwaitingWorld(state: AtlasPresentationState) {
  return state.region.state === "waiting" ? state.region.regionName : undefined;
}
