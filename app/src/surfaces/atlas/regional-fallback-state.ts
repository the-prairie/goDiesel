type Loading = { phase: "loading"; errors: 0 | 1 | 2 | 3 };
type UnavailableReason = "geometry" | "construction" | "errors" | "timeout";

export type RegionalFallbackState = { session: number } & (
  | Loading
  | { phase: "ready" }
  | { phase: "unavailable"; reason: UnavailableReason }
);

export type RegionalFallbackEvent =
  | { type: "sessionStarted"; session: number; hasGeometry: boolean }
  | { type: "constructionFailed" | "mapErrored" | "loadTimedOut" | "mapLoaded"; session: number };

export function initialRegionalFallbackState(): RegionalFallbackState {
  return { phase: "loading", session: 0, errors: 0 };
}

export function reduceRegionalFallback(
  state: RegionalFallbackState,
  event: RegionalFallbackEvent,
): RegionalFallbackState {
  if (event.type === "sessionStarted") {
    if (event.session <= state.session) return state;
    return event.hasGeometry
      ? { phase: "loading", session: event.session, errors: 0 }
      : { phase: "unavailable", session: event.session, reason: "geometry" };
  }
  if (event.session !== state.session) return state;
  switch (event.type) {
    case "mapLoaded":
      if (state.phase === "ready" || (state.phase === "unavailable" &&
        (state.reason === "geometry" || state.reason === "construction"))) return state;
      return { phase: "ready", session: state.session };
    case "mapErrored":
      if (state.phase !== "loading") return state;
      return state.errors === 3
        ? { phase: "unavailable", session: state.session, reason: "errors" }
        : { ...state, errors: ([1, 2, 3] as const)[state.errors] };
    case "loadTimedOut":
    case "constructionFailed":
      if (state.phase !== "loading") return state;
      return {
        phase: "unavailable", session: state.session,
        reason: event.type === "loadTimedOut" ? "timeout" : "construction",
      };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled regional fallback event: ${JSON.stringify(unhandled)}`);
    }
  }
}
