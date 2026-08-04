import type { QuestRoute } from "@/domain/routes";
import type { CinematicRouteTreatment } from "@/replay/cinematic/cinematic-route-filament";
import { routeDistanceM } from "@/replay/route-path";
import {
  createRouteSceneManifest,
  resolveRouteSceneFrame,
  type DirectedRouteSceneCameraMode,
  type RouteSceneCameraProtection,
  type RouteSceneManifest,
  type RouteSceneCameraMode,
  type RouteSceneTelemetry,
} from "@/replay/scene/route-scene-contract";

export type GoogleRouteCameraMode = RouteSceneCameraMode;
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
  directedMode?: DirectedRouteSceneCameraMode;
  overviewWeight?: number;
  protection?: RouteSceneCameraProtection[];
}

export type GoogleRouteTelemetry = RouteSceneTelemetry;

export const GOOGLE_ROUTE_SPEEDS = [0.5, 1, 2, 4] as const;
const REPLAY_DURATION_SECONDS = 210;
const manifestCache = new WeakMap<QuestRoute, RouteSceneManifest>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sceneManifest(route: QuestRoute) {
  const cached = manifestCache.get(route);
  if (cached) return cached;
  const manifest = createRouteSceneManifest(route);
  manifestCache.set(route, manifest);
  return manifest;
}

export function initialGoogleRouteNavigatorState(): GoogleRouteNavigatorState {
  return {
    playing: false,
    progressM: 0,
    speed: 1,
    cameraMode: "auto",
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
  const frame = resolveRouteSceneFrame(sceneManifest(route), state);

  return {
    center: frame.camera.target,
    headingDeg: frame.camera.headingDeg,
    rangeM: frame.camera.rangeM,
    tiltDeg: frame.camera.tiltDeg,
    fovDeg: frame.camera.fovDeg,
    progressM: frame.progressM,
    directedMode: frame.camera.directedMode,
    overviewWeight: frame.camera.overviewWeight,
    protection: frame.camera.protection,
  };
}

export function googleRouteTelemetry(
  route: QuestRoute,
  progressM: number,
): GoogleRouteTelemetry {
  return resolveRouteSceneFrame(sceneManifest(route), {
    cameraMode: "chase",
    following: true,
    progressM,
    rangeScale: 1,
  }).telemetry;
}

export function googleRouteThreadTreatment(
  route: QuestRoute,
  state: GoogleRouteNavigatorState,
): CinematicRouteTreatment {
  const totalDistanceM = Math.max(1, routeDistanceM(route));
  const focusRatio = clamp(state.progressM / totalDistanceM, 0, 1);
  if (focusRatio >= 0.995) {
    return {
      endRatio: 1,
      focusRatio: 1,
      motionIntensity: 0.18,
      rangeM: googleRouteCameraPose(route, state).rangeM,
      shotKind: "release",
      startRatio: 0,
    };
  }

  const frame = resolveRouteSceneFrame(sceneManifest(route), state);
  const { camera, telemetry } = frame;
  const directedMode = camera.directedMode;
  const overviewWeight = state.cameraMode === "auto" ? camera.overviewWeight : 0;
  const trackingWindow =
    directedMode === "runner"
      ? { aheadM: 90, behindM: 24 }
      : { aheadM: 480, behindM: 900 };
  const window =
    directedMode === "overview" || overviewWeight > 0
      ? {
          aheadM: mix(
            trackingWindow.aheadM,
            totalDistanceM * 0.52,
            overviewWeight || 1,
          ),
          behindM: mix(
            trackingWindow.behindM,
            totalDistanceM * 0.48,
            overviewWeight || 1,
          ),
        }
      : trackingWindow;
  const grade = Math.abs(telemetry.gradePercent);

  return {
    endRatio: clamp((state.progressM + window.aheadM) / totalDistanceM, 0, 1),
    focusRatio,
    motionIntensity: state.playing ? clamp(0.68 + grade / 45, 0, 1) : 0.34,
    rangeM: camera.rangeM,
    shotKind: "tracking",
    startRatio: clamp((state.progressM - window.behindM) / totalDistanceM, 0, 1),
  };
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
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
