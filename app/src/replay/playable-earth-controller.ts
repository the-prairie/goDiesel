import type { QuestRoute, RoutePoint } from "@/domain/routes";

export type PlayableEarthMode = "replay" | "guided";

export interface PlayableEarthControlState {
  mode: PlayableEarthMode;
  playing: boolean;
  progressM: number;
  speed: number;
  lateralOffsetM: number;
  cameraYawDeg: number;
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
}

export const PLAYABLE_EARTH_SPEEDS = [0.5, 1, 2, 4] as const;
export const PLAYABLE_EARTH_CORRIDOR_M = 15;
const REPLAY_DURATION_SECONDS = 180;

export function routeDistanceM(route: QuestRoute) {
  return Math.max(
    route.distanceKm * 1000,
    route.route.at(-1)?.d ?? 0,
    1,
  );
}

export function initialPlayableEarthState(): PlayableEarthControlState {
  return {
    mode: "replay",
    playing: false,
    progressM: 0,
    speed: 1,
    lateralOffsetM: 0,
    cameraYawDeg: 0,
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

function pointAtDistance(points: RoutePoint[], progressM: number) {
  if (points.length === 1) return { point: points[0], next: points[0] };
  let upper = points.findIndex((point) => point.d >= progressM);
  if (upper <= 0) upper = 1;
  if (upper < 0) upper = points.length - 1;
  const start = points[upper - 1];
  const end = points[upper];
  const span = Math.max(1, end.d - start.d);
  const ratio = clamp((progressM - start.d) / span, 0, 1);
  return {
    point: {
      lat: start.lat + (end.lat - start.lat) * ratio,
      lng: start.lng + (end.lng - start.lng) * ratio,
      elev: start.elev + (end.elev - start.elev) * ratio,
      d: progressM,
    },
    next: end,
  };
}

function bearingDegrees(from: RoutePoint, to: RoutePoint) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function playableEarthPose(
  route: QuestRoute,
  state: PlayableEarthControlState,
): PlayableEarthPose {
  const totalDistanceM = routeDistanceM(route);
  const { point, next } = pointAtDistance(route.route, state.progressM);
  const bearingDeg = bearingDegrees(point, next);
  const rightBearing = ((bearingDeg + 90) * Math.PI) / 180;
  const northM = Math.cos(rightBearing) * state.lateralOffsetM;
  const eastM = Math.sin(rightBearing) * state.lateralOffsetM;
  const lat = point.lat + northM / 111_320;
  const lng =
    point.lng +
    eastM /
      (111_320 * Math.max(0.2, Math.cos((point.lat * Math.PI) / 180)));

  return {
    lat,
    lng,
    elev: point.elev,
    bearingDeg,
    cameraHeadingDeg: bearingDeg + state.cameraYawDeg,
    progressM: state.progressM,
    progressRatio: state.progressM / totalDistanceM,
    lateralOffsetM: state.lateralOffsetM,
  };
}
