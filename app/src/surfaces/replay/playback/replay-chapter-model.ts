import { routeDistanceM } from "@/domain/geometry/route-path";
import type { QuestRoute } from "@/domain/route";

export interface ReplaySpan {
  startM: number;
  endM: number;
}

export interface ReplayProfilePoint {
  distanceM: number;
  elevationM: number;
}

export interface ReplayChapter extends ReplaySpan {
  id: string;
  index: number;
  label: string;
  ascentM: number;
  descentM: number;
}

export interface ReplayMoment extends ReplaySpan {
  id: string;
  kind: "descent" | "high-point" | "low-point";
  label: string;
  anchorM: number;
  valueM: number;
  explanation: string;
}

export interface ReplayChapterModel {
  totalDistanceM: number;
  chapters: ReplayChapter[];
  moments: ReplayMoment[];
  segments: ReplayProfilePoint[][];
  minimumElevationM: number;
  maximumElevationM: number;
}

const MINIMUM_CHAPTER_DISTANCE_M = 1_000;
const MINIMUM_MOMENT_VARIATION_M = 5;
const PROFILE_POINT_TARGET = 240;

export function buildReplayChapterModel(route: QuestRoute): ReplayChapterModel {
  const totalDistanceM = routeDistanceM(route);
  const segments = recordedSegments(route);
  let minimumElevationM = Infinity;
  let maximumElevationM = -Infinity;
  for (const segment of segments) {
    for (const point of segment) {
      minimumElevationM = Math.min(minimumElevationM, point.elevationM);
      maximumElevationM = Math.max(maximumElevationM, point.elevationM);
    }
  }

  return {
    totalDistanceM,
    chapters: buildChapters(segments, totalDistanceM),
    moments: buildMoments(segments, totalDistanceM, minimumElevationM, maximumElevationM),
    segments,
    minimumElevationM: minimumElevationM === Infinity ? 0 : minimumElevationM,
    maximumElevationM: maximumElevationM === -Infinity ? 0 : maximumElevationM,
  };
}

export function replayChapterAt(model: ReplayChapterModel, progressM: number): ReplayChapter | undefined {
  if (!Number.isFinite(progressM)) return undefined;
  return model.chapters.find((chapter) => progressM < chapter.endM) ?? model.chapters.at(-1);
}

export function replayElevationAt(model: ReplayChapterModel, progressM: number): number | undefined {
  if (!Number.isFinite(progressM)) return undefined;
  let elevationM: number | undefined;
  for (const segment of model.segments) {
    if (progressM < segment[0].distanceM || progressM > segment.at(-1)!.distanceM) continue;
    const point = pointAt(segment, progressM);
    if (elevationM !== undefined && elevationM !== point.elevationM) return undefined;
    elevationM = point.elevationM;
  }
  return elevationM;
}

export function replayProfileInSpan(model: ReplayChapterModel, span: ReplaySpan): ReplayProfilePoint[][] {
  if (!Number.isFinite(span.startM) || !Number.isFinite(span.endM) || span.startM > span.endM) return [];
  const clipped = model.segments.map((segment) => clipSegment(segment, span)).filter((segment) => segment.length > 0);
  const required = clipped.reduce((count, segment) => count + Math.min(4, segment.length), 0);
  const optional = clipped.reduce((count, segment) => count + Math.max(0, segment.length - 4), 0);
  const available = Math.max(0, PROFILE_POINT_TARGET - required);

  return clipped.map((segment) => sampleSegment(segment, Math.min(4, segment.length) + (
    optional > 0 ? Math.floor(available * Math.max(0, segment.length - 4) / optional) : 0
  )));
}

