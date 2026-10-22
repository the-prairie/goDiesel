import type { Course } from "@/domain/courses";
import {
  initialReplaySessionState,
  reduceReplaySession,
  type ReplaySessionEvent,
  type ReplaySessionState,
} from "@/surfaces/replay/playback/replay-session-state";
import type { GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";

export type CoursePreviewLoadState =
  | { phase: "loading"; operationId: number }
  | { phase: "ready"; course: Course }
  | { phase: "failed"; message: string };

export type CoursePreviewLoadEvent =
  | { type: "loadStarted"; operationId: number }
  | { type: "courseReceived"; operationId: number; course: Course }
  | { type: "loadFailed"; operationId: number; message: string };

export function reduceCoursePreviewLoad(
  state: CoursePreviewLoadState,
  event: CoursePreviewLoadEvent,
): CoursePreviewLoadState {
  switch (event.type) {
    case "loadStarted":
      return { phase: "loading", operationId: event.operationId };
    case "courseReceived":
      return state.phase === "loading" &&
        state.operationId === event.operationId
        ? { phase: "ready", course: event.course }
        : state;
    case "loadFailed":
      return state.phase === "loading" &&
        state.operationId === event.operationId
        ? { phase: "failed", message: event.message }
        : state;
  }
}

export interface CoursePreviewSessionState {
  status: GoogleRouteNavigatorStatus;
  control: ReplaySessionState;
}

export type CoursePreviewSessionEvent =
  | { type: "providerChanged"; status: GoogleRouteNavigatorStatus }
  | { type: "controlRequested"; event: ReplaySessionEvent };

export function initialCoursePreviewSession(): CoursePreviewSessionState {
  return {
    status: { state: "loading", message: "Loading the 3D map." },
    control: { ...initialReplaySessionState(), cameraMode: "chase" },
  };
}

export function reduceCoursePreviewSession(
  state: CoursePreviewSessionState,
  event: CoursePreviewSessionEvent,
): CoursePreviewSessionState {
  switch (event.type) {
    case "providerChanged":
      return {
        status: event.status,
        control:
          event.status.state === "ready"
            ? state.control
            : { ...state.control, playing: false },
      };
    case "controlRequested":
      return state.status.state === "ready"
        ? { ...state, control: reduceReplaySession(state.control, event.event) }
        : state;
  }
}
