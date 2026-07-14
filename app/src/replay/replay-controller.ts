import type { QuestRoute } from "@/domain/routes";
import {
  routeDistanceM,
  routePathPose,
  type RoutePathPose,
} from "@/replay/route-path";

export interface ReplayControlState {
  playing: boolean;
  progressM: number;
}

export type ReplayPose = RoutePathPose;

const REPLAY_DURATION_SECONDS = 180;

export function initialReplayState(): ReplayControlState {
  return { playing: false, progressM: 0 };
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
      (state.playing ? (totalDistanceM / REPLAY_DURATION_SECONDS) * elapsed : 0),
  );
  return {
    playing: state.playing && progressM < totalDistanceM,
    progressM,
  };
}

export function toggleReplay(state: ReplayControlState): ReplayControlState {
  return { ...state, playing: !state.playing };
}

export function replayPose(route: QuestRoute, state: ReplayControlState): ReplayPose {
  return routePathPose(route, state.progressM);
}

export { routeDistanceM } from "@/replay/route-path";
