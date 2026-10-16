import type { ReplayEngineMode, ReplayStatus } from "@/surfaces/replay/renderer-port";
import {
  advanceReplay,
  cycleReplaySpeed,
  initialReplayState,
  seekReplay,
  toggleReplay,
  toggleReplayFollowing,
  zoomReplay,
  type ReplayControlState,
} from "@/surfaces/replay/playback/replay-controller";

export interface EarthReplaySessionState {
  routeSlug: string | undefined;
  engineMode: ReplayEngineMode;
  status: ReplayStatus;
  control: ReplayControlState;
  sessionId: number;
}

export type EarthReplayControlEvent =
  | { type: "playbackToggled" }
  | { type: "progressSelected"; progressM: number; totalDistanceM: number }
  | { type: "speedCycled" }
  | { type: "followingToggled" }
  | { type: "zoomRequested"; direction: "in" | "out" };

export type EarthReplaySessionEvent =
  | EarthReplayControlEvent
  | { type: "rendererSelected"; mode: ReplayEngineMode }
  | { type: "rendererMounted"; routeSlug: string }
  | { type: "statusReceived"; sessionId: number; status: ReplayStatus }
  | { type: "frameElapsed"; elapsedSeconds: number; totalDistanceM: number };

function initialStatus(mode: ReplayEngineMode): ReplayStatus {
  return mode === "earth"
    ? {
        state: "loading",
        title: "Building your route world",
        message: "Preparing the bundled Earth engine.",
      }
    : {
        state: "loading",
        title: "Opening Atlas replay",
        message: "Preparing the fallback route map.",
      };
}

export function initialEarthReplaySessionState(mode: ReplayEngineMode): EarthReplaySessionState {
  return {
    routeSlug: undefined,
    engineMode: mode,
    status: initialStatus(mode),
    control: initialReplayState(),
    sessionId: 0,
  };
}

export function earthReplayOperational(status: ReplayStatus): boolean {
  return status.state === "ready" || status.state === "partial";
}

export function reduceEarthReplaySession(
  state: EarthReplaySessionState,
  event: EarthReplaySessionEvent,
): EarthReplaySessionState {
  switch (event.type) {
    case "rendererSelected":
      return state.engineMode === event.mode ? state : { ...state, engineMode: event.mode };
    case "rendererMounted":
      return {
        ...state,
        routeSlug: event.routeSlug,
        sessionId: state.sessionId + 1,
        status: initialStatus(state.engineMode),
        control: state.routeSlug === event.routeSlug ? state.control : initialReplayState(),
      };
    case "statusReceived":
      return event.sessionId === state.sessionId ? { ...state, status: event.status } : state;
    case "frameElapsed":
      return earthReplayOperational(state.status)
        ? { ...state, control: advanceReplay(state.control, event.elapsedSeconds, event.totalDistanceM) }
        : state;
    case "playbackToggled":
      return { ...state, control: toggleReplay(state.control) };
    case "progressSelected":
      return { ...state, control: seekReplay(state.control, event.progressM, event.totalDistanceM) };
    case "speedCycled":
      return { ...state, control: cycleReplaySpeed(state.control) };
    case "followingToggled":
      return { ...state, control: toggleReplayFollowing(state.control) };
    case "zoomRequested":
      return { ...state, control: zoomReplay(state.control, event.direction) };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Earth Replay session event: ${unhandled}`);
    }
  }
}
