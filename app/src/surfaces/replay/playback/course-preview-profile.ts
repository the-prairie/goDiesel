import type { CoursePreviewSection } from "./course-preview-model";

export interface CourseProfilePoint {
  distanceM: number;
  elevationM: number;
}

export function coursePreviewProfile(section: CoursePreviewSection) {
  const segments: CourseProfilePoint[][] = [];
  let segment: CourseProfilePoint[] = [];
  let minimumM = Infinity;
  let maximumM = -Infinity;

  for (const point of section.route) {
    if (point.elevationM === undefined) {
      segment = [];
      continue;
    }
    if (segment.length === 0) segments.push(segment);
    segment.push({ distanceM: point.d, elevationM: point.elevationM });
    minimumM = Math.min(minimumM, point.elevationM);
    maximumM = Math.max(maximumM, point.elevationM);
  }

  return { segments, minimumM, maximumM };
}

export function courseProfileHeight(
  elevationM: number,
  profile: ReturnType<typeof coursePreviewProfile>,
) {
  const range = profile.maximumM - profile.minimumM;
  return range > 0 ? (elevationM - profile.minimumM) / range : 0.5;
}
