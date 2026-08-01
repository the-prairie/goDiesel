import type { QuestRoute, RoutePoint } from "@/domain/routes";
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
  center: { lat: number; lng: number; altitude?: number };
  headingDeg: number;
  rangeM: number;
  tiltDeg: number;
  fovDeg: number;
  progressM: number;
}

export interface GoogleRouteTelemetry {
  elapsedS: number;
  paceSPerKm?: number;
  elevationM: number;
  gradePercent: number;
  headingDeg: number;
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
    const midpoint = routePathPose(route, totalDistanceM * 0.5);
    return {
      center: {
        lat: route.centerLat,
        lng: route.centerLng,
        altitude: midpoint.elev,
      },
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
    center: { lat: target.lat, lng: target.lng, altitude: target.elev },
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

export function googleRouteTelemetry(
  route: QuestRoute,
  progressM: number,
): GoogleRouteTelemetry {
  const totalDistanceM = routeDistanceM(route);
  const clampedProgressM = clamp(progressM, 0, totalDistanceM);
  const current = routePathPose(route, clampedProgressM);
  const sampleRadiusM = Math.min(90, Math.max(30, totalDistanceM * 0.02));
  const beforeM = Math.max(0, clampedProgressM - sampleRadiusM);
  const afterM = Math.min(totalDistanceM, clampedProgressM + sampleRadiusM);
  const before = routePathPose(route, beforeM);
  const after = routePathPose(route, afterM);
  const distanceSpanM = Math.max(1, afterM - beforeM);
  const elapsedBeforeS = elapsedAtDistance(route, beforeM);
  const elapsedAfterS = elapsedAtDistance(route, afterM);
  const elapsedSpanS = elapsedAfterS - elapsedBeforeS;
  const localPaceSPerKm =
    elapsedSpanS > 0 ? (elapsedSpanS / distanceSpanM) * 1_000 : undefined;
  const elapsedS = elapsedAtDistance(route, clampedProgressM);
  const averagePaceSPerKm =
    clampedProgressM >= 100 && elapsedS > 0
      ? (elapsedS / clampedProgressM) * 1_000
      : route.provenance.temporal.elapsedTimeS &&
          totalDistanceM > 0
        ? (route.provenance.temporal.elapsedTimeS / totalDistanceM) * 1_000
        : undefined;
  const paceSPerKm =
    localPaceSPerKm !== undefined &&
    averagePaceSPerKm !== undefined &&
    localPaceSPerKm >= averagePaceSPerKm * 0.25 &&
    localPaceSPerKm <= averagePaceSPerKm * 3
      ? localPaceSPerKm
      : averagePaceSPerKm;

  return {
    elapsedS,
    paceSPerKm:
      paceSPerKm !== undefined && Number.isFinite(paceSPerKm)
        ? paceSPerKm
        : undefined,
    elevationM: current.elev,
    gradePercent: clamp(
      ((after.elev - before.elev) / distanceSpanM) * 100,
      -30,
      30,
    ),
    headingDeg: current.bearingDeg,
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

function elapsedAtDistance(route: QuestRoute, progressM: number) {
  const timed = route.route.filter(
    (point): point is RoutePoint & { elapsedS: number } =>
      point.elapsedS !== undefined && Number.isFinite(point.elapsedS),
  );
  if (timed.length > 0) {
    if (progressM <= timed[0].d) return timed[0].elapsedS;
    for (let index = 1; index < timed.length; index += 1) {
      const current = timed[index];
      if (current.d < progressM) continue;
      const previous = timed[index - 1];
      const distanceSpanM = current.d - previous.d;
      const ratio =
        distanceSpanM > 0 ? (progressM - previous.d) / distanceSpanM : 0;
      return previous.elapsedS + (current.elapsedS - previous.elapsedS) * ratio;
    }
    return timed.at(-1)!.elapsedS;
  }

  const fallbackElapsedS = route.provenance.temporal.elapsedTimeS ?? 0;
  return totalElapsedAtDistance(routeDistanceM(route), progressM, fallbackElapsedS);
}

function totalElapsedAtDistance(
  totalDistanceM: number,
  progressM: number,
  elapsedS: number,
) {
  const ratio =
    totalDistanceM > 0 ? clamp(progressM / totalDistanceM, 0, 1) : 0;
  return elapsedS * ratio;
}
