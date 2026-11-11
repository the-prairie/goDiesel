import {
  advanceGoogleRouteNavigator,
  cycleGoogleRouteSpeed,
  initialGoogleRouteNavigatorState,
  seekGoogleRouteNavigator,
  zoomGoogleRouteNavigator,
  type GoogleRouteCameraMode,
  type GoogleRouteGroundingMode,
  type GoogleRouteNavigatorState,
} from "@/surfaces/replay/playback/route-navigator-controller";

export type ReplaySessionState = GoogleRouteNavigatorState;

export type ReplaySessionEvent =
  | { type: "playbackToggled" }
  | { type: "frameElapsed"; elapsedSeconds: number; totalDistanceM: number }
  | { type: "progressSelected"; progressM: number; totalDistanceM: number }
  | { type: "speedCycled" }
  | { type: "cameraSelected"; cameraMode: GoogleRouteCameraMode }
  | { type: "followingChanged"; following: boolean }
  | { type: "groundingSelected"; groundingMode: GoogleRouteGroundingMode }
  | { type: "zoomRequested"; direction: "in" | "out" }
  | { type: "routeReplaced" };

export function initialReplaySessionState(): ReplaySessionState {
  return initialGoogleRouteNavigatorState();
}

export function reduceReplaySession(
  state: ReplaySessionState,
  event: ReplaySessionEvent,
): ReplaySessionState {
  switch (event.type) {
    case "playbackToggled":
      return { ...state, playing: !state.playing };
    case "frameElapsed":
      return advanceGoogleRouteNavigator(state, event.elapsedSeconds, event.totalDistanceM);
    case "progressSelected":
      return seekGoogleRouteNavigator(state, event.progressM, event.totalDistanceM);
    case "speedCycled":
      return cycleGoogleRouteSpeed(state);
    case "cameraSelected":
      return { ...state, cameraMode: event.cameraMode, following: true };
    case "followingChanged":
      return { ...state, following: event.following };
    case "groundingSelected":
      return { ...state, groundingMode: event.groundingMode };
    case "zoomRequested":
      return zoomGoogleRouteNavigator(state, event.direction);
    case "routeReplaced":
      return initialReplaySessionState();
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Replay session event: ${unhandled}`);
    }
  }
}
