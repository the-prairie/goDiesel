type LoadingStatus = { state: "loading"; message: string };
type ReadyStatus = { state: "ready"; message: string };
type UnavailableStatus = { state: "unavailable"; message: string };

export type GoogleRouteNavigatorStatus = LoadingStatus | ReadyStatus | UnavailableStatus;

/**
 * Why the current unavailable status was published, when a visitor should be
 * told something different from the diagnostic message. `authentication`
 * means Google rejected the key or origin: it outlasts a later scene error or
 * deadline of the same operation, and only a ready scene replaces it.
 */
export type GoogleRendererUnavailableReason = "authentication";

export type GoogleRendererState = { operationId: number } & (
  | { phase: "idle" | "destroyed"; status: null }
  | { phase: "loadingApi" | "loadingScene"; status: LoadingStatus | UnavailableStatus; reason?: GoogleRendererUnavailableReason }
  | { phase: "ready"; status: ReadyStatus }
  | { phase: "unavailable"; status: UnavailableStatus; reason?: GoogleRendererUnavailableReason }
);

const AUTHENTICATION_REJECTED: UnavailableStatus = {
  state: "unavailable",
  message: "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
};

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
      return state.phase === "loadingApi" || state.phase === "loadingScene"
        ? { ...state, status: AUTHENTICATION_REJECTED, reason: "authentication" }
        : { phase: "unavailable", operationId: state.operationId, status: AUTHENTICATION_REJECTED, reason: "authentication" };
    case "sceneErrored": {
      if (state.phase === "loadingApi") return state;
      if ((state.phase === "loadingScene" || state.phase === "unavailable") && state.reason === "authentication") return state;
      const status: UnavailableStatus = {
        state: "unavailable",
        message: "This browser could not start Google photorealistic 3D. Try a hardware-accelerated Chrome window.",
      };
      return state.phase === "loadingScene"
        ? { phase: "loadingScene", operationId: state.operationId, status }
        : { phase: "unavailable", operationId: state.operationId, status };
    }
    case "sceneReady":
      return state.phase === "loadingScene" ? {
        phase: "ready", operationId: state.operationId,
        status: { state: "ready", message: "Native Google 3D route world ready." },
      } : state;
    case "operationFailed":
      if (state.phase !== "loadingApi" && state.phase !== "loadingScene") return state;
      if (state.reason === "authentication" && state.status.state === "unavailable") {
        return { phase: "unavailable", operationId: state.operationId, status: state.status, reason: state.reason };
      }
      return {
        phase: "unavailable", operationId: state.operationId,
        status: { state: "unavailable", message: event.message },
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
