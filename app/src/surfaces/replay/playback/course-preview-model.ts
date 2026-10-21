import { courseStats, type Course, type CoursePoint } from "@/domain/courses";
import { interpolateLongitude } from "@/domain/geometry/longitude";
import type {
  GoogleRouteCameraPose,
  GoogleRouteGeometry,
} from "@/surfaces/replay/playback/route-navigator-controller";

export interface CoursePreviewSection extends GoogleRouteGeometry {
  sectionNumber: number;
  distanceM: number;
  completeElevation: boolean;
  route: Array<Pick<CoursePoint, "lat" | "lng" | "elevationM"> & { d: number }>;
}

export function coursePreviewSections(course: Course): CoursePreviewSection[] {
  return course.segments
    .map((segment, index) => {
      let distanceM = 0;
      const route = segment.map((point, pointIndex) => {
        if (pointIndex > 0)
          distanceM += courseStats([
            [segment[pointIndex - 1], point],
          ]).distanceM;
        return {
          lat: point.lat,
          lng: point.lng,
          elevationM: point.elevationM,
          d: distanceM,
        };
      });
      return {
        name: course.name,
        sectionNumber: index + 1,
        distanceM,
        distanceKm: distanceM / 1_000,
        completeElevation: route.every(
          (point) => point.elevationM !== undefined,
        ),
        route,
      };
    })
    .filter((section) => section.distanceM > 0);
}

export function coursePreviewPosition(
  section: CoursePreviewSection,
  progressM: number,
) {
  const points = section.route;
  const distance = Math.max(0, Math.min(section.distanceM, progressM));
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].d <= distance) low = middle + 1;
    else high = middle;
  }
  const start = points[low - 1];
  const end = points[low];
  const ratio = end.d > start.d ? (distance - start.d) / (end.d - start.d) : 1;
  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: interpolateLongitude(start.lng, end.lng, ratio),
    ...(start.elevationM !== undefined && end.elevationM !== undefined
      ? {
          altitude:
            start.elevationM + (end.elevationM - start.elevationM) * ratio,
        }
      : {}),
  };
}

export function coursePreviewCamera(
  section: CoursePreviewSection,
  progressM: number,
  mode: "chase" | "overview",
): GoogleRouteCameraPose {
  const center = coursePreviewPosition(section, progressM);
  const behind = coursePreviewPosition(section, Math.max(0, progressM - 30));
  const ahead = coursePreviewPosition(
    section,
    Math.min(section.distanceM, progressM + 60),
  );
  const radians = Math.PI / 180;
  const deltaLng = (ahead.lng - behind.lng) * radians;
  const y = Math.sin(deltaLng) * Math.cos(ahead.lat * radians);
  const x =
    Math.cos(behind.lat * radians) * Math.sin(ahead.lat * radians) -
    Math.sin(behind.lat * radians) *
      Math.cos(ahead.lat * radians) *
      Math.cos(deltaLng);
  const missingElevation = !section.completeElevation;
  return {
    center,
    progressM,
    headingDeg:
      mode === "overview" || missingElevation
        ? 0
        : (Math.atan2(y, x) / radians + 360) % 360,
    rangeM: missingElevation
      ? 25_000
      : mode === "overview"
        ? Math.max(1_500, section.distanceM * 0.6)
        : 650,
    tiltDeg: mode === "overview" || missingElevation ? 0 : 50,
    fovDeg: 54,
  };
}
