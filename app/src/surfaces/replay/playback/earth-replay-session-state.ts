import type { RouteContextHudState } from "@/surfaces/replay/components/route-context-hud";
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
  contextState: RouteContextHudState;
  mobileControlsExpanded: boolean;
}

export type EarthReplayControlEvent =
  | { type: "playbackToggled" }
  | { type: "progressSelected"; progressM: number; totalDistanceM: number }
  | { type: "speedCycled" }
  | { type: "followingToggled" }
  | { type: "zoomRequested"; direction: "in" | "out" };

export type EarthReplayHudEvent =
  | { type: "presentationReset"; isMobile: boolean }
  | { type: "contextChanged"; contextState: RouteContextHudState }
  | { type: "mobileControlsToggled" };

export type EarthReplaySessionEvent =
  | EarthReplayControlEvent
  | EarthReplayHudEvent
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
    contextState: "preview",
    mobileControlsExpanded: false,
  };
}

export function earthReplayOperational(status: ReplayStatus): boolean {
  return status.state === "ready" || status.state === "partial";
}

/**
 * Chrome may yield to the world only while playback runs over an operational
 * scene. Playing is retained through provider loading and unavailable, and
 * the HUD (including Back) must stay reachable over that overlay.
 */
export function earthReplayChromeMayAutoHide(
  state: Pick<EarthReplaySessionState, "control" | "status">,
  { reducedMotion }: { reducedMotion: boolean },
): boolean {
  return !reducedMotion && state.control.playing && earthReplayOperational(state.status);
}

export function reduceEarthReplaySession(
  state: EarthReplaySessionState,
  event: EarthReplaySessionEvent,
): EarthReplaySessionState {
  switch (event.type) {
    case "rendererSelected":
      return state.engineMode === event.mode
        ? state
        : { ...state, engineMode: event.mode, status: initialStatus(event.mode) };
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
    case "playbackToggled": {
      const control = toggleReplay(state.control);
      return {
        ...state,
        control,
        contextState: control.playing ? "compact" : state.contextState,
      };
    }
    case "progressSelected":
      return { ...state, control: seekReplay(state.control, event.progressM, event.totalDistanceM) };
    case "speedCycled":
      return { ...state, control: cycleReplaySpeed(state.control) };
    case "followingToggled":
      return { ...state, control: toggleReplayFollowing(state.control) };
    case "zoomRequested":
      return { ...state, control: zoomReplay(state.control, event.direction) };
    case "presentationReset": {
      const contextState = event.isMobile ? "compact" : "preview";
      return state.contextState === contextState && !state.mobileControlsExpanded
        ? state
        : { ...state, contextState, mobileControlsExpanded: false };
    }
    case "contextChanged":
      return state.contextState === event.contextState
        ? state
        : { ...state, contextState: event.contextState };
    case "mobileControlsToggled":
      return { ...state, mobileControlsExpanded: !state.mobileControlsExpanded };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Earth Replay session event: ${unhandled}`);
    }
  }
}
