import type { AtlasWorldStatus } from "@/surfaces/atlas/atlas-world";

type RegionPresentation =
  | { state: "none" }
  | { state: "waiting" | "ready"; regionName: string };

export interface AtlasPresentationState {
  engineId: number | null;
  status: AtlasWorldStatus;
  region: RegionPresentation;
}

export type AtlasPresentationEvent =
  | { type: "selectionChanged"; regionName?: string }
  | { type: "engineStarted"; engineId: number }
  | { type: "engineStopped"; engineId: number }
  | { type: "engineStatusReceived"; engineId: number; status: AtlasWorldStatus }
  | { type: "fallbackReady"; engineId: number; regionName: string };

export function initialAtlasPresentationState(
  regionName?: string,
): AtlasPresentationState {
  return {
    engineId: null,
    status: { state: "loading", message: "Opening the Atlas world." },
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
      return {
        ...state,
        region: event.regionName
          ? { state: "waiting", regionName: event.regionName }
          : { state: "none" },
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
      if (region.state !== "none") {
        switch (status.state) {
          case "ready":
          case "region-loading":
            region = { state: "waiting", regionName: region.regionName };
            break;
          case "region-ready":
          case "unavailable":
            region = { state: "ready", regionName: region.regionName };
            break;
          case "loading":
          case "region-fallback":
            break;
          default: {
            const unhandled: never = status;
            throw new Error(`Unhandled Atlas status: ${JSON.stringify(unhandled)}`);
          }
        }
      }
      return { ...state, status, region };
    }
    case "fallbackReady":
      if (
        state.engineId !== event.engineId ||
        state.status.state !== "region-fallback" ||
        state.status.regionName !== event.regionName ||
        state.region.state !== "waiting" ||
        state.region.regionName !== event.regionName
      ) return state;
      return { ...state, region: { state: "ready", regionName: event.regionName } };
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
  return state.region.state === "ready" && state.region.regionName === regionName;
}
