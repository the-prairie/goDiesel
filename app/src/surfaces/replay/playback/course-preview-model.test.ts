import { describe, expect, it } from "vitest";

import { parseCourse, type CoursePoint } from "@/domain/courses";
import {
  coursePreviewCamera,
  coursePreviewPosition,
  coursePreviewSections,
} from "@/surfaces/replay/playback/course-preview-model";

function course(segments: CoursePoint[][]) {
  return parseCourse({
    id: "course-213a0076-6d18-5be9-9fb2-7a772888c6b5",
    name: "Course",
    description: "",
    activity: "Run",
    createdAt: "2026-10-21T07:00:00Z",
    source: { kind: "gpx", filename: "course.gpx" },
    segments,
    warnings: [],
  });
}

describe("saved course preview geometry", () => {
  it.each([
    [179.999, -179.999],
    [-179.999, 179.999],
  ])("previews the short antimeridian crossing from %s to %s", (from, to) => {
    const [section] = coursePreviewSections(
      course([
        [
          { lat: 0, lng: from, elevationM: 10 },
          { lat: 0, lng: to, elevationM: 20 },
        ],
      ]),
    );
    expect(section.distanceM).toBeCloseTo(222.39, 2);
    const midpoint = coursePreviewPosition(section, section.distanceM / 2);
    expect(Math.abs(midpoint.lng)).toBeCloseTo(180, 8);
    expect(midpoint.altitude).toBe(15);
  });

  it("keeps separate sections and excludes the unrecorded gap from distance and camera movement", () => {
    const sections = coursePreviewSections(
      course([
        [
          { lat: 51, lng: -114 },
          { lat: 51.001, lng: -114 },
        ],
        [
          { lat: 53, lng: -110 },
          { lat: 53.002, lng: -110 },
        ],
      ]),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].distanceM).toBeCloseTo(111.195, 2);
    expect(sections[1].distanceM).toBeCloseTo(222.39, 2);
    expect(sections[1].route[0].d).toBe(0);
    expect(coursePreviewPosition(sections[0], Infinity).lat).toBe(51.001);
    expect(coursePreviewPosition(sections[1], 0).lat).toBe(53);
  });

  it("preserves missing elevation and does not derive recorded time from imported point times", () => {
    const [section] = coursePreviewSections(
      course([
        [
          {
            lat: 51,
            lng: -114,
            time: "2026-10-21T07:00:00Z",
            elevationM: 1_050,
          },
          { lat: 51.001, lng: -114, time: "2026-10-21T07:02:00Z" },
        ],
      ]),
    );
    expect(section.completeElevation).toBe(false);
    expect(section.route[1].elevationM).toBeUndefined();
    expect(section.route[0]).not.toHaveProperty("time");
    expect(section.route[0]).not.toHaveProperty("elapsedS");
    const pose = coursePreviewCamera(section, section.distanceM / 2, "chase");
    expect(pose.center).not.toHaveProperty("altitude");
    expect(pose.tiltDeg).toBe(0);
    expect(pose.rangeM).toBe(25_000);
  });

  it("interpolates only inside a section and preserves supplied elevation", () => {
    const [section] = coursePreviewSections(
      course([
        [
          { lat: 51, lng: -114, elevationM: 1_000 },
          { lat: 51.002, lng: -114, elevationM: 1_100 },
        ],
      ]),
    );
    const midpoint = coursePreviewPosition(section, section.distanceM / 2);
    expect(midpoint.lat).toBeCloseTo(51.001, 8);
    expect(midpoint.lng).toBe(-114);
    expect(midpoint.altitude).toBe(1_050);
    expect(
      coursePreviewCamera(section, section.distanceM / 2, "chase").headingDeg,
    ).toBe(0);
  });

  it("retains original section numbers when a section has no connected path", () => {
    const sections = coursePreviewSections(
      course([
        [{ lat: 50, lng: -110 }],
        [
          { lat: 51, lng: -114 },
          { lat: 51, lng: -114 },
          { lat: 51.001, lng: -114 },
        ],
      ]),
    );
    expect(sections.map((section) => section.sectionNumber)).toEqual([2]);
    expect(coursePreviewPosition(sections[0], 0)).toEqual({
      lat: 51,
      lng: -114,
    });
  });
});
