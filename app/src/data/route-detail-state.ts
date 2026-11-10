import type { RouteDetailResult } from "@/data/route-repository";

export type RouteDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | RouteDetailResult;

export type RouteDetailLoadState =
  | { status: "idle" }
  | { status: "loading"; slug: string; requestKey: number }
  | { status: "settled"; slug: string; requestKey: number; result: RouteDetailResult };

export type RouteDetailLoadEvent =
  | { type: "selectionCleared" }
  | { type: "loadStarted"; slug: string; requestKey: number }
  | { type: "resultReceived"; slug: string; requestKey: number; result: RouteDetailResult };

export function initialRouteDetailLoadState(): RouteDetailLoadState {
  return { status: "idle" };
}

export function reduceRouteDetailLoad(
  state: RouteDetailLoadState,
  event: RouteDetailLoadEvent,
): RouteDetailLoadState {
  switch (event.type) {
    case "selectionCleared":
      return state.status === "idle" ? state : { status: "idle" };
    case "loadStarted":
      if (
        state.status !== "idle" &&
        state.slug === event.slug &&
        state.requestKey === event.requestKey
      ) {
        return state;
      }
      return { status: "loading", slug: event.slug, requestKey: event.requestKey };
    case "resultReceived":
      if (
        state.status === "idle" ||
        state.slug !== event.slug ||
        state.requestKey !== event.requestKey
      ) {
        return state;
      }
      return {
        status: "settled",
        slug: event.slug,
        requestKey: event.requestKey,
        result: event.result,
      };
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function routeDetailView(state: RouteDetailLoadState): RouteDetailState {
  if (state.status === "settled") return state.result;
  return { status: state.status };
}
