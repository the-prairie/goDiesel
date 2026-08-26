import type { QuestRoute } from "@/domain/route";
import { routeDistanceM, routePathPose } from "@/domain/geometry/route-path";
import {
  advanceRouteGrounding,
  initialRouteGrounding,
  type RouteGroundingObservation,
  type RouteGroundingReason,
  type RouteGroundingSource,
  type RouteGroundingState,
} from "@/surfaces/replay/scene/route-grounding";
import {
  worldPlayerGeodetic,
  type WorldPhysicsRuntime,
  type WorldPlayerState,
} from "@/world-packs/world-physics";

export type PlayableEarthMode = "replay" | "guided" | "free-roam";
export type PlayableEarthCameraMode = "route-follow" | "chase" | "first-person";

export interface PlayableEarthControlState {
  mode: PlayableEarthMode;
  playing: boolean;
  progressM: number;
  speed: number;
  lateralOffsetM: number;
  cameraYawDeg: number;
  cameraRangeM: number;
  cameraMode: PlayableEarthCameraMode;
  ghostProgressM: number;
  ghostVisible: boolean;
}

export interface PlayableEarthInput {
  steer: -1 | 0 | 1;
  look: -1 | 0 | 1;
  forward?: -1 | 0 | 1;
  strafe?: -1 | 0 | 1;
  turn?: -1 | 0 | 1;
  run?: boolean;
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
  cameraMode: PlayableEarthCameraMode;
  ghost?: {
    lat: number;
    lng: number;
    elev: number;
    visible: boolean;
  };
}

export const PLAYABLE_EARTH_SPEEDS = [0.5, 1, 2, 4] as const;
export const PLAYABLE_EARTH_CORRIDOR_M = 15;
export const PLAYABLE_EARTH_CAMERA_RANGES_M = [120, 240, 720, 1_400] as const;
export const PLAYABLE_EARTH_DEFAULT_CAMERA_RANGE_M = 720;
const REPLAY_DURATION_SECONDS = 180;

export { routeDistanceM } from "@/domain/geometry/route-path";

export function initialPlayableEarthState(): PlayableEarthControlState {
  return {
    mode: "replay",
    playing: false,
    progressM: 0,
    speed: 1,
    lateralOffsetM: 0,
    cameraYawDeg: 0,
    cameraRangeM: PLAYABLE_EARTH_DEFAULT_CAMERA_RANGE_M,
    cameraMode: "route-follow",
    ghostProgressM: 0,
    ghostVisible: false,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function approach(value: number, target: number, amount: number) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

export function advancePlayableEarth(
  state: PlayableEarthControlState,
  elapsedSeconds: number,
  input: PlayableEarthInput,
  totalDistanceM: number,
) {
  const elapsed = clamp(elapsedSeconds, 0, 0.1);
  const guided = state.mode === "guided";
  const routeLocked = state.mode !== "free-roam";
  const progressDelta = state.playing
    ? (totalDistanceM / REPLAY_DURATION_SECONDS) * state.speed * elapsed
    : 0;
  const progressM = routeLocked
    ? Math.min(totalDistanceM, state.progressM + progressDelta)
    : state.progressM;
  const ghostProgressM = Math.min(
    totalDistanceM,
    state.ghostProgressM + progressDelta,
  );
  const playing =
    state.playing &&
    (routeLocked ? progressM < totalDistanceM : ghostProgressM < totalDistanceM);

  return {
    ...state,
    playing,
    progressM,
    ghostProgressM,
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

export function setPlayableEarthCameraMode(
  state: PlayableEarthControlState,
  cameraMode: PlayableEarthCameraMode,
) {
  return { ...state, cameraMode };
}

export function cyclePlayableEarthCameraMode(state: PlayableEarthControlState) {
  const modes: PlayableEarthCameraMode[] = [
    "route-follow",
    "chase",
    "first-person",
  ];
  const index = modes.indexOf(state.cameraMode);
  return { ...state, cameraMode: modes[(index + 1) % modes.length] };
}

export function togglePlayableEarthGhost(state: PlayableEarthControlState) {
  return { ...state, ghostVisible: !state.ghostVisible };
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
    ghostProgressM: clamp(progressM, 0, totalDistanceM),
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
  const ghostPose = routePathPose(route, state.ghostProgressM);

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
    cameraMode: state.cameraMode,
    ghost: {
      lat: ghostPose.lat,
      lng: ghostPose.lng,
      elev: ghostPose.elev,
      visible: state.ghostVisible,
    },
  };
}

export function playableEarthWorldPose(
  route: QuestRoute,
  runtime: WorldPhysicsRuntime,
  player: WorldPlayerState,
  state: PlayableEarthControlState,
): PlayableEarthPose {
  const position = worldPlayerGeodetic(runtime, player);
  const ghostPose = routePathPose(route, state.ghostProgressM);
  const totalDistanceM = routeDistanceM(route);
  return {
    lat: position.latitude,
    lng: position.longitude,
    elev: position.elevationM,
    bearingDeg: player.headingDeg,
    cameraHeadingDeg: player.headingDeg + state.cameraYawDeg,
    progressM: player.routeProgressM,
    progressRatio: player.routeProgressM / totalDistanceM,
    lateralOffsetM: 0,
    cameraRangeM: state.cameraRangeM,
    cameraMode: state.cameraMode,
    ghost: {
      lat: ghostPose.lat,
      lng: ghostPose.lng,
      elev: ghostPose.elev,
      visible: state.ghostVisible,
    },
  };
}

// Grounding now lives in @/replay/route-grounding so production engines do not
// import from the lab. These aliases keep the existing lab call sites unchanged.
export type PlayableEarthGroundingSource = RouteGroundingSource;
export type PlayableEarthGroundingReason = RouteGroundingReason;
export type PlayableEarthGroundingObservation = RouteGroundingObservation;
export type PlayableEarthGroundingState = RouteGroundingState;
export const initialPlayableEarthGrounding = initialRouteGrounding;
export const advancePlayableEarthGrounding = advanceRouteGrounding;
