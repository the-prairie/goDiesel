import {
  initialReplaySessionState,
  reduceReplaySession,
  type ReplaySessionEvent,
  type ReplaySessionState,
} from "@/surfaces/replay/playback/replay-session-state";
import type {
  ReplayChapterControlsEvent,
  ReplayChapterControlsState,
} from "@/surfaces/replay/playback/replay-chapter-controls-state";
import type { GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";

/**
 * One mounted Google Replay stage: the provider status reported by its
 * engine, the playback/camera command state, and the two disclosures whose
 * lifetime is the session. Unlike course preview, commands are accepted in
 * every provider phase, so Space pressed while loading starts playback once
 * the world is ready. The frame driver only advances while the stage is ready.
 */
export interface GoogleReplayStageState {
  sessionId: number;
  status: GoogleRouteNavigatorStatus;
  control: ReplaySessionState;
  settingsOpen: boolean;
  chaptersExpanded: boolean;
}

export type GoogleReplayStageEvent =
  | { type: "sessionStarted" }
  | { type: "statusReceived"; sessionId: number; status: GoogleRouteNavigatorStatus }
  | { type: "controlRequested"; event: ReplaySessionEvent }
  | { type: "settingsOpenChanged"; open: boolean }
  | { type: "chaptersExpandedChanged"; expanded: boolean };

export const GOOGLE_REPLAY_INITIAL_STATUS: GoogleRouteNavigatorStatus = {
  state: "loading",
  message: "Preparing the native Google 3D route world.",
};

export function initialGoogleReplayStageState(): GoogleReplayStageState {
  return {
    sessionId: 0,
    status: GOOGLE_REPLAY_INITIAL_STATUS,
    control: initialReplaySessionState(),
    settingsOpen: false,
    chaptersExpanded: false,
  };
}

export function reduceGoogleReplayStage(
  state: GoogleReplayStageState,
  event: GoogleReplayStageEvent,
): GoogleReplayStageState {
  switch (event.type) {
    case "sessionStarted":
      return {
        sessionId: state.sessionId + 1,
        status: GOOGLE_REPLAY_INITIAL_STATUS,
        control: reduceReplaySession(state.control, { type: "routeReplaced" }),
        settingsOpen: false,
        chaptersExpanded: false,
      };
    case "statusReceived":
      if (event.sessionId !== state.sessionId) return state;
      return {
        ...state,
        status: event.status,
        settingsOpen: event.status.state === "unavailable" ? false : state.settingsOpen,
      };
    case "controlRequested":
      return { ...state, control: reduceReplaySession(state.control, event.event) };
    case "settingsOpenChanged":
      return state.settingsOpen === event.open ? state : { ...state, settingsOpen: event.open };
    case "chaptersExpandedChanged":
      return state.chaptersExpanded === event.expanded ? state : { ...state, chaptersExpanded: event.expanded };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Google Replay stage event: ${unhandled}`);
    }
  }
}

/** A user intent that touches both the session and the chapter browser. */
export type GoogleReplayIntent =
  | { type: "playbackToggled" }
  | { type: "chapterBrowsed"; event: ReplayChapterControlsEvent }
  | { type: "previewPlayed"; totalDistanceM: number }
  | { type: "seekRequested"; progressM: number; totalDistanceM: number };

export interface GoogleReplayIntentEvents {
  control: ReplaySessionEvent[];
  chapters: ReplayChapterControlsEvent[];
}

/**
 * The one place that keeps the chapter browser and the session consistent:
 * previewing a chapter or moment implies a paused session, and leaving a
 * preview (playback, play-from-here, a full-route seek) returns the browser to
 * following. Browsing and play-from-here need a ready provider; playback and
 * seeking do not, so play intent survives provider loading.
 */
export function googleReplayIntentEvents(
  stage: Pick<GoogleReplayStageState, "status" | "control">,
  chapters: ReplayChapterControlsState,
  intent: GoogleReplayIntent,
): GoogleReplayIntentEvents {
  const ready = stage.status.state === "ready";
  switch (intent.type) {
    case "playbackToggled":
      return { control: [{ type: "playbackToggled" }], chapters: [{ type: "replayReturned" }] };
    case "chapterBrowsed": {
      const { event } = intent;
      if (event.type !== "chapterSelected" && event.type !== "momentSelected" && event.type !== "previewMoved") {
        return { control: [], chapters: [event] };
      }
      if (!ready) return { control: [], chapters: [] };
      return {
        control: stage.control.playing ? [{ type: "playbackToggled" }] : [],
        chapters: [event],
      };
    }
    case "previewPlayed": {
      if (!ready || chapters.mode !== "preview") return { control: [], chapters: [] };
      const seek: ReplaySessionEvent = {
        type: "progressSelected",
        progressM: chapters.progressM,
        totalDistanceM: intent.totalDistanceM,
      };
      const sought = reduceReplaySession(stage.control, seek);
      const start = !sought.playing && sought.progressM < intent.totalDistanceM;
      return {
        control: start ? [seek, { type: "playbackToggled" }] : [seek],
        chapters: [{ type: "replayReturned" }],
      };
    }
    case "seekRequested":
      return {
        control: [{ type: "progressSelected", progressM: intent.progressM, totalDistanceM: intent.totalDistanceM }],
        chapters: [{ type: "replayReturned" }],
      };
    default: {
      const unhandled: never = intent;
      throw new Error(`Unhandled Google Replay intent: ${unhandled}`);
    }
  }
}
