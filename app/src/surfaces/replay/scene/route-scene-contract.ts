import type { QuestRoute, RoutePoint } from "@/domain/routes";
import type { ReplayPose } from "@/surfaces/replay/playback/replay-controller";
import {
  bearingDegrees,
  routeDistanceM,
  routePathPose,
} from "@/replay/route-path";

export type DirectedRouteSceneCameraMode = "runner" | "chase" | "overview";
export type RouteSceneCameraMode = "auto" | DirectedRouteSceneCameraMode;
export type RouteSceneCameraProtection =
  | "recorded-terrain-envelope"
  | "horizon-guard"
  | "occlusion-buffer";

export interface RouteScenePoint {
  lat: number;
  lng: number;
  elevationM: number;
  progressM: number;
  elapsedS?: number;
}

export interface RouteSceneManifest {
  id: string;
  activityId: string;
  name: string;
  region: string;
  activityType: string;
  center: { lat: number; lng: number };
  totalDistanceM: number;
  elevationGainM: number;
  altitudeSource: "recorded-activity";
  path: RouteScenePoint[];
  sourceRoute: QuestRoute;
}

export interface RouteSceneFrameRequest {
  cameraMode: RouteSceneCameraMode;
  progressM: number;
  following: boolean;
  rangeScale: number;
}

export interface RouteSceneCamera {
  target: { lat: number; lng: number; altitude: number };
  headingDeg: number;
  rangeM: number;
  tiltDeg: number;
  fovDeg: number;
  directedMode: DirectedRouteSceneCameraMode;
  overviewWeight: number;
  protection: RouteSceneCameraProtection[];
}

export interface RouteSceneTelemetry {
  elapsedS: number;
  paceSPerKm?: number;
  elevationM: number;
  gradePercent: number;
  headingDeg: number;
}

export interface RouteSceneFrame {
  progressM: number;
  progressRatio: number;
  subject: {
    lat: number;
    lng: number;
    elevationM: number;
    bearingDeg: number;
    progressM: number;
  };
  camera: RouteSceneCamera;
  telemetry: RouteSceneTelemetry;
  rendererPose: ReplayPose;
}

