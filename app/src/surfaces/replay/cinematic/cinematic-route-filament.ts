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
    Math.log10(Math.max(350, treatment.rangeM) / 350) / 1.65,
  );
  const shotScale =
    treatment.shotKind === "release"
      ? 0.82
      : treatment.shotKind === "tracking"
        ? 0.94
        : 1;
  const baseWidth = (3 + rangeScale * 0.9) * shotScale;
  const glintSpan = clamp(180 / Math.max(1, totalDistanceM), 0.0012, 0.012);
  const isRelease = treatment.shotKind === "release";
  const hasTreatment = end > start;
  const motionLift = 0.9 + clamp(treatment.motionIntensity) * 0.1;
  return [
    {
      color: "#f2e8db",
      endRatio: isRelease ? 1 : end,
      opacity: hasTreatment ? (isRelease ? 0.26 : 0.44) : 0,
      outerColor: "#211b17",
      outerWidth: 0.12,
      role: "guide",
      startRatio: isRelease ? 0 : start,
      width: Math.max(1.6, baseWidth * 0.56),
    },
    {
      color: "#d6b8a8",
      endRatio: end,
      opacity: hasTreatment ? (isRelease ? 0.18 : 0.3) : 0,
      outerColor: "#211b17",
      outerWidth: 0.1,
      role: "future",
      startRatio: focus,
      width: Math.max(1.4, baseWidth * 0.54),
    },
    {
      color: "#f06b50",
      endRatio: focus,
      opacity: hasTreatment ? (isRelease ? 0.68 : 0.92) : 0,
      outerColor: "#35221c",
      outerWidth: 0.14,
      role: "thread",
      startRatio: start,
      width: baseWidth * motionLift,
    },
    {
      color: "#fffdf1",
      endRatio: Math.min(end, focus + glintSpan * 0.35),
      opacity: hasTreatment ? (isRelease ? 0.38 : 0.68) : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "glint",
      startRatio: Math.max(start, focus - glintSpan),
      width: Math.max(1.8, baseWidth * 0.72),
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
