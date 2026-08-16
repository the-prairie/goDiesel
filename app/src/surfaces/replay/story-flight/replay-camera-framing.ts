import { routePathPose } from "@/domain/geometry/route-path";
import type { QuestRoute } from "@/domain/route";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";

export interface ReplayViewportInsets {
  bottom: number;
  chromeVisible: boolean;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export function frameReplayCamera(
  route: QuestRoute,
  pose: GoogleRouteCameraPose,
  viewport: ReplayViewportInsets,
): GoogleRouteCameraPose {
  if (pose.directedMode === "overview" || viewport.height <= 0) return pose;

  const subject = routePathPose(route, pose.progressM);
  const bottomRatio = viewport.chromeVisible
    ? clamp(viewport.bottom / viewport.height, 0, 0.36)
    : 0;
  const lookAheadWeight = clamp(0.72 - bottomRatio * 2.8, 0.18, 0.72);
  const rangeLift = 1 + bottomRatio * 0.52;

  return {
    ...pose,
    center: {
      lat: mix(subject.lat, pose.center.lat, lookAheadWeight),
      lng: mix(subject.lng, pose.center.lng, lookAheadWeight),
      altitude: pose.center.altitude,
    },
    rangeM: pose.rangeM * rangeLift,
    tiltDeg: clamp(pose.tiltDeg - bottomRatio * 10, 38, pose.tiltDeg),
  };
}

export function replaySubjectBand(viewport: ReplayViewportInsets) {
  const top = viewport.chromeVisible ? viewport.top : 0;
  const bottom = viewport.chromeVisible ? viewport.bottom : 0;
  const available = Math.max(1, viewport.height - top - bottom);
  return {
    minimumY: top + available * 0.42,
    maximumY: top + available * 0.68,
  };
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
