export type ReplayRendererParam = string | null;

export type ReplaySurfaceState =
  | { routeSlug: string | undefined; kind: "google" }
  | { routeSlug: string | undefined; kind: "atlas"; reason: "requested" | "degraded" }
  | { routeSlug: string | undefined; kind: "cesium" };

export type ReplaySurfaceEvent =
  | { type: "paramsChanged"; renderer: ReplayRendererParam; routeSlug: string | undefined }
  | { type: "googleDegraded" };

export function replayRendererFromParam(renderer: ReplayRendererParam): ReplaySurfaceState["kind"] {
  if (renderer === "atlas" || renderer === "cesium") return renderer;
  return "google";
}

export function initialReplaySurfaceState(
  renderer: ReplayRendererParam,
  routeSlug: string | undefined,
): ReplaySurfaceState {
  return reduceReplaySurface(
    { routeSlug: undefined, kind: "google" },
    { type: "paramsChanged", renderer, routeSlug },
  );
}

export function reduceReplaySurface(
  state: ReplaySurfaceState,
  event: ReplaySurfaceEvent,
): ReplaySurfaceState {
  switch (event.type) {
    case "paramsChanged": {
      const renderer = replayRendererFromParam(event.renderer);
      const sameRoute = event.routeSlug === state.routeSlug;
      const next: ReplaySurfaceState =
        renderer === "cesium"
          ? { routeSlug: event.routeSlug, kind: "cesium" }
          : renderer === "atlas"
            ? { routeSlug: event.routeSlug, kind: "atlas", reason: "requested" }
            : sameRoute && state.kind === "atlas" && state.reason === "degraded"
              ? { routeSlug: event.routeSlug, kind: "atlas", reason: "degraded" }
              : { routeSlug: event.routeSlug, kind: "google" };
      if (
        next.routeSlug === state.routeSlug &&
        next.kind === state.kind &&
        (next.kind !== "atlas" || state.kind !== "atlas" || next.reason === state.reason)
      ) {
        return state;
      }
      return next;
    }
    case "googleDegraded":
      if (state.kind !== "google") return state;
      return { routeSlug: state.routeSlug, kind: "atlas", reason: "degraded" };
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function replaySurfaceMatches(
  state: ReplaySurfaceState,
  renderer: ReplayRendererParam,
  routeSlug: string | undefined,
): boolean {
  return reduceReplaySurface(state, { type: "paramsChanged", renderer, routeSlug }) === state;
}
