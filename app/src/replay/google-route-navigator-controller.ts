import type { QuestRoute } from "@/domain/routes";
import { bearingDegrees, routeDistanceM, routePathPose } from "@/replay/route-path";

export type GoogleRouteCameraMode = "runner" | "chase" | "overview";
export type GoogleRouteGroundingMode = "ground" | "mesh";

export interface GoogleRouteNavigatorState {
  playing: boolean;
  progressM: number;
  speed: number;
  cameraMode: GoogleRouteCameraMode;
  groundingMode: GoogleRouteGroundingMode;
  following: boolean;
  rangeScale: number;
}

export interface GoogleRouteCameraPose {
  center: { lat: number; lng: number };
  headingDeg: number;
  rangeM: number;
  tiltDeg: number;
  fovDeg: number;
  progressM: number;
}

export const GOOGLE_ROUTE_SPEEDS = [0.5, 1, 2, 4] as const;
const REPLAY_DURATION_SECONDS = 210;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function initialGoogleRouteNavigatorState(): GoogleRouteNavigatorState {
  return {
    playing: false,
    progressM: 0,
    speed: 1,
    cameraMode: "chase",
    groundingMode: "mesh",
    following: true,
    rangeScale: 1,
  };
}

export function advanceGoogleRouteNavigator(
  state: GoogleRouteNavigatorState,
  elapsedSeconds: number,
  totalDistanceM: number,
) {
  const elapsed = clamp(elapsedSeconds, 0, 0.1);
  const progressM = state.playing
    ? Math.min(
        totalDistanceM,
        state.progressM +
          (totalDistanceM / REPLAY_DURATION_SECONDS) * state.speed * elapsed,
      )
    : state.progressM;

  return {
    ...state,
    progressM,
    playing: state.playing && progressM < totalDistanceM,
  } satisfies GoogleRouteNavigatorState;
}

export function seekGoogleRouteNavigator(
  state: GoogleRouteNavigatorState,
  progressM: number,
  totalDistanceM: number,
) {
  return {
    ...state,
    progressM: clamp(progressM, 0, totalDistanceM),
  };
}

export function cycleGoogleRouteSpeed(
  state: GoogleRouteNavigatorState,
) {
  const index = GOOGLE_ROUTE_SPEEDS.indexOf(
    state.speed as (typeof GOOGLE_ROUTE_SPEEDS)[number],
  );
  const nextIndex = (Math.max(0, index) + 1) % GOOGLE_ROUTE_SPEEDS.length;
  return { ...state, speed: GOOGLE_ROUTE_SPEEDS[nextIndex] };
}

export function zoomGoogleRouteNavigator(
  state: GoogleRouteNavigatorState,
  direction: "in" | "out",
) {
  return {
    ...state,
    rangeScale: clamp(
      state.rangeScale * (direction === "in" ? 0.78 : 1.28),
      0.55,
      2.4,
    ),
  };
}

export function smoothHeadingDegrees(
  current: number,
  target: number,
  amount = 0.16,
) {
  const delta = ((target - current + 540) % 360) - 180;
  return (current + delta * clamp(amount, 0, 1) + 360) % 360;
}

export function googleRouteCameraPose(
  route: QuestRoute,
  state: GoogleRouteNavigatorState,
): GoogleRouteCameraPose {
  const totalDistanceM = routeDistanceM(route);
  if (state.cameraMode === "overview") {
    return {
      center: { lat: route.centerLat, lng: route.centerLng },
      headingDeg: routePathPose(route, totalDistanceM * 0.25).bearingDeg,
      rangeM: clamp(totalDistanceM * 0.72 * state.rangeScale, 1_400, 26_000),
      tiltDeg: 42,
      fovDeg: 48,
      progressM: state.progressM,
    };
  }

  const profile =
    state.cameraMode === "runner"
      ? { lookAheadM: 14, rangeM: 14, tiltDeg: 82, fovDeg: 68 }
      : { lookAheadM: 90, rangeM: 260, tiltDeg: 65, fovDeg: 54 };
  const current = routePathPose(route, state.progressM);
  const target = routePathPose(
    route,
    Math.min(totalDistanceM, state.progressM + profile.lookAheadM),
  );

  return {
    center: { lat: target.lat, lng: target.lng },
    headingDeg: bearingDegrees(
      { ...current, d: current.progressM },
      { ...target, d: target.progressM },
    ),
    rangeM: profile.rangeM * state.rangeScale,
    tiltDeg: profile.tiltDeg,
    fovDeg: profile.fovDeg,
    progressM: state.progressM,
  };
}

export function densifyGoogleRoutePath(route: QuestRoute, intervalM = 12) {
  const path: Array<{ lat: number; lng: number }> = [];
  for (let index = 0; index < route.route.length - 1; index += 1) {
    const start = route.route[index];
    const end = route.route[index + 1];
    const distance = Math.max(0, end.d - start.d);
    const steps = Math.max(1, Math.ceil(distance / intervalM));
    for (let step = 0; step < steps; step += 1) {
      const ratio = step / steps;
      path.push({
        lat: start.lat + (end.lat - start.lat) * ratio,
        lng: start.lng + (end.lng - start.lng) * ratio,
      });
    }
  }
  const last = route.route.at(-1);
  if (last) path.push({ lat: last.lat, lng: last.lng });
  return path;
}
