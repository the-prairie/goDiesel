import type { QuestRoute } from "@/domain/route";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import { bearingDegrees, routeDistanceM, routePathPose } from "@/domain/geometry/route-path";

export const ROUTE_TRAILER_DURATION_SECONDS = 17.5;

export type RouteTrailerChapter =
  | "the-place"
  | "the-line"
  | "the-terrain"
  | "the-decision";

export interface RouteTrailerFrame {
  camera: GoogleRouteCameraPose;
  chapter: RouteTrailerChapter;
  chapterLabel: string;
  progress: number;
  reveal: number;
  routeProgressM: number;
  showDecision: boolean;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeInOutCubic(value: number) {
  const bounded = clamp(value);
  return bounded < 0.5
    ? 4 * bounded * bounded * bounded
    : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
}

function easeOutQuint(value: number) {
  return 1 - Math.pow(1 - clamp(value), 5);
}

function segmentProgress(
  elapsedSeconds: number,
  startSeconds: number,
  endSeconds: number,
) {
  return clamp((elapsedSeconds - startSeconds) / (endSeconds - startSeconds));
}

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function interpolateHeading(start: number, end: number, amount: number) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * amount + 360) % 360;
}

function cameraBetween(
  start: GoogleRouteCameraPose,
  end: GoogleRouteCameraPose,
  amount: number,
): GoogleRouteCameraPose {
  const eased = easeInOutCubic(amount);
  return {
    center: {
      lat: interpolate(start.center.lat, end.center.lat, eased),
      lng: interpolate(start.center.lng, end.center.lng, eased),
    },
    headingDeg: interpolateHeading(start.headingDeg, end.headingDeg, eased),
    rangeM: interpolate(start.rangeM, end.rangeM, eased),
    tiltDeg: interpolate(start.tiltDeg, end.tiltDeg, eased),
    fovDeg: interpolate(start.fovDeg, end.fovDeg, eased),
    progressM: interpolate(start.progressM, end.progressM, eased),
  };
}

function routeCamera(
  route: QuestRoute,
  progressRatio: number,
  rangeM: number,
  tiltDeg: number,
  fovDeg: number,
): GoogleRouteCameraPose {
  const totalDistanceM = routeDistanceM(route);
  const progressM = totalDistanceM * progressRatio;
  const current = routePathPose(route, progressM);
  const target = routePathPose(
    route,
    Math.min(totalDistanceM, progressM + Math.max(160, rangeM * 0.42)),
  );
  return {
    center: { lat: target.lat, lng: target.lng },
    headingDeg: bearingDegrees(
      { ...current, d: current.progressM },
      { ...target, d: target.progressM },
    ),
    rangeM,
    tiltDeg,
    fovDeg,
    progressM,
  };
}

function overviewCamera(
  route: QuestRoute,
  rangeScale: number,
  headingOffset: number,
  tiltDeg: number,
): GoogleRouteCameraPose {
  const totalDistanceM = routeDistanceM(route);
  return {
    center: { lat: route.centerLat, lng: route.centerLng },
    headingDeg:
      (routePathPose(route, totalDistanceM * 0.24).bearingDeg +
        headingOffset +
        360) %
      360,
    rangeM: clamp(totalDistanceM * 0.72 * rangeScale, 2_200, 44_000),
    tiltDeg,
    fovDeg: 46,
    progressM: 0,
  };
}

export function routeTrailerFrame(
  route: QuestRoute,
  elapsedSeconds: number,
): RouteTrailerFrame {
  const elapsed = clamp(elapsedSeconds, 0, ROUTE_TRAILER_DURATION_SECONDS);
  const totalDistanceM = routeDistanceM(route);
  const progress = elapsed / ROUTE_TRAILER_DURATION_SECONDS;
  const establishStart = overviewCamera(route, 1.48, -34, 30);
  const establishEnd = overviewCamera(route, 1.08, -12, 42);
  const revealEnd = overviewCamera(route, 0.58, 8, 57);
  const pursuitStart = routeCamera(route, 0.12, 1_650, 49, 44);
  const pursuitEnd = routeCamera(route, 0.62, 950, 58, 47);
  const resolveEnd = overviewCamera(route, 0.9, 24, 47);

  if (elapsed < 3.6) {
    const local = segmentProgress(elapsed, 0, 3.6);
    return {
      camera: cameraBetween(establishStart, establishEnd, local),
      chapter: "the-place",
      chapterLabel: "The place",
      progress,
      reveal: 0.01,
      routeProgressM: 0,
      showDecision: false,
    };
  }

  if (elapsed < 7.4) {
    const local = segmentProgress(elapsed, 3.6, 7.4);
    return {
      camera: cameraBetween(establishEnd, revealEnd, local),
      chapter: "the-line",
      chapterLabel: "The line",
      progress,
      reveal: easeOutQuint(local),
      routeProgressM: totalDistanceM * 0.08 * local,
      showDecision: false,
    };
  }

  if (elapsed < 13.4) {
    const local = segmentProgress(elapsed, 7.4, 13.4);
    return {
      camera: cameraBetween(pursuitStart, pursuitEnd, local),
      chapter: "the-terrain",
      chapterLabel: "The terrain",
      progress,
      reveal: 1,
      routeProgressM: interpolate(
        pursuitStart.progressM,
        pursuitEnd.progressM,
        easeInOutCubic(local),
      ),
      showDecision: false,
    };
  }

  const local = segmentProgress(elapsed, 13.4, ROUTE_TRAILER_DURATION_SECONDS);
  return {
    camera: cameraBetween(pursuitEnd, resolveEnd, local),
    chapter: "the-decision",
    chapterLabel: "The decision",
    progress,
    reveal: 1,
    routeProgressM: interpolate(pursuitEnd.progressM, totalDistanceM, local),
    showDecision: elapsed >= 15.25,
  };
}
