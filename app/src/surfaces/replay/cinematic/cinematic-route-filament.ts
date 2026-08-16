export type CinematicFilamentRole =
  | "context"
  | "future"
  | "traveled"
  | "lead";

export interface CinematicRouteTreatment {
  endRatio: number;
  focusRatio: number;
  motionIntensity: number;
  rangeM: number;
  shotKind: "establishing" | "reveal" | "tracking" | "summit" | "release";
  startRatio: number;
}

export interface CinematicThreadStyle {
  color: string;
  endRatio: number;
  opacity: number;
  outerColor: string;
  outerWidth: number;
  role: CinematicFilamentRole;
  startRatio: number;
  width: number;
}

export function buildCinematicThreadStyles(
  treatment: CinematicRouteTreatment,
  totalDistanceM: number,
): CinematicThreadStyle[] {
  const start = clamp(treatment.startRatio);
  const end = clamp(treatment.endRatio);
  const focus = clamp(treatment.focusRatio, start, end);
  const rangeScale = clamp(
    Math.log2(Math.max(350, treatment.rangeM) / 350) / 4.2,
  );
  const shotScale = treatment.shotKind === "release" ? 0.84 : 1;
  const threadWidth = (2.65 + rangeScale * 0.4) * shotScale;
  const leadSpan = clamp(160 / Math.max(1, totalDistanceM), 0.0015, 0.012);
  const isRelease = treatment.shotKind === "release";
  const hasTreatment = end > start;
  const motionLift = 0.98 + clamp(treatment.motionIntensity) * 0.04;
  return [
    {
      color: "#f4efe7",
      endRatio: isRelease ? 1 : end,
      opacity: hasTreatment ? (isRelease ? 0.2 : 0.26) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "context",
      startRatio: isRelease ? 0 : start,
      width: threadWidth + 0.55,
    },
    {
      color: "#fffaf2",
      endRatio: end,
      opacity: hasTreatment ? (isRelease ? 0.32 : 0.68) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "future",
      startRatio: focus,
      width: threadWidth * 0.65,
    },
    {
      color: "#f06b50",
      endRatio: focus,
      opacity: hasTreatment ? (isRelease ? 0.54 : 0.96) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "traveled",
      startRatio: start,
      width: threadWidth * motionLift,
    },
    {
      color: "#ffd9c8",
      endRatio: Math.min(end, focus + leadSpan),
      opacity: hasTreatment ? (isRelease ? 0.4 : 0.9) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "lead",
      startRatio: focus,
      width: threadWidth + 0.4,
    },
  ];
}

export function slicePathByRatio<T extends { lat: number; lng: number }>(
  path: T[],
  startRatio: number,
  endRatio: number,
): Array<{ lat: number; lng: number }> {
  if (path.length < 2) return path;
  const start = clamp(startRatio);
  const end = clamp(endRatio, start, 1);
  const lastIndex = path.length - 1;
  const startPosition = start * lastIndex;
  const endPosition = end * lastIndex;
  const points: Array<{ lat: number; lng: number }> = [
    interpolatePathPoint(path, startPosition),
  ];
  for (
    let index = Math.floor(startPosition) + 1;
    index <= Math.floor(endPosition);
    index += 1
  ) {
    if (index < lastIndex && index < endPosition) points.push(path[index]);
  }
  points.push(interpolatePathPoint(path, endPosition));
  return points;
}

function interpolatePathPoint<T extends { lat: number; lng: number }>(
  path: T[],
  position: number,
) {
  const lower = Math.min(path.length - 1, Math.max(0, Math.floor(position)));
  const upper = Math.min(path.length - 1, lower + 1);
  const amount = position - lower;
  return {
    lat: path[lower].lat + (path[upper].lat - path[lower].lat) * amount,
    lng: path[lower].lng + (path[upper].lng - path[lower].lng) * amount,
  };
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}
