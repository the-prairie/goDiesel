import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { replayStoryChapters } from "@/surfaces/replay/components/google-route-navigator-stage";

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
});
