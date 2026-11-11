import type { RouteSummary } from "@/domain/route";

export type AtlasObjectState =
  | { phase: "orbit"; tuned: string | null }
  | { phase: "diving"; place: string }
  | { phase: "landed"; place: string; focus: string | null };

export type AtlasObjectEvent =
  | { type: "retune"; place: string | null }
  | { type: "commit" }
  | { type: "arrived" }
  | { type: "focus"; slug: string }
  | { type: "release" }
  | { type: "ascend" };

export function initialAtlasObject(
  place: string | null,
  focus: string | null,
): AtlasObjectState {
  if (place) return { phase: "landed", place, focus };
  return { phase: "orbit", tuned: null };
}

export function reduceAtlasObject(
  state: AtlasObjectState,
  event: AtlasObjectEvent,
): AtlasObjectState {
  switch (event.type) {
    case "retune":
      if (state.phase !== "orbit" || state.tuned === event.place) return state;
      return { phase: "orbit", tuned: event.place };
    case "commit":
      if (state.phase !== "orbit" || !state.tuned) return state;
      return { phase: "diving", place: state.tuned };
    case "arrived":
      if (state.phase !== "diving") return state;
      return { phase: "landed", place: state.place, focus: null };
    case "focus":
      if (state.phase !== "landed" || state.focus === event.slug) return state;
      return { phase: "landed", place: state.place, focus: event.slug };
    case "release":
      if (state.phase !== "landed" || state.focus === null) return state;
      return { phase: "landed", place: state.place, focus: null };
    case "ascend":
      if (state.phase === "orbit") return state;
      return { phase: "orbit", tuned: null };
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function routeWear(route: RouteSummary, regionRoutes: RouteSummary[]): 1 | 2 | 3 {
  const near = regionRoutes.filter((other) => {
    if (other.slug === route.slug) return false;
    const dLat = other.centerLat - route.centerLat;
    const dLng = other.centerLng - route.centerLng;
    return dLat * dLat + dLng * dLng < 0.08 * 0.08;
  }).length;
  if (near >= 3) return 3;
  if (near >= 1) return 2;
  return 1;
}
