import { describe, expect, it } from "vitest";

import type { RouteSummary } from "@/domain/route";
import { activityLabel, coverageLine } from "@/labs/design-seeds/seed-content";

const route = (type: string) => ({ type }) as RouteSummary;

describe("journal activity wording", () => {
  it("never labels a hike as a run", () => {
    expect(activityLabel(route("Hike"))).toBe("Hike");
    expect(activityLabel(route("Run"))).toBe("Run");
    expect(activityLabel(route("Ride"))).toBe("Ride");
  });

  it("describes a region of runs and hikes as on foot", () => {
    expect(coverageLine([route("Run"), route("Hike")])).toBe("on foot");
    expect(coverageLine([route("Ride")])).toBe("by bike");
    expect(coverageLine([route("Hike"), route("Ride")])).toBe("on foot and by bike");
  });
});
