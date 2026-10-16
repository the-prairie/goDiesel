import type { CinematicRendererStatus } from "@/surfaces/replay/cinematic/cesium-cinematic-renderer";
import type { CinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";

export interface CinematicDirectorState {
  frame: CinematicFrame;
  playback: "paused" | "playing";
  soundEnabled: boolean;
  status: CinematicRendererStatus;
}

export type CinematicDirectorEvent =
  | { type: "sessionStarted"; frame: CinematicFrame }
  | { type: "rendererStatusReceived"; status: CinematicRendererStatus }
  | { type: "cutSelected" | "seeked"; frame: CinematicFrame }
  | { type: "framePublished" | "restartRequested"; frame: CinematicFrame }
  | { type: "playbackStarted" | "playbackPaused" }
  | { type: "soundToggled" };

export function initialCinematicDirectorState(frame: CinematicFrame): CinematicDirectorState {
  return {
    frame,
    playback: "paused",
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
      return { ...state, frame: event.frame, status: initialCinematicDirectorState(event.frame).status };
    case "rendererStatusReceived":
      return { ...state, status: event.status };
    case "cutSelected":
    case "seeked":
      return { ...state, frame: event.frame, playback: "paused" };
    case "framePublished":
    case "restartRequested":
      return { ...state, frame: event.frame };
    case "playbackStarted":
      return { ...state, playback: "playing" };
    case "playbackPaused":
      return { ...state, playback: "paused" };
    case "soundToggled":
      return { ...state, soundEnabled: !state.soundEnabled };
  }
}
