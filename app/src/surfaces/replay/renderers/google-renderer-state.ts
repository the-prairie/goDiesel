type LoadingStatus = { state: "loading"; message: string };
type ReadyStatus = { state: "ready"; message: string };
type UnavailableStatus = { state: "unavailable"; message: string };

export type GoogleRouteNavigatorStatus = LoadingStatus | ReadyStatus | UnavailableStatus;

export type GoogleRendererState = { operationId: number } & (
  | { phase: "idle" | "destroyed"; status: null }
  | { phase: "loadingApi" | "loadingScene"; status: LoadingStatus | UnavailableStatus }
  | { phase: "ready"; status: ReadyStatus }
  | { phase: "unavailable"; status: UnavailableStatus }
);

export type GoogleRendererEvent =
  | { type: "mountStarted" }
  | { type: "destroyed" }
  | { type: "inputsRejected"; operationId: number; reason: "key" | "geometry" }
  | { type: "apiLoaded"; operationId: number }
  | { type: "authenticationRejected"; operationId: number }
  | { type: "sceneErrored"; operationId: number }
  | { type: "sceneReady"; operationId: number }
  | { type: "operationFailed"; operationId: number; message: string };

export function initialGoogleRendererState(): GoogleRendererState {
  return { phase: "idle", operationId: 0, status: null };
}

export function reduceGoogleRenderer(
  state: GoogleRendererState,
  event: GoogleRendererEvent,
): GoogleRendererState {
  if (event.type === "mountStarted") {
    return {
      phase: "loadingApi", operationId: state.operationId + 1,
      status: { state: "loading", message: "Loading Google photorealistic 3D." },
    };
  }
  if (event.type === "destroyed") {
    return { phase: "destroyed", operationId: state.operationId + 1, status: null };
  }
  if (event.operationId !== state.operationId || state.phase === "idle" || state.phase === "destroyed") {
    return state;
  }

  switch (event.type) {
    case "inputsRejected":
      if (state.phase !== "loadingApi") return state;
      return {
        phase: "unavailable", operationId: state.operationId,
        status: {
          state: "unavailable",
          message: event.reason === "key"
            ? "A Google Maps JavaScript API browser key is required."
            : "Recorded route geometry is unavailable.",
        },
      };
    case "apiLoaded":
      return state.phase === "loadingApi" ? { ...state, phase: "loadingScene" } : state;
    case "authenticationRejected":
    case "sceneErrored": {
      if (event.type === "sceneErrored" && state.phase === "loadingApi") return state;
      const status: UnavailableStatus = {
        state: "unavailable",
        message: event.type === "authenticationRejected"
          ? "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions."
          : "This browser could not start Google photorealistic 3D. Try a hardware-accelerated Chrome window.",
      };
      return state.phase === "loadingApi" || state.phase === "loadingScene"
        ? { ...state, status }
        : { phase: "unavailable", operationId: state.operationId, status };
    }
    case "sceneReady":
      return state.phase === "loadingScene" ? {
        phase: "ready", operationId: state.operationId,
        status: { state: "ready", message: "Native Google 3D route world ready." },
      } : state;
    case "operationFailed":
      return state.phase === "loadingApi" || state.phase === "loadingScene" ? {
        phase: "unavailable", operationId: state.operationId,
        status: { state: "unavailable", message: event.message },
      } : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
