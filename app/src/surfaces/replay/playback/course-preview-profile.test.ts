import { describe, expect, it } from "vitest";
import type { CoursePreviewSection } from "./course-preview-model";
import {
  coursePreviewProfile,
  courseProfileHeight,
} from "./course-preview-profile";

function section(elevations: Array<number | undefined>): CoursePreviewSection {
  return {
    name: "Profile",
    sectionNumber: 1,
    distanceM: 100 * (elevations.length - 1),
    distanceKm: (elevations.length - 1) / 10,
    completeElevation: elevations.every((value) => value !== undefined),
    route: elevations.map((elevationM, i) => ({
      lat: 51 + i / 1000,
      lng: -114,
      d: i * 100,
      elevationM,
    })),
  };
}

describe("course preview elevation profile", () => {
  it("preserves distances and supplied elevations, including below sea level", () => {
    const profile = coursePreviewProfile(section([-12, 0, 18, 3]));
    expect(profile.segments).toEqual([
      [
        { distanceM: 0, elevationM: -12 },
        { distanceM: 100, elevationM: 0 },
        { distanceM: 200, elevationM: 18 },
        { distanceM: 300, elevationM: 3 },
      ],
    ]);
    expect(courseProfileHeight(-12, profile)).toBe(0);
    expect(courseProfileHeight(3, profile)).toBe(0.5);
    expect(courseProfileHeight(18, profile)).toBe(1);
  });

  it("leaves missing elevation unconnected and retains isolated samples", () => {
    const profile = coursePreviewProfile(
      section([undefined, 10, 20, undefined, 30, undefined, 40, 50]),
    );
    expect(profile.segments).toEqual([
      [
        { distanceM: 100, elevationM: 10 },
        { distanceM: 200, elevationM: 20 },
      ],
      [{ distanceM: 400, elevationM: 30 }],
      [
        { distanceM: 600, elevationM: 40 },
        { distanceM: 700, elevationM: 50 },
      ],
    ]);
  });

  it("does not invent a profile for courses without elevation", () => {
    expect(
      coursePreviewProfile(section([undefined, undefined])).segments,
    ).toEqual([]);
  });

  it("centers a genuinely flat course without a zero-range division", () => {
    const profile = coursePreviewProfile(section([500, 500, 500]));
    expect(courseProfileHeight(500, profile)).toBe(0.5);
  });
});
