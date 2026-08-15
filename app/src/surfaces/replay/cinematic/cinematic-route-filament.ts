export type CinematicFilamentRole = "guide" | "future" | "thread" | "glint";

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
  const shotScale =
    treatment.shotKind === "release"
      ? 0.84
      : treatment.shotKind === "tracking"
        ? 1
        : 1.05;
  const ribbonWidth = (4.6 + rangeScale * 0.8) * shotScale;
  const glintSpan = clamp(55 / Math.max(1, totalDistanceM), 0.0006, 0.006);
  const isRelease = treatment.shotKind === "release";
  const hasTreatment = end > start;
  const motionLift = 0.96 + clamp(treatment.motionIntensity) * 0.04;
  return [
    {
      color: "#f4efe7",
      endRatio: isRelease ? 1 : end,
      opacity: hasTreatment ? (isRelease ? 0.42 : 0.82) : 0,
      outerColor: "rgba(23, 35, 58, 0.56)",
      outerWidth: 0.12,
      role: "guide",
      startRatio: isRelease ? 0 : start,
      width: ribbonWidth + 2,
    },
    {
      color: "#fffaf2",
      endRatio: end,
      opacity: hasTreatment ? (isRelease ? 0.5 : 0.94) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "future",
      startRatio: focus,
      width: ribbonWidth * 0.82,
    },
    {
      color: "#f06b50",
      endRatio: focus,
      opacity: hasTreatment ? (isRelease ? 0.7 : 0.98) : 0,
      outerColor: "rgba(50, 31, 40, 0.64)",
      outerWidth: 0.18,
      role: "thread",
      startRatio: start,
      width: ribbonWidth * motionLift,
    },
    {
      color: "#fffdf6",
      endRatio: Math.min(end, focus + glintSpan * 0.2),
      opacity: hasTreatment ? (isRelease ? 0.58 : 1) : 0,
      outerColor: "rgba(240, 107, 80, 0.92)",
      outerWidth: 0.32,
      role: "glint",
      startRatio: Math.max(start, focus - glintSpan),
      width: ribbonWidth + 1.8,
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
