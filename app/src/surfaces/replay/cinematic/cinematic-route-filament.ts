export type CinematicFilamentRole =
  | "context"
  | "future"
  | "traveled"
  | "lead";

export interface CinematicRouteTreatment {
  bearingDeg?: number;
  cameraHeadingDeg?: number;
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
  const continuousRangeScale = clamp(
    Math.log2(Math.max(350, treatment.rangeM) / 350) / 4.2,
  );
  const rangeScale =
    continuousRangeScale < 0.28
      ? 0
      : continuousRangeScale < 0.72
        ? 0.5
        : 1;
  const shotScale = treatment.shotKind === "release" ? 0.84 : 1;
  const threadWidth = (2.25 + rangeScale * 0.28) * shotScale;
  const leadSpan = clamp(110 / Math.max(1, totalDistanceM), 0.0012, 0.01);
  const farOverlap = clamp(12 / Math.max(1, totalDistanceM), 0.0002, 0.0015);
  const isRelease = treatment.shotKind === "release";
  const isOverview =
    treatment.shotKind === "establishing" ||
    treatment.shotKind === "reveal" ||
    isRelease;
  const hasTreatment = end > start;
  const motionLift = 0.98 + clamp(treatment.motionIntensity) * 0.04;
  return [
    {
      color: "#f4efe7",
      endRatio: isRelease ? 1 : end,
      opacity: hasTreatment && isOverview ? (isRelease ? 0.24 : 0.32) : 0,
      outerColor: "rgba(28, 45, 75, 0.62)",
      outerWidth: 0.1,
      role: "context",
      startRatio: isRelease ? 0 : start,
      width: threadWidth * 0.9,
    },
    {
      color: "#fffaf2",
      endRatio: end,
      opacity: hasTreatment && !isOverview ? 0.5 : 0,
      outerColor: "rgba(28, 45, 75, 0.56)",
      outerWidth: 0.1,
      role: "future",
      startRatio: Math.max(focus, focus + leadSpan - farOverlap),
      width: threadWidth * 0.62,
    },
    {
      color: "#f06b50",
      endRatio: focus,
      opacity: hasTreatment && !isOverview ? 0.94 : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "traveled",
      startRatio: start,
      width: threadWidth * motionLift,
    },
    {
      color: "#ffd9c8",
      endRatio: Math.min(end, focus + leadSpan),
      opacity: hasTreatment && !isOverview ? 0.84 : 0,
      outerColor: "transparent",
      outerWidth: 0,
      role: "lead",
      startRatio: focus,
      width: threadWidth + 0.2,
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

export function conditionCinematicPath<T extends { lat: number; lng: number }>(
  path: T[],
  rangeM: number,
): Array<{ lat: number; lng: number }> {
  if (path.length < 3 || rangeM <= 800) return path;
  const toleranceM =
    rangeM <= 2_500 ? 2 : rangeM <= 6_000 ? 5 : 10;
  const retained = new Set<number>([0, path.length - 1]);
  const segments: Array<[number, number]> = [[0, path.length - 1]];
  while (segments.length > 0) {
    const [startIndex, endIndex] = segments.pop() ?? [0, 0];
    const detailIndex = mostDetailedPoint(
      path,
      startIndex,
      endIndex,
      toleranceM,
    );
    if (detailIndex < 0) continue;
    retained.add(detailIndex);
    segments.push([startIndex, detailIndex], [detailIndex, endIndex]);
  }
  return [...retained]
    .sort((a, b) => a - b)
    .map((index) => ({ lat: path[index].lat, lng: path[index].lng }));
}

function mostDetailedPoint<T extends { lat: number; lng: number }>(
  path: T[],
  startIndex: number,
  endIndex: number,
  toleranceM: number,
) {
  let detailIndex = -1;
  let greatestDistanceM = 0;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const distanceM = pointToSegmentDistanceM(
      path[index],
      path[startIndex],
      path[endIndex],
    );
    if (distanceM > greatestDistanceM) {
      detailIndex = index;
      greatestDistanceM = distanceM;
    }
  }
  return greatestDistanceM > toleranceM ? detailIndex : -1;
}

function pointToSegmentDistanceM(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
) {
  const latitudeRadians = (point.lat * Math.PI) / 180;
  const xScale = 111_320 * Math.cos(latitudeRadians);
  const pointX = point.lng * xScale;
  const pointY = point.lat * 111_320;
  const startX = start.lng * xScale;
  const startY = start.lat * 111_320;
  const endX = end.lng * xScale;
  const endY = end.lat * 111_320;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return Math.hypot(pointX - startX, pointY - startY);
  const amount = clamp(
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) /
      lengthSquared,
  );
  return Math.hypot(
    pointX - (startX + segmentX * amount),
    pointY - (startY + segmentY * amount),
  );
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