function recordedSegments(route: QuestRoute): ReplayProfilePoint[][] {
  const gaps = [...route.provenance.discontinuities].sort((left, right) => left.startD - right.startD);
  const starts = gaps.map((gap) => gap.startD);
  let maximumEnd = -Infinity;
  const ends = gaps.map((gap) => {
    maximumEnd = Math.max(maximumEnd, gap.endD);
    return maximumEnd;
  });
  const zeroBoundaries = new Set(gaps.filter((gap) => gap.startD === gap.endD).map((gap) => gap.startD));
  const segments: ReplayProfilePoint[][] = [];
  let segment: ReplayProfilePoint[] = [];
  let previous: ReplayProfilePoint | undefined;

  for (const source of route.route) {
    const point = { distanceM: source.d, elevationM: source.elev };
    const gapIndex = lowerBound(starts.length, (index) => starts[index] >= point.distanceM) - 1;
    const breaks = previous && (
      point.distanceM <= previous.distanceM ||
      (gapIndex >= 0 && ends[gapIndex] > previous.distanceM) ||
      zeroBoundaries.has(point.distanceM)
    );
    if (breaks) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
    }
    if (!previous || point.distanceM !== previous.distanceM || point.elevationM !== previous.elevationM) {
      segment.push(point);
    }
    previous = point;
  }
  if (segment.length > 0) segments.push(segment);
  return segments;
}

function buildChapters(segments: ReplayProfilePoint[][], totalDistanceM: number): ReplayChapter[] {
  const count = Math.min(4, Math.max(1, Math.floor(totalDistanceM / MINIMUM_CHAPTER_DISTANCE_M)));
  return Array.from({ length: count }, (_, index) => {
    const span = { startM: totalDistanceM * index / count, endM: totalDistanceM * (index + 1) / count };
    let ascentM = 0;
    let descentM = 0;
    let recordedDistanceM = 0;
    for (const segment of segments) {
      const points = clipSegment(segment, span);
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const changeM = points[pointIndex].elevationM - points[pointIndex - 1].elevationM;
        ascentM += Math.max(0, changeM);
        descentM += Math.max(0, -changeM);
        recordedDistanceM += points[pointIndex].distanceM - points[pointIndex - 1].distanceM;
      }
    }
    let label: string;
    if (count === 1) label = "Opening / Finish";
    else if (index === 0) label = "Opening";
    else if (index === count - 1) label = "Finish";
    else if (recordedDistanceM === 0) label = `Section ${index + 1}`;
    else if (ascentM + descentM < MINIMUM_MOMENT_VARIATION_M) label = "Level";
    else if (ascentM - descentM > (ascentM + descentM) * 0.6) label = "Climbing";
    else if (descentM - ascentM > (ascentM + descentM) * 0.6) label = "Descending";
    else label = "Rolling";
    return { id: `chapter-${index + 1}`, index, ...span, label, ascentM, descentM };
  });
}

