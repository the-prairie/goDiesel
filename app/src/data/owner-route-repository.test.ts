import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { ownerRouteSummary } from "@/data/owner-route-repository";

describe("owner route repository", () => {
  it("projects a private detail into an Atlas and Finder summary", () => {
    const detail = {
      slug: "route-private",
      routeId: "route-private",
      activityId: "route-private",
      lifecycle: "discovered",
      route: [
        { lat: 51, lng: -114, elev: 0, d: 0 },
        { lat: 51.01, lng: -114.01, elev: 0, d: 1_000 },
      ],
      curation: {
        reviewStatus: "reviewed",
        terrain: ["trail", "mountain"],
        vibe: "high country",
      },
      replay: { geometryStatus: "ready" },
    } as QuestRoute;

    expect(ownerRouteSummary(detail)).toMatchObject({
      slug: "route-private",
      lifecycle: "discovered",
      trace: detail.route,
      guide: { reviewStatus: "reviewed", vibe: "high country" },
      discovery: {
        terrain: ["trail", "mountain"],
        vibes: ["high country"],
      },
    });
  });
});
