import { describe, expect, it } from "vitest";
import type { Course } from "@/domain/courses";
import {
  initialCourseWorkspace as initial,
  reduceCourseWorkspace as reduce,
} from "./course-workspace-state";

const course: Course = {
  id: "course-11111111-1111-4111-8111-111111111111",
  name: "Park loop",
  description: "Imported route",
  activity: "Run",
  createdAt: "2026-10-21T12:00:00Z",
  source: { kind: "gpx", filename: "park.gpx" },
  segments: [
    [
      { lat: 37, lng: -122 },
      { lat: 37.01, lng: -122 },
    ],
  ],
  distanceM: 1112,
  ascentM: null,
  warnings: [],
};
describe("course workspace", () => {
  it("does not restore a preview after its request is cancelled", () => {
    const pending = reduce(initial, {
      type: "start",
      id: 1,
      operation: "generate",
    });
    const cancelled = reduce(pending, { type: "cancel" });
    expect(reduce(cancelled, { type: "previewed", id: 1, course })).toEqual(
      cancelled,
    );
  });
  it("ignores late completion from an older request", () => {
    const latest = reduce(
      reduce(initial, { type: "start", id: 1, operation: "import" }),
      { type: "start", id: 2, operation: "generate" },
    );
    expect(
      reduce(latest, { type: "failed", id: 1, message: "old error" }),
    ).toEqual(latest);
    expect(reduce(latest, { type: "previewed", id: 2, course }).view).toEqual({
      kind: "preview",
      course,
    });
  });
  it("keeps the preview on a failed save and saves one entry on retry", () => {
    const preview = reduce(
      reduce(initial, { type: "start", id: 1, operation: "import" }),
      { type: "previewed", id: 1, course },
    );
    const failed = reduce(
      reduce(preview, { type: "start", id: 2, operation: "save" }),
      { type: "failed", id: 2, message: "Store unavailable" },
    );
    expect(failed.view).toEqual({ kind: "preview", course });
    const saved = reduce(
      reduce(failed, { type: "start", id: 3, operation: "save" }),
      { type: "saved", id: 3, course },
    );
    expect(saved.view.kind).toBe("saved");
    expect(
      reduce(reduce(saved, { type: "start", id: 4, operation: "save" }), {
        type: "saved",
        id: 4,
        course,
      }).courses,
    ).toHaveLength(1);
  });
  it("a new course closes the selected course but preserves the library", () => {
    const loaded = reduce(
      reduce(initial, { type: "start", id: 1, operation: "load" }),
      { type: "loaded", id: 1, courses: [course], course },
    );
    expect(reduce(loaded, { type: "new" })).toEqual({
      ...initial,
      courses: [course],
    });
  });
  it("navigation clears the previous downloadable course even if cancelled or failed", () => {
    const loaded = reduce(
      reduce(initial, { type: "start", id: 1, operation: "load" }),
      { type: "loaded", id: 1, courses: [course], course },
    );
    const navigating = reduce(loaded, {
      type: "start",
      id: 2,
      operation: "load",
    });
    expect(reduce(navigating, { type: "cancel" }).view).toEqual({
      kind: "empty",
    });
    expect(
      reduce(navigating, { type: "failed", id: 2, message: "Course not found" })
        .view,
    ).toEqual({ kind: "empty" });
  });
});
