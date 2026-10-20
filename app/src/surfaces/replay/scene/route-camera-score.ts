import type { QuestRoute } from "@/domain/route";
import { routePathPose } from "@/domain/geometry/route-path";
import type { GoogleRouteCameraPose, GoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";

interface CameraScore {
  routeSlug: string;
  rangeM: number;
  tiltDeg: number;
  headings: readonly { distanceM: number; degrees: number }[];
  release: { startM: number; endM: number };
}

const sanFranciscoOpening: CameraScore = {
  routeSlug: "14736711660",
  rangeM: 540,
  tiltDeg: 50,
  headings: [
    { distanceM: 0, degrees: 350 },
    { distanceM: 600, degrees: 350 },
    { distanceM: 1100, degrees: 263 },
    { distanceM: 1900, degrees: 263 },
  ],
  release: { startM: 1900, endM: 2100 },
};

export function sustainedRouteCamera(
  route: QuestRoute,
  state: GoogleRouteNavigatorState,
  base: GoogleRouteCameraPose,
  viewportWidth: number,
): GoogleRouteCameraPose {
  const score = sanFranciscoOpening;
  if (route.slug !== score.routeSlug || state.cameraMode !== "auto" ||
    state.progressM >= score.release.endM || route.provenance.discontinuities.some(gap => gap.startD < score.release.endM)) {
    return base;
  }
  const progressM = Math.max(0, state.progressM);
  const end = score.headings.findIndex(knot => knot.distanceM > progressM);
  const last = score.headings.length - 1;
  const from = score.headings[end < 0 ? last : Math.max(0, end - 1)];
  const to = score.headings[end < 0 ? last : end];
  const fraction = from === to ? 0 : ease((progressM - from.distanceM) / (to.distanceM - from.distanceM));
  const headingDeg = mixHeading(from.degrees, to.degrees, fraction);
  const release = ease((progressM - score.release.startM) / (score.release.endM - score.release.startM));
  const compact = Math.min(1, Math.max(0, (700 - viewportWidth) / 310));
  const referenceRange = Math.min(900, Math.max(390, (score.rangeM + compact * 80) * state.rangeScale));
  const rangeM = referenceRange + (base.rangeM - referenceRange) * release;
  const tiltDeg = score.tiltDeg + (base.tiltDeg - score.tiltDeg) * release;
  const heightChange = rangeM * Math.cos(tiltDeg * Math.PI / 180) -
    base.rangeM * Math.cos(base.tiltDeg * Math.PI / 180);
  const altitudeLift = Math.max(0, (base.minimumClearanceM ?? 0) - ((base.clearanceM ?? 0) + heightChange));
  const target = smoothTarget(route, progressM + 55);
  return {
    ...base,
    center: {
      lat: target.lat + (base.center.lat - target.lat) * release,
      lng: target.lng + (base.center.lng - target.lng) * release,
      altitude: (base.center.altitude ?? 0) + altitudeLift,
    },
    headingDeg: mixHeading(headingDeg, base.headingDeg, release),
    rangeM,
    tiltDeg,
    clearanceM: base.clearanceM === undefined ? undefined : base.clearanceM + heightChange + altitudeLift,
  };
}

function smoothTarget(route: QuestRoute, progressM: number) {
  let lat = 0;
  let lng = 0;
  let weights = 0;
  for (let i = -6; i <= 6; i++) {
    const offset = i / 6;
    const point = routePathPose(route, Math.max(0, progressM + offset * 80));
    const weight = Math.cos(Math.abs(offset) * Math.PI / 2) ** 2 + .04;
    lat += point.lat * weight;
    lng += point.lng * weight;
    weights += weight;
  }
  return { lat: lat / weights, lng: lng / weights };
}

function ease(amount: number) {
  const t = Math.min(1, Math.max(0, amount));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mixHeading(from: number, to: number, amount: number) {
  return (from + (((to - from + 540) % 360) - 180) * amount + 360) % 360;
}
