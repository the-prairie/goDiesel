import type { RouteContextHudState } from "@/surfaces/replay/components/route-context-hud";
import {
  initialPlayableEarthState,
  type PlayableEarthControlState,
} from "./playable-earth-controller";
import type {
  PlayableEarthGroundingDebug,
  PlayableEarthStatus,
} from "./playable-earth-viewer";

export interface PlayableEarthSessionState {
  sessionId: number;
  status: PlayableEarthStatus;
  grounding: PlayableEarthGroundingDebug;
  control: PlayableEarthControlState;
  contextState: RouteContextHudState;
  mobileControlsExpanded: boolean;
}

export type PlayableEarthSessionEvent =
  | { type: "sessionStarted"; sessionId: number }
  | { type: "providerReported"; sessionId: number; status: PlayableEarthStatus }
  | {
      type: "groundingReported";
      sessionId: number;
      grounding: PlayableEarthGroundingDebug;
    }
  | { type: "controlPublished"; control: PlayableEarthControlState }
  | { type: "presentationReset"; isMobile: boolean }
  | { type: "contextChanged"; contextState: RouteContextHudState }
  | { type: "controlsToggled" };

export function initialPlayableEarthSessionState(): PlayableEarthSessionState {
  return {
    sessionId: 0,
    status: {
      state: "loading",
      title: "Building your route world",
      message: "Preparing the experimental Earth viewer.",
    },
    grounding: { source: "fallback", reason: "recorded" },
    control: initialPlayableEarthState(),
    contextState: "preview",
    mobileControlsExpanded: false,
  };
}

export function reducePlayableEarthSession(
  state: PlayableEarthSessionState,
  event: PlayableEarthSessionEvent,
): PlayableEarthSessionState {
  switch (event.type) {
    case "sessionStarted": {
      const initial = initialPlayableEarthSessionState();
      return {
        ...state,
        sessionId: event.sessionId,
        status: initial.status,
        grounding: initial.grounding,
        control: initial.control,
      };
    }
    case "providerReported":
      return event.sessionId === state.sessionId
        ? { ...state, status: event.status }
        : state;
    case "groundingReported":
      return event.sessionId === state.sessionId
        ? { ...state, grounding: event.grounding }
        : state;
    case "controlPublished":
      return {
        ...state,
        control: event.control,
        contextState:
          !state.control.playing && event.control.playing
            ? "compact"
            : state.contextState,
      };
    case "presentationReset":
      return {
        ...state,
        contextState: event.isMobile ? "compact" : "preview",
        mobileControlsExpanded: false,
      };
    case "contextChanged":
      return { ...state, contextState: event.contextState };
    case "controlsToggled":
      return {
        ...state,
        mobileControlsExpanded: !state.mobileControlsExpanded,
      };
  }
}
