type MapPresentation = "loading" | "ready" | "unavailable";

export type RouteLeafMapState =
  | { phase: "inactive"; sessionId: 0; status: "loading" | "unavailable" }
  | { phase: "waiting"; sessionId: number; status: MapPresentation; errorCount: number }
  | { phase: "ready"; sessionId: number; status: "ready" };

export type RouteLeafMapEvent =
  | { type: "sessionStarted"; sessionId: number }
  | { type: "deadlineReached"; sessionId: number }
  | { type: "sourceError"; sessionId: number }
  | { type: "mapIdle"; sessionId: number };

export function initialRouteLeafMapState(pointCount: number): RouteLeafMapState {
  return { phase: "inactive", sessionId: 0, status: pointCount > 1 ? "loading" : "unavailable" };
}

export function reduceRouteLeafMap(state: RouteLeafMapState, event: RouteLeafMapEvent): RouteLeafMapState {
  switch (event.type) {
    case "sessionStarted":
      if (event.sessionId <= state.sessionId) return state;
      return { phase: "waiting", sessionId: event.sessionId, status: state.status, errorCount: 0 };
    case "deadlineReached":
      if (state.phase !== "waiting" || event.sessionId !== state.sessionId || state.status === "unavailable") return state;
      return { ...state, status: "unavailable" };
    case "sourceError":
      if (state.phase !== "waiting" || event.sessionId !== state.sessionId) return state;
      return { ...state, errorCount: state.errorCount + 1, status: state.errorCount + 1 >= 4 ? "unavailable" : state.status };
    case "mapIdle":
      if (state.phase !== "waiting" || event.sessionId !== state.sessionId) return state;
      return { phase: "ready", sessionId: state.sessionId, status: "ready" };
  }
}
