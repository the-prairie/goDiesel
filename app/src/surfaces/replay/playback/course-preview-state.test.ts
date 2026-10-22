import { describe, expect, it } from "vitest";

import {
  initialCoursePreviewSession,
  reduceCoursePreviewLoad,
  reduceCoursePreviewSession,
  type CoursePreviewLoadState,
} from "@/surfaces/replay/playback/course-preview-state";

describe("course preview lifecycle", () => {
  it("ignores replaced requests and settled failures, and permits an explicit retry", () => {
    const loading: CoursePreviewLoadState = {
      phase: "loading",
      operationId: 2,
    };
    expect(
      reduceCoursePreviewLoad(loading, {
        type: "loadFailed",
        operationId: 1,
        message: "Old failure",
      }),
    ).toBe(loading);
    const failed = reduceCoursePreviewLoad(loading, {
      type: "loadFailed",
      operationId: 2,
      message: "Course unavailable",
    });
    expect(failed).toEqual({ phase: "failed", message: "Course unavailable" });
    expect(
      reduceCoursePreviewLoad(failed, {
        type: "loadFailed",
        operationId: 2,
        message: "Late failure",
      }),
    ).toBe(failed);
    expect(
      reduceCoursePreviewLoad(failed, { type: "loadStarted", operationId: 3 }),
    ).toEqual({ phase: "loading", operationId: 3 });
  });

  it("does not play before the provider is ready and stops when the provider fails", () => {
    const initial = initialCoursePreviewSession();
    expect(
      reduceCoursePreviewSession(initial, {
        type: "controlRequested",
        event: { type: "playbackToggled" },
      }),
    ).toBe(initial);
    const ready = reduceCoursePreviewSession(initial, {
      type: "providerChanged",
      status: { state: "ready", message: "Ready" },
    });
    const playing = reduceCoursePreviewSession(ready, {
      type: "controlRequested",
      event: { type: "playbackToggled" },
    });
    expect(playing.control.playing).toBe(true);
    const unavailable = reduceCoursePreviewSession(playing, {
      type: "providerChanged",
      status: { state: "unavailable", message: "Map unavailable" },
    });
    expect(unavailable.control.playing).toBe(false);
    expect(
      reduceCoursePreviewSession(unavailable, {
        type: "controlRequested",
        event: {
          type: "frameElapsed",
          elapsedSeconds: 0.1,
          totalDistanceM: 100,
        },
      }),
    ).toBe(unavailable);
  });

  it("moves by distance, stops at the section endpoint, and starts fresh for another section", () => {
    const ready = reduceCoursePreviewSession(initialCoursePreviewSession(), {
      type: "providerChanged",
      status: { state: "ready", message: "Ready" },
    });
    const seeked = reduceCoursePreviewSession(ready, {
      type: "controlRequested",
      event: {
        type: "progressSelected",
        progressM: 99.999,
        totalDistanceM: 100,
      },
    });
    const playing = reduceCoursePreviewSession(seeked, {
      type: "controlRequested",
      event: { type: "playbackToggled" },
    });
    const end = reduceCoursePreviewSession(playing, {
      type: "controlRequested",
      event: { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 100 },
    });
    expect(end.control.progressM).toBe(100);
    expect(end.control.playing).toBe(false);
    expect(initialCoursePreviewSession().control.progressM).toBe(0);
  });
});
