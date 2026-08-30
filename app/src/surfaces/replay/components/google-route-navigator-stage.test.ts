import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import {
  activeReplayStoryChapter,
  replayClimbM,
  replayStoryChapters,
} from "@/surfaces/replay/story-flight/story-flight-chapters";

describe("Story Flight chapters", () => {
  it("groups moments that share the same recorded route point", () => {
    const route = {
      distanceKm: 1.5,
      route: [
        { lat: 0, lng: 0, elev: 0, d: 0 },
        { lat: 0.01, lng: 0.01, elev: 100, d: 500 },
        { lat: 0, lng: 0.02, elev: 50, d: 1_000 },
        { lat: 0, lng: 0.03, elev: 0, d: 1_500 },
      ],
    } as QuestRoute;

    const chapters = replayStoryChapters(route, 1_500);

    expect(chapters).toHaveLength(3);
    expect(chapters[1]).toMatchObject({
      label: "Hardest rise + Sharpest turn + High point",
      progressM: 500,
      progressRatio: 1 / 3,
    });
  });

  it("selects the latest reached chapter", () => {
    const chapters = [
      { kind: "origin", label: "Origin", progressM: 0, progressRatio: 0 },
      { kind: "summit", label: "High point", progressM: 500, progressRatio: 0.5 },
      { kind: "arrival", label: "Arrival", progressM: 1_000, progressRatio: 1 },
    ] as ReturnType<typeof replayStoryChapters>;

    expect(activeReplayStoryChapter(chapters, 499)).toBe(0);
    expect(activeReplayStoryChapter(chapters, 500)).toBe(1);
    expect(activeReplayStoryChapter(chapters, 1_000)).toBe(2);
  });

  it("counts only completed positive elevation change", () => {
    const route = {
      route: [
        { lat: 0, lng: 0, elev: 10, d: 0 },
        { lat: 0, lng: 0.01, elev: 110, d: 1_000 },
        { lat: 0, lng: 0.02, elev: 60, d: 2_000 },
      ],
    } as QuestRoute;

    expect(replayClimbM(route, 500)).toBe(50);
    expect(replayClimbM(route, 1_500)).toBe(100);
  });
});
