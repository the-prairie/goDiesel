import type { QuestRoute } from "@/domain/routes";
import {
  routeDistanceM,
  routePathPose,
  type RoutePathPose,
} from "@/domain/geometry/route-path";

export interface ReplayControlState {
  playing: boolean;
  progressM: number;
  speed: number;
  following: boolean;
  cameraRangeM: number;
}

export interface ReplayPose extends RoutePathPose {
  following: boolean;
  cameraRangeM: number;
}

const REPLAY_DURATION_SECONDS = 180;
export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export const REPLAY_CAMERA_RANGES_M = [120, 240, 720, 1_400] as const;

export function initialReplayState(): ReplayControlState {
  return {
    playing: false,
    progressM: 0,
    speed: 1,
    following: true,
    cameraRangeM: 240,
  };
}

export function advanceReplay(
  state: ReplayControlState,
  elapsedSeconds: number,
  totalDistanceM: number,
): ReplayControlState {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  const progressM = Math.min(
    totalDistanceM,
    state.progressM +
      (state.playing
        ? (totalDistanceM / REPLAY_DURATION_SECONDS) * state.speed * elapsed
        : 0),
  );
  return {
    ...state,
    playing: state.playing && progressM < totalDistanceM,
    progressM,
  };
}

export function toggleReplay(state: ReplayControlState): ReplayControlState {
  return { ...state, playing: !state.playing };
}

export function seekReplay(
  state: ReplayControlState,
  progressM: number,
  totalDistanceM: number,
): ReplayControlState {
  const boundedProgressM = Math.min(totalDistanceM, Math.max(0, progressM));
  return {
    ...state,
    progressM: boundedProgressM,
    playing: boundedProgressM < totalDistanceM && state.playing,
  };
}

export function cycleReplaySpeed(state: ReplayControlState): ReplayControlState {
  const index = REPLAY_SPEEDS.indexOf(
    state.speed as (typeof REPLAY_SPEEDS)[number],
  );
  return {
    ...state,
    speed: REPLAY_SPEEDS[(Math.max(0, index) + 1) % REPLAY_SPEEDS.length],
  };
}

export function toggleReplayFollowing(state: ReplayControlState): ReplayControlState {
  return { ...state, following: !state.following };
}

export function zoomReplay(
  state: ReplayControlState,
  direction: "in" | "out",
): ReplayControlState {
  const index = REPLAY_CAMERA_RANGES_M.indexOf(
    state.cameraRangeM as (typeof REPLAY_CAMERA_RANGES_M)[number],
  );
  const normalizedIndex = index < 0 ? 1 : index;
  const nextIndex = Math.min(
    REPLAY_CAMERA_RANGES_M.length - 1,
    Math.max(0, normalizedIndex + (direction === "in" ? -1 : 1)),
  );
  return { ...state, cameraRangeM: REPLAY_CAMERA_RANGES_M[nextIndex] };
}

export function replayPose(route: QuestRoute, state: ReplayControlState): ReplayPose {
  return {
    ...routePathPose(route, state.progressM),
    following: state.following,
    cameraRangeM: state.cameraRangeM,
  };
}

export { routeDistanceM } from "@/domain/geometry/route-path";
