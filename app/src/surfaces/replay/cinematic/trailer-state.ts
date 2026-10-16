import type { GoogleRouteNavigatorStatus } from "../renderers/google-route-navigator-engine";
import type { RouteTrailerFrame } from "./route-trailer-controller";

export type TrailerState = {
  sessionId: number;
  playback: "paused" | "playing";
  status: GoogleRouteNavigatorStatus;
  frame: RouteTrailerFrame;
};
export type TrailerEvent =
  | { type: "sessionStarted"; sessionId: number; frame: RouteTrailerFrame }
  | {
      type: "providerReported";
      sessionId: number;
      status: GoogleRouteNavigatorStatus & { state: "loading" | "unavailable" };
    }
  | {
      type: "providerReady";
      sessionId: number;
      message: string;
      frame: RouteTrailerFrame;
      reducedMotion: boolean;
    }
  | { type: "framePublished"; frame: RouteTrailerFrame }
  | { type: "playbackChanged"; playing: boolean }
  | { type: "restarted"; frame: RouteTrailerFrame }
  | { type: "skipped"; frame: RouteTrailerFrame };

export function initialTrailerState(frame: RouteTrailerFrame): TrailerState {
  return {
    sessionId: 0,
    playback: "paused",
    status: { state: "loading", message: "Preparing the route world." },
    frame,
  };
}
export function reduceTrailer(
  state: TrailerState,
  event: TrailerEvent,
): TrailerState {
  if (
    (event.type === "providerReported" || event.type === "providerReady") &&
    event.sessionId !== state.sessionId
  )
    return state;
  switch (event.type) {
    case "sessionStarted":
      return {
        ...state,
        sessionId: event.sessionId,
        status: initialTrailerState(event.frame).status,
        frame: event.frame,
      };
    case "providerReported":
      return { ...state, status: event.status };
    case "providerReady":
      return {
        ...state,
        status: { state: "ready", message: event.message },
        frame: event.frame,
        playback: event.reducedMotion ? "paused" : "playing",
      };
    case "framePublished":
      return { ...state, frame: event.frame };
    case "playbackChanged":
      return { ...state, playback: event.playing ? "playing" : "paused" };
    case "restarted":
      return { ...state, frame: event.frame, playback: "playing" };
    case "skipped":
      return { ...state, frame: event.frame, playback: "paused" };
  }
}
