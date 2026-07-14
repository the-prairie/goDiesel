import type { QuestRoute } from "@/domain/routes";
import { routeDistanceM, routePathPose } from "@/replay/route-path";

export type PlayableEarthMode = "replay" | "guided";

export interface PlayableEarthControlState {
  mode: PlayableEarthMode;
  playing: boolean;
  progressM: number;
  speed: number;
  lateralOffsetM: number;
  cameraYawDeg: number;
  cameraRangeM: number;
}

export interface PlayableEarthInput {
  steer: -1 | 0 | 1;
  look: -1 | 0 | 1;
}

export interface PlayableEarthPose {
  lat: number;
  lng: number;
  elev: number;
  bearingDeg: number;
  cameraHeadingDeg: number;
  progressM: number;
  progressRatio: number;
  lateralOffsetM: number;
  cameraRangeM: number;
}

export type PlayableEarthGroundingSource = "fallback" | "sampled";
export type PlayableEarthGroundingReason =
  | "recorded"
  | "sampled"
  | "missing"
  | "outlier";

export type PlayableEarthGroundingObservation =
  | { kind: "sample"; heightM: number }
  | { kind: "missing" };

export interface PlayableEarthGroundingState {
  displayedHeightM: number;
  stableOffsetM?: number;
  source: PlayableEarthGroundingSource;
  reason: PlayableEarthGroundingReason;
}

export const PLAYABLE_EARTH_SPEEDS = [0.5, 1, 2, 4] as const;
export const PLAYABLE_EARTH_CORRIDOR_M = 15;
export const PLAYABLE_EARTH_CAMERA_RANGES_M = [120, 240, 720, 1_400] as const;
export const PLAYABLE_EARTH_DEFAULT_CAMERA_RANGE_M = 720;
const REPLAY_DURATION_SECONDS = 180;
const MAX_INITIAL_SURFACE_OFFSET_M = 300;
const MAX_SURFACE_OFFSET_CHANGE_M = 15;
const MAX_GROUNDING_SPEED_M_PER_SECOND = 24;

export { routeDistanceM } from "@/replay/route-path";

