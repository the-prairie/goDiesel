import { LngLat, type Map as MapLibreMap } from "maplibre-gl";
import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";
import { bearingDegrees } from "@/domain/geometry/route-path";
import { recordedPointAt } from "@/domain/geometry/recorded-thread";

function offset(point: RoutePoint, bearing: number, metres: number) {
  const angle = bearing * Math.PI / 180;
  return new LngLat(
    point.lng + Math.sin(angle) * metres / (111320 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180))),
    point.lat + Math.cos(angle) * metres / 111320,
  );
}

/** Camera geometry is shared by descent and playback; it does not pick a route. */
export function reliefCameraGeometry(trace: RoutePoint[], distanceM: number, gaps: RouteDiscontinuityEvidence[] = [], rangeScale = 1) {
  const at = recordedPointAt(trace, distanceM, gaps);
  if (!at) return null;
  const before = recordedPointAt(trace, Math.max(0, at.d - 100), gaps)!;
  const ahead = recordedPointAt(trace, at.d + 260, gaps)!;
  // At the finish use the last approach. A duplicate endpoint must not turn north.
  const heading = ahead.lng !== at.lng || ahead.lat !== at.lat
    ? bearingDegrees(before, ahead) : bearingDegrees(before, at);
  const local = trace.filter(p => Math.abs(p.d - at.d) <= 900);
  const elevations = local.map(p => p.elev);
  const relief = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0;
  // A landscape, not an overscaled DEM close-up. Even flat routes retain their
  // surroundings; relief increases the distance rather than only tilting up.
  const rangeM = Math.min(4200, 2400 + relief * 1.8) * rangeScale;
  return { at, heading, rangeM, relief, from: offset(at, heading + 180, rangeM) };
}

/**
 * Look at the held point at terrain height, from behind and above the route.
 * Sample the eye and its line of sight, not only elevation beneath the runner.
 * Unknown DEM remains a recorded-envelope approximation, never measured clearance.
 */
export function reliefCamera(map: MapLibreMap, trace: RoutePoint[], distanceM: number, gaps: RouteDiscontinuityEvidence[] = [], rangeScale = 1, heldBearing?: number) {
  const geometry = reliefCameraGeometry(trace, distanceM, gaps, rangeScale);
  if (!geometry) return null;
  const { at, rangeM } = geometry;
  const target = new LngLat(at.lng, at.lat);
  const measuredTarget = map.queryTerrainElevation(target);
  const targetElevation = measuredTarget ?? at.elev * 1.35;
  const preferredRise = rangeM / Math.tan(58 * Math.PI / 180);
  // A camera behind the runner can hide the entire descent behind a ridge.
  // Choose a side that sees the actual upcoming corridor, then keep that
  // geographic bearing through Replay instead of spinning at each switchback.
  const corridor = [0, 250, 600, 900].map(d => recordedPointAt(trace, at.d + d, gaps)!).map(p => ({
    point: new LngLat(p.lng, p.lat), elevation: map.queryTerrainElevation([p.lng, p.lat]) ?? p.elev * 1.35,
  }));
  const candidates = heldBearing === undefined
    ? [geometry.heading, geometry.heading + 90, geometry.heading - 90, geometry.heading + 180]
    : [heldBearing];
  const views = candidates.map((bearing, index) => {
    const from = offset(at, bearing + 180, rangeM);
    let eyeElevation = targetElevation + preferredRise;
    let sampled = 0;
    if (measuredTarget === null) eyeElevation += geometry.relief * 0.5 + 180;
    for (const look of corridor) {
      for (const t of [0, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.98]) {
        const sample = new LngLat(from.lng + (look.point.lng - from.lng) * t, from.lat + (look.point.lat - from.lat) * t);
        const elevation = map.queryTerrainElevation(sample);
        if (elevation === null) continue;
        sampled += 1;
        eyeElevation = Math.max(eyeElevation, (elevation + 130 * (1 - t) - look.elevation * t) / (1 - t));
      }
    }
    return { from, eyeElevation, sampled, score: eyeElevation + index * 35 };
  });
  const view = views.reduce((best, candidate) => candidate.score < best.score ? candidate : best);
  const options = map.calculateCameraOptionsFromTo(view.from, view.eyeElevation, target, targetElevation);
  return { ...geometry, ...view, targetElevation, options: { ...options, padding: { top: 80, right: 0, bottom: 0, left: 0 } } };
}

/*
 * Sightline sampling is the expensive part of the camera: some thirty terrain
 * queries a frame, a quarter of the main thread during playback. The ground
 * ahead changes little between frames, so the full sample runs when the held
 * point has moved 40 m or 250 ms have passed, and frames in between carry its
 * lift above the target.
 */
const RESAMPLE_DISTANCE_M = 40;
const RESAMPLE_INTERVAL_MS = 250;

export function needsSightlineResample(last: { progressM: number; atMs: number } | undefined, progressM: number, nowMs: number) {
  return !last || Math.abs(progressM - last.progressM) >= RESAMPLE_DISTANCE_M || nowMs - last.atMs >= RESAMPLE_INTERVAL_MS;
}

/** Rise at once, ease down: the camera never sits below the sampled clearance. */
export function carriedLift(current: number | undefined, sampled: number) {
  if (current === undefined || sampled >= current) return sampled;
  return current + (sampled - current) * 0.25;
}

/** The camera between full samples: same geometry and bearing, one terrain query. */
export function reliefCameraFollow(
  map: MapLibreMap,
  trace: RoutePoint[],
  distanceM: number,
  gaps: RouteDiscontinuityEvidence[],
  rangeScale: number,
  bearing: number,
  liftM: number,
) {
  const geometry = reliefCameraGeometry(trace, distanceM, gaps, rangeScale);
  if (!geometry) return null;
  const { at, rangeM } = geometry;
  const target = new LngLat(at.lng, at.lat);
  const targetElevation = map.queryTerrainElevation(target) ?? at.elev * 1.35;
  const from = offset(at, bearing + 180, rangeM);
  const eyeElevation = targetElevation + liftM;
  const options = map.calculateCameraOptionsFromTo(from, eyeElevation, target, targetElevation);
  return { ...geometry, from, eyeElevation, targetElevation, sampled: 0, options };
}
