import type { RouteSummary } from "@/domain/route";

export type AtlasObjectState =
  | { phase: "orbit"; tuned: string | null; gesture: "still" | "dragging" }
  | { phase: "diving"; place: string }
  | { phase: "landed"; place: string; focus: string | null };

export type AtlasObjectEvent =
  | { type: "drag" }
  | { type: "retune"; place: string | null }
  | { type: "lock" }
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
  return { phase: "orbit", tuned: null, gesture: "still" };
}

export function reduceAtlasObject(
  state: AtlasObjectState,
  event: AtlasObjectEvent,
): AtlasObjectState {
  switch (event.type) {
    case "drag":
      if (state.phase !== "orbit" || state.gesture === "dragging") return state;
      return { phase: "orbit", tuned: state.tuned, gesture: "dragging" };
    case "retune":
      if (state.phase !== "orbit" || state.tuned === event.place) return state;
      return { phase: "orbit", tuned: event.place, gesture: state.gesture };
    case "lock":
      if (state.phase !== "orbit" || state.gesture !== "dragging") return state;
      return { phase: "orbit", tuned: state.tuned, gesture: "still" };
    case "commit":
      if (state.phase !== "orbit" || state.gesture !== "still" || !state.tuned) return state;
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
      return { phase: "orbit", tuned: null, gesture: "still" };
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

export function activityStamp(
  route: Pick<RouteSummary, "slug" | "date">,
  siblings: Pick<RouteSummary, "slug" | "date">[],
): string {
  const day = route.date.slice(0, 10);
  const sameDay = siblings.filter((other) => other.date.slice(0, 10) === day);
  if (sameDay.length < 2) return day;
  const clock = route.date.length > 10 ? route.date.slice(11, 16) : "";
  if (clock && clock !== "00:00") return `${day} ${clock}`;
  const ordered = [...sameDay].sort((a, b) => a.slug.localeCompare(b.slug));
  const index = ordered.findIndex((other) => other.slug === route.slug) + 1;
  return `${day} · ${index}`;
}

export function ghostCopy(
  route: RouteSummary,
  siblings: RouteSummary[],
): { heading: string; detail: string; stats: string } {
  const stamp = activityStamp(route, siblings);
  const stats = `${route.distanceKm.toFixed(1)} km · ${Math.round(route.elevationGainM)} m up · ${route.type}`;
  const curated = [route.guide.vibe, route.subtitle].find(
    (value): value is string =>
      typeof value === "string" && value.length > 0 && value.length <= 48 && value !== route.name,
  );
  return {
    heading: curated ?? `${stamp} · ${route.distanceKm.toFixed(1)} km · ${Math.round(route.elevationGainM)} m`,
    detail: route.name,
    stats,
  };
}
