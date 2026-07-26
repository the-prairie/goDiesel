export type CinematicFilamentRole = "future" | "thread" | "glint";

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
      ? 0.76
      : treatment.shotKind === "tracking"
        ? 0.88
        : 1;
  const baseWidth = (1.7 + rangeScale * 1.2) * shotScale;
  const glintSpan = clamp(85 / Math.max(1, totalDistanceM), 0.00045, 0.006);
  const isRelease = treatment.shotKind === "release";
  const motionLift = 0.9 + clamp(treatment.motionIntensity) * 0.1;
  return [
    {
      color: "#9c765c",
      endRatio: end,
      opacity: isRelease ? 0.07 : 0.12,
      role: "future",
      startRatio: focus,
      width: Math.max(0.65, baseWidth * 0.34),
    },
    {
      color: "#e7bc91",
      endRatio: focus,
      opacity: isRelease ? 0.42 : 0.7,
      role: "thread",
      startRatio: start,
      width: baseWidth * 0.72 * motionLift,
    },
    {
      color: "#fffdf1",
      endRatio: Math.min(end, focus + glintSpan * 0.25),
      opacity: isRelease ? 0.32 : 0.82,
      role: "glint",
      startRatio: Math.max(start, focus - glintSpan),
      width: Math.max(0.8, baseWidth * 0.3),
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