export function initialPlayableEarthState(): PlayableEarthControlState {
  return {
    mode: "replay",
    playing: false,
    progressM: 0,
    speed: 1,
    lateralOffsetM: 0,
    cameraYawDeg: 0,
    cameraRangeM: PLAYABLE_EARTH_DEFAULT_CAMERA_RANGE_M,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function approach(value: number, target: number, amount: number) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

export function initialPlayableEarthGrounding(
  recordedHeightM: number,
): PlayableEarthGroundingState {
  return {
    displayedHeightM: recordedHeightM,
    source: "fallback",
    reason: "recorded",
  };
}

export function advancePlayableEarthGrounding(
  state: PlayableEarthGroundingState,
  recordedHeightM: number,
  elapsedSeconds: number,
  observation?: PlayableEarthGroundingObservation,
): PlayableEarthGroundingState {
  let source = state.source;
  let reason = state.reason;
  let stableOffsetM = state.stableOffsetM;

  if (observation?.kind === "missing") {
    source = "fallback";
    reason = "missing";
  } else if (observation?.kind === "sample") {
    const sampledOffsetM = observation.heightM - recordedHeightM;
    const plausibleInitialOffset =
      Number.isFinite(sampledOffsetM) &&
      Math.abs(sampledOffsetM) <= MAX_INITIAL_SURFACE_OFFSET_M;
    const plausibleOffsetChange =
      stableOffsetM === undefined ||
      Math.abs(sampledOffsetM - stableOffsetM) <= MAX_SURFACE_OFFSET_CHANGE_M;

    if (plausibleInitialOffset && plausibleOffsetChange) {
      stableOffsetM =
        stableOffsetM === undefined
          ? sampledOffsetM
          : stableOffsetM + (sampledOffsetM - stableOffsetM) * 0.25;
      source = "sampled";
      reason = "sampled";
    } else {
      source = "fallback";
      reason = "outlier";
    }
  }

  const targetHeightM =
    source === "sampled" && stableOffsetM !== undefined
      ? recordedHeightM + stableOffsetM
      : recordedHeightM;
  const elapsed = clamp(elapsedSeconds, 0, 0.25);
  const displayedHeightM = approach(
    state.displayedHeightM,
    targetHeightM,
    MAX_GROUNDING_SPEED_M_PER_SECOND * elapsed,
  );

  return {
    displayedHeightM,
    stableOffsetM,
    source,
    reason,
  };
}

export function advancePlayableEarth(
  state: PlayableEarthControlState,
  elapsedSeconds: number,
  input: PlayableEarthInput,
  totalDistanceM: number,
) {
  const elapsed = clamp(elapsedSeconds, 0, 0.1);
  const guided = state.mode === "guided";
  const progressDelta = state.playing
    ? (totalDistanceM / REPLAY_DURATION_SECONDS) * state.speed * elapsed
    : 0;
  const progressM = Math.min(totalDistanceM, state.progressM + progressDelta);
  const playing = state.playing && progressM < totalDistanceM;

  return {
    ...state,
    playing,
    progressM,
    lateralOffsetM: guided
      ? clamp(
          state.lateralOffsetM + input.steer * elapsed * 9,
          -PLAYABLE_EARTH_CORRIDOR_M,
          PLAYABLE_EARTH_CORRIDOR_M,
        )
      : approach(state.lateralOffsetM, 0, elapsed * 12),
    cameraYawDeg: guided
      ? clamp(state.cameraYawDeg + input.look * elapsed * 42, -65, 65)
      : approach(state.cameraYawDeg, 0, elapsed * 55),
  } satisfies PlayableEarthControlState;
}

export function setPlayableEarthMode(
  state: PlayableEarthControlState,
  mode: PlayableEarthMode,
) {
  return { ...state, mode };
}

export function togglePlayableEarthPlayback(state: PlayableEarthControlState) {
  return { ...state, playing: !state.playing };
}

export function cyclePlayableEarthSpeed(
  state: PlayableEarthControlState,
  direction: 1 | -1 = 1,
) {
  const index = PLAYABLE_EARTH_SPEEDS.indexOf(
    state.speed as (typeof PLAYABLE_EARTH_SPEEDS)[number],
  );
  const nextIndex =
    (Math.max(0, index) + direction + PLAYABLE_EARTH_SPEEDS.length) %
    PLAYABLE_EARTH_SPEEDS.length;
  return { ...state, speed: PLAYABLE_EARTH_SPEEDS[nextIndex] };
}

export function zoomPlayableEarth(
  state: PlayableEarthControlState,
  direction: "in" | "out",
) {
  const currentIndex = PLAYABLE_EARTH_CAMERA_RANGES_M.indexOf(
    state.cameraRangeM as (typeof PLAYABLE_EARTH_CAMERA_RANGES_M)[number],
  );
  const normalizedIndex = currentIndex < 0 ? 2 : currentIndex;
  const nextIndex = clamp(
    normalizedIndex + (direction === "in" ? -1 : 1),
    0,
    PLAYABLE_EARTH_CAMERA_RANGES_M.length - 1,
  );
  return {
    ...state,
    cameraRangeM: PLAYABLE_EARTH_CAMERA_RANGES_M[nextIndex],
  };
}

export function seekPlayableEarth(
  state: PlayableEarthControlState,
  progressM: number,
  totalDistanceM: number,
) {
  return {
    ...state,
    progressM: clamp(progressM, 0, totalDistanceM),
    playing: progressM < totalDistanceM && state.playing,
  };
}

export function playableEarthPose(
  route: QuestRoute,
  state: PlayableEarthControlState,
): PlayableEarthPose {
  const totalDistanceM = routeDistanceM(route);
  const routePose = routePathPose(route, state.progressM);
  const bearingDeg = routePose.bearingDeg;
  const rightBearing = ((bearingDeg + 90) * Math.PI) / 180;
  const northM = Math.cos(rightBearing) * state.lateralOffsetM;
  const eastM = Math.sin(rightBearing) * state.lateralOffsetM;
  const lat = routePose.lat + northM / 111_320;
  const lng =
    routePose.lng +
    eastM /
      (111_320 * Math.max(0.2, Math.cos((routePose.lat * Math.PI) / 180)));

  return {
    lat,
    lng,
    elev: routePose.elev,
    bearingDeg,
    cameraHeadingDeg: bearingDeg + state.cameraYawDeg,
    progressM: routePose.progressM,
    progressRatio: routePose.progressM / totalDistanceM,
    lateralOffsetM: state.lateralOffsetM,
    cameraRangeM: state.cameraRangeM,
  };
}
