import type { RouteDetailResult } from "@/data/route-repository";

export type RouteDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | RouteDetailResult;

type RememberedRoute = {
  slug: string;
  requestKey: number;
  result: RouteDetailResult;
};

export type RouteDetailLoadState = {
  phase:
    | { status: "idle" }
    | { status: "loading"; slug: string; requestKey: number }
    | { status: "settled"; slug: string; requestKey: number; result: RouteDetailResult };
  remembered: RememberedRoute | null;
};

export type RouteDetailLoadEvent =
  | { type: "selectionCleared" }
  | { type: "loadStarted"; slug: string; requestKey: number }
  | { type: "resultReceived"; slug: string; requestKey: number; result: RouteDetailResult };

export function initialRouteDetailLoadState(): RouteDetailLoadState {
  return { phase: { status: "idle" }, remembered: null };
}

export function reduceRouteDetailLoad(
  state: RouteDetailLoadState,
  event: RouteDetailLoadEvent,
): RouteDetailLoadState {
  switch (event.type) {
    case "selectionCleared": {
      if (state.phase.status === "idle") return state;
      const remembered = state.phase.status === "settled"
        ? {
            slug: state.phase.slug,
            requestKey: state.phase.requestKey,
            result: state.phase.result,
          }
        : state.remembered;
      return { phase: { status: "idle" }, remembered };
    }
    case "loadStarted": {
      const phase = state.phase;
      if (
        phase.status !== "idle" &&
        phase.slug === event.slug &&
        phase.requestKey === event.requestKey
      ) {
        return state;
      }
      if (
        state.remembered?.slug === event.slug &&
        state.remembered.requestKey === event.requestKey
      ) {
        return {
          phase: { status: "settled", ...state.remembered },
          remembered: state.remembered,
        };
      }
      return {
        phase: { status: "loading", slug: event.slug, requestKey: event.requestKey },
        remembered: state.remembered,
      };
    }
    case "resultReceived": {
      const phase = state.phase;
      if (
        phase.status === "idle" ||
        phase.slug !== event.slug ||
        phase.requestKey !== event.requestKey
      ) {
        return state;
      }
      const remembered = {
        slug: event.slug,
        requestKey: event.requestKey,
        result: event.result,
      };
      return { phase: { status: "settled", ...remembered }, remembered };
    }
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function routeDetailView(state: RouteDetailLoadState): RouteDetailState {
  if (state.phase.status === "settled") return state.phase.result;
  return { status: state.phase.status };
}