const CAMERA_PROFILES = {
  runner: {
    clearanceM: 22,
    lookAheadM: 90,
    rangeM: 160,
    smoothingRadiusM: 70,
    tiltDeg: 64,
    fovDeg: 50,
  },
  chase: {
    clearanceM: 10,
    lookAheadM: 90,
    rangeM: 260,
    smoothingRadiusM: 55,
    tiltDeg: 65,
    fovDeg: 54,
  },
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createRouteSceneManifest(route: QuestRoute): RouteSceneManifest {
  return {
    id: route.slug,
    activityId: route.activityId,
    name: route.name,
    region: route.region,
    activityType: route.type,
    center: { lat: route.centerLat, lng: route.centerLng },
    totalDistanceM: routeDistanceM(route),
    elevationGainM: route.elevationGainM,
    altitudeSource: "recorded-activity",
    path: route.route.map((point) => ({
      lat: point.lat,
      lng: point.lng,
      elevationM: point.elev,
      progressM: point.d,
      elapsedS: point.elapsedS,
    })),
    sourceRoute: route,
  };
}

export function resolveRouteSceneFrame(
  manifest: RouteSceneManifest,
  request: RouteSceneFrameRequest,
): RouteSceneFrame {
  const { sourceRoute: route, totalDistanceM } = manifest;
  const progressM = clamp(request.progressM, 0, totalDistanceM);
  const current = routePathPose(route, progressM);
  const camera = resolveCamera(manifest, request, progressM, current.bearingDeg);
  const telemetry = resolveTelemetry(route, progressM, totalDistanceM);

  return {
    progressM,
    progressRatio: totalDistanceM > 0 ? progressM / totalDistanceM : 0,
    subject: {
      lat: current.lat,
      lng: current.lng,
      elevationM: current.elev,
      bearingDeg: current.bearingDeg,
      progressM,
    },
    camera,
    telemetry,
    rendererPose: {
      ...current,
      following: request.following,
      cameraRangeM: camera.rangeM,
    },
  };
}

function resolveCamera(
  manifest: RouteSceneManifest,
  request: RouteSceneFrameRequest,
  progressM: number,
  fallbackHeadingDeg: number,
): RouteSceneCamera {
  if (request.cameraMode === "auto") {
    return resolveAutomaticCamera(manifest, request, progressM, fallbackHeadingDeg);
  }

  if (request.cameraMode === "overview") {
    const midpoint = routePathPose(
      manifest.sourceRoute,
      manifest.totalDistanceM * 0.5,
    );
    return {
      target: { ...manifest.center, altitude: midpoint.elev },
      headingDeg: routePathPose(
        manifest.sourceRoute,
        manifest.totalDistanceM * 0.25,
      ).bearingDeg,
      rangeM: clamp(
        manifest.totalDistanceM * 0.72 * request.rangeScale,
        1_400,
        26_000,
      ),
      tiltDeg: 42,
      fovDeg: 48,
      directedMode: "overview",
      overviewWeight: 1,
      protection: ["horizon-guard"],
    };
  }

  const profile = CAMERA_PROFILES[request.cameraMode];
  const current = smoothRouteTarget(
    manifest,
    progressM,
    profile.smoothingRadiusM * 0.55,
  );
  const target = smoothRouteTarget(
    manifest,
    Math.min(manifest.totalDistanceM, progressM + profile.lookAheadM),
    profile.smoothingRadiusM,
  );
  return {
    target: {
      lat: target.lat,
      lng: target.lng,
      altitude: target.elev + profile.clearanceM,
    },
    headingDeg:
      target.progressM === current.progressM
        ? fallbackHeadingDeg
        : bearingDegrees(
            { ...current, d: current.progressM },
            { ...target, d: target.progressM },
          ),
    rangeM: profile.rangeM * request.rangeScale,
    tiltDeg: profile.tiltDeg,
    fovDeg: profile.fovDeg,
    directedMode: request.cameraMode,
    overviewWeight: 0,
    protection: [],
  };
}

function resolveAutomaticCamera(
  manifest: RouteSceneManifest,
  request: RouteSceneFrameRequest,
  progressM: number,
  fallbackHeadingDeg: number,
): RouteSceneCamera {
  const { sourceRoute: route, totalDistanceM } = manifest;
  const progressRatio = totalDistanceM > 0 ? progressM / totalDistanceM : 0;
  const telemetry = resolveTelemetry(route, progressM, totalDistanceM);
  const turnSeverity = localTurnSeverity(route, progressM, totalDistanceM);
  const terrain = localTerrainEnvelope(route, progressM, totalDistanceM);
  const terrainReliefM = terrain.maximumM - terrain.minimumM;
  const gradeSeverity = clamp(Math.abs(telemetry.gradePercent) / 18, 0, 1);
  const occlusionRisk = clamp(
    terrainReliefM / 130 + turnSeverity * 0.28 + gradeSeverity * 0.32,
    0,
    1,
  );
  const lookAheadM = clamp(
    100 + turnSeverity * 170 + gradeSeverity * 80,
    90,
    330,
  );
  const current = smoothRouteTarget(manifest, progressM, 44);
  const target = smoothRouteTarget(
    manifest,
    Math.min(totalDistanceM, progressM + lookAheadM),
    85 + turnSeverity * 70,
  );
  const headingDeg =
    target.progressM === current.progressM
      ? fallbackHeadingDeg
      : bearingDegrees(
          { ...current, d: current.progressM },
          { ...target, d: target.progressM },
        );
  // Recorded elevations describe the route surface, not the full height of
  // Google's photogrammetry. Keep automatic chase shots above the coarse
  // building and tree envelope while preserving the closer manual modes.
  const trackingRangeM = clamp(
    410 + terrainReliefM * 1.4 + turnSeverity * 120 + gradeSeverity * 80,
    390,
    780,
  );
  const trackingTiltDeg = clamp(
    57 - terrainReliefM * 0.065 - turnSeverity * 4 - gradeSeverity * 3,
    44,
    58,
  );
  const plannedClearanceM = 28 + occlusionRisk * 38;
  const trackingTarget = {
    lat: target.lat,
    lng: target.lng,
    altitude: Math.max(
      target.elev + plannedClearanceM,
      terrain.maximumM + 28 + occlusionRisk * 20,
    ),
  };

  const midpoint = routePathPose(route, totalDistanceM * 0.5);
  const overviewTarget = {
    ...manifest.center,
    altitude: midpoint.elev + 12,
  };
  const overviewRangeM = clamp(totalDistanceM * 0.72, 1_400, 26_000);
  const overviewHeadingDeg = routePathPose(
    route,
    totalDistanceM * 0.25,
  ).bearingDeg;
  const revealWeight = 1 - smoothstep(0.012, 0.065, progressRatio);
  const releaseWeight = smoothstep(0.92, 0.985, progressRatio);
  const overviewWeight = Math.max(revealWeight, releaseWeight);
  const protection: RouteSceneCameraProtection[] = [
    "recorded-terrain-envelope",
    "horizon-guard",
  ];
  if (occlusionRisk >= 0.34) protection.push("occlusion-buffer");

  return {
    target: {
      lat: mix(trackingTarget.lat, overviewTarget.lat, overviewWeight),
      lng: mix(trackingTarget.lng, overviewTarget.lng, overviewWeight),
      altitude: mix(
        trackingTarget.altitude,
        overviewTarget.altitude,
        overviewWeight,
      ),
    },
    headingDeg: mixHeading(headingDeg, overviewHeadingDeg, overviewWeight),
    rangeM: clamp(
      mix(trackingRangeM, overviewRangeM, overviewWeight) * request.rangeScale,
      mix(390, 1_400, overviewWeight),
      mix(900, 26_000, overviewWeight),
    ),
    tiltDeg: mix(trackingTiltDeg, 42, overviewWeight),
    fovDeg: mix(52, 48, overviewWeight),
    directedMode: overviewWeight >= 0.55 ? "overview" : "chase",
    overviewWeight,
    protection,
  };
}

function localTerrainEnvelope(
  route: QuestRoute,
  progressM: number,
  totalDistanceM: number,
) {
  let minimumM = Number.POSITIVE_INFINITY;
  let maximumM = Number.NEGATIVE_INFINITY;
  for (let index = 0; index <= 12; index += 1) {
    const sampleProgressM = clamp(
      progressM - 100 + (index / 12) * 620,
      0,
      totalDistanceM,
    );
    const elevationM = routePathPose(route, sampleProgressM).elev;
    minimumM = Math.min(minimumM, elevationM);
    maximumM = Math.max(maximumM, elevationM);
  }
  return { minimumM, maximumM };
}

function localTurnSeverity(
  route: QuestRoute,
  progressM: number,
  totalDistanceM: number,
) {
  const before = routePathPose(route, Math.max(0, progressM - 140));
  const current = routePathPose(route, progressM);
  const after = routePathPose(route, Math.min(totalDistanceM, progressM + 280));
  const incoming = bearingDegrees(
    { ...before, d: Math.max(0, progressM - 140) },
    { ...current, d: progressM },
  );
  const outgoing = bearingDegrees(
    { ...current, d: progressM },
    { ...after, d: Math.min(totalDistanceM, progressM + 280) },
  );
  const delta = Math.abs(((outgoing - incoming + 540) % 360) - 180);
  return smoothstep(8, 95, delta);
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
}

function mixHeading(start: number, end: number, amount: number) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * clamp(amount, 0, 1) + 360) % 360;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp((value - edge0) / Math.max(0.000_001, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function smoothRouteTarget(
  manifest: RouteSceneManifest,
  progressM: number,
  radiusM: number,
) {
  let lat = 0;
  let lng = 0;
  let elev = 0;
  let totalWeight = 0;
  for (let index = -6; index <= 6; index += 1) {
    const offset = index / 6;
    const sample = routePathPose(
      manifest.sourceRoute,
      clamp(
        progressM + offset * radiusM,
        0,
        manifest.totalDistanceM,
      ),
    );
    const weight = Math.cos((Math.abs(offset) * Math.PI) / 2) ** 2 + 0.04;
    lat += sample.lat * weight;
    lng += sample.lng * weight;
    elev += sample.elev * weight;
    totalWeight += weight;
  }
  return {
    lat: lat / totalWeight,
    lng: lng / totalWeight,
    elev: elev / totalWeight,
    progressM,
  };
}

function resolveTelemetry(
  route: QuestRoute,
  progressM: number,
  totalDistanceM: number,
): RouteSceneTelemetry {
  const current = routePathPose(route, progressM);
  const sampleRadiusM = Math.min(90, Math.max(30, totalDistanceM * 0.02));
  const beforeM = Math.max(0, progressM - sampleRadiusM);
  const afterM = Math.min(totalDistanceM, progressM + sampleRadiusM);
  const before = routePathPose(route, beforeM);
  const after = routePathPose(route, afterM);
  const distanceSpanM = Math.max(1, afterM - beforeM);
  const elapsedBeforeS = elapsedAtDistance(route, beforeM);
  const elapsedAfterS = elapsedAtDistance(route, afterM);
  const elapsedSpanS = elapsedAfterS - elapsedBeforeS;
  const localPaceSPerKm =
    elapsedSpanS > 0 ? (elapsedSpanS / distanceSpanM) * 1_000 : undefined;
  const elapsedS = elapsedAtDistance(route, progressM);
  const averagePaceSPerKm =
    progressM >= 100 && elapsedS > 0
      ? (elapsedS / progressM) * 1_000
      : route.provenance.temporal.elapsedTimeS && totalDistanceM > 0
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
      const ratio = distanceSpanM > 0 ? (progressM - previous.d) / distanceSpanM : 0;
      return previous.elapsedS + (current.elapsedS - previous.elapsedS) * ratio;
    }
    return timed.at(-1)!.elapsedS;
  }

  const fallbackElapsedS = route.provenance.temporal.elapsedTimeS ?? 0;
  const ratio = totalDistanceM(route) > 0 ? progressM / totalDistanceM(route) : 0;
  return fallbackElapsedS * clamp(ratio, 0, 1);
}

function totalDistanceM(route: QuestRoute) {
  return routeDistanceM(route);
}