function buildMoments(
  segments: ReplayProfilePoint[][],
  totalDistanceM: number,
  minimumElevationM: number,
  maximumElevationM: number,
): ReplayMoment[] {
  if (maximumElevationM - minimumElevationM < MINIMUM_MOMENT_VARIATION_M) return [];
  const moments: ReplayMoment[] = [];
  let descent: { start: ReplayProfilePoint; end: ReplayProfilePoint } | undefined;
  for (const segment of segments) {
    let startIndex = 0;
    for (let index = 1; index < segment.length; index += 1) {
      if (segment[index].elevationM > segment[index - 1].elevationM) startIndex = index;
      const start = segment[startIndex];
      const end = segment[index];
      const dropM = start.elevationM - end.elevationM;
      if (index - startIndex >= 2 && dropM >= MINIMUM_MOMENT_VARIATION_M &&
        (!descent || dropM > descent.start.elevationM - descent.end.elevationM)) {
        descent = { start, end };
      }
    }
  }
  if (descent) {
    const { start, end } = descent;
    const valueM = start.elevationM - end.elevationM;
    moments.push({
      id: `descent-${start.distanceM}-${end.distanceM}`,
      kind: "descent",
      label: "Largest descent",
      startM: start.distanceM,
      endM: end.distanceM,
      anchorM: start.distanceM,
      valueM,
      explanation: `Derived from recorded elevation. Falls ${valueM.toFixed(1)} m from ${start.elevationM.toFixed(1)} m to ${end.elevationM.toFixed(1)} m over ${(end.distanceM - start.distanceM).toFixed(0)} m without a recorded rise or gap.`,
    });
  }

  for (const kind of ["high-point", "low-point"] as const) {
    const valueM = kind === "high-point" ? maximumElevationM : minimumElevationM;
    const segment = segments.find((points) => points.length >= 3 &&
      points.some((point) => point.elevationM === valueM) &&
      points.some((point) => Math.abs(point.elevationM - valueM) >= MINIMUM_MOMENT_VARIATION_M));
    if (!segment) continue;
    const anchor = segment.find((point) => point.elevationM === valueM)!;
    const radiusM = Math.min(400, Math.max(50, totalDistanceM * 0.03));
    moments.push({
      id: `${kind}-${anchor.distanceM}`,
      kind,
      label: kind === "high-point" ? "High point" : "Low point",
      startM: Math.max(segment[0].distanceM, anchor.distanceM - radiusM),
      endM: Math.min(segment.at(-1)!.distanceM, anchor.distanceM + radiusM),
      anchorM: anchor.distanceM,
      valueM,
      explanation: `Derived from recorded elevation. ${kind === "high-point" ? "Highest" : "Lowest"} recorded sample is ${valueM.toFixed(1)} m at ${(anchor.distanceM / 1_000).toFixed(2)} km.`,
    });
  }
  return moments;
}

function clipSegment(segment: ReplayProfilePoint[], span: ReplaySpan): ReplayProfilePoint[] {
  const startM = Math.max(span.startM, segment[0].distanceM);
  const endM = Math.min(span.endM, segment.at(-1)!.distanceM);
  if (startM > endM) return [];
  if (startM === endM) return [pointAt(segment, startM)];
  const firstInterior = lowerBound(segment.length, (index) => segment[index].distanceM > startM);
  const afterInterior = lowerBound(segment.length, (index) => segment[index].distanceM >= endM);
  return [pointAt(segment, startM), ...segment.slice(firstInterior, afterInterior), pointAt(segment, endM)];
}

function pointAt(segment: ReplayProfilePoint[], distanceM: number): ReplayProfilePoint {
  const upper = lowerBound(segment.length, (index) => segment[index].distanceM >= distanceM);
  const end = segment[upper];
  if (end.distanceM === distanceM) return end;
  const start = segment[upper - 1];
  const ratio = (distanceM - start.distanceM) / (end.distanceM - start.distanceM);
  return { distanceM, elevationM: start.elevationM + (end.elevationM - start.elevationM) * ratio };
}

function lowerBound(length: number, matches: (index: number) => boolean): number {
  let lower = 0;
  let upper = length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (matches(middle)) upper = middle;
    else lower = middle + 1;
  }
  return lower;
}

function sampleSegment(segment: ReplayProfilePoint[], maximum: number): ReplayProfilePoint[] {
  if (segment.length <= maximum) return segment;
  const bucketCount = Math.floor((maximum - 2) / 2);
  const sampled = [segment[0]];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * (segment.length - 2) / bucketCount);
    const end = 1 + Math.floor((bucket + 1) * (segment.length - 2) / bucketCount);
    let minimumIndex = start;
    let maximumIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (segment[index].elevationM < segment[minimumIndex].elevationM) minimumIndex = index;
      if (segment[index].elevationM > segment[maximumIndex].elevationM) maximumIndex = index;
    }
    sampled.push(segment[Math.min(minimumIndex, maximumIndex)]);
    if (minimumIndex !== maximumIndex) sampled.push(segment[Math.max(minimumIndex, maximumIndex)]);
  }
  sampled.push(segment.at(-1)!);
  return sampled;
}
