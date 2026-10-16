import type { CinematicRendererStatus } from "@/surfaces/replay/cinematic/cesium-cinematic-renderer";
import type { CinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";

export interface CinematicDirectorState {
  frame: CinematicFrame;
  playback: "paused" | "playing";
  audioStart: { state: "idle" } | { state: "pending"; requestId: number };
  soundEnabled: boolean;
  status: CinematicRendererStatus;
}

export type CinematicDirectorEvent =
  | { type: "sessionStarted"; frame: CinematicFrame }
  | { type: "rendererStatusReceived"; status: CinematicRendererStatus }
  | { type: "cutSelected" | "seeked"; frame: CinematicFrame }
  | { type: "framePublished" | "restartRequested"; frame: CinematicFrame }
  | { type: "playRequested" | "audioStarted" | "audioStartFailed"; requestId: number }
  | { type: "playbackPaused" }
  | { type: "soundToggled" };

export function initialCinematicDirectorState(frame: CinematicFrame): CinematicDirectorState {
  return {
    frame,
    playback: "paused",
    audioStart: { state: "idle" },
    soundEnabled: true,
    status: { state: "loading", message: "Scouting the route." },
  };
}

export function reduceCinematicDirector(
  state: CinematicDirectorState,
  event: CinematicDirectorEvent,
): CinematicDirectorState {
  switch (event.type) {
    case "sessionStarted":
      return { ...state, frame: event.frame, audioStart: { state: "idle" }, status: initialCinematicDirectorState(event.frame).status };
    case "rendererStatusReceived":
      return { ...state, status: event.status };
    case "cutSelected":
    case "seeked":
      return { ...state, frame: event.frame, playback: "paused", audioStart: { state: "idle" } };
    case "framePublished":
    case "restartRequested":
      return { ...state, frame: event.frame };
    case "playRequested":
      return { ...state, audioStart: { state: "pending", requestId: event.requestId } };
    case "audioStarted":
    case "audioStartFailed":
      if (state.audioStart.state !== "pending" || state.audioStart.requestId !== event.requestId) return state;
      return {
        ...state,
        playback: event.type === "audioStarted" ? "playing" : state.playback,
        audioStart: { state: "idle" },
      };
    case "playbackPaused":
      return { ...state, playback: "paused", audioStart: { state: "idle" } };
    case "soundToggled":
      return { ...state, soundEnabled: !state.soundEnabled };
  }
}
