import { describe, expect, it } from "vitest";

import { activityNoun, isOnFoot } from "@/domain/route/activity";

describe("activity type", () => {
  it("names each supported activity for what it is", () => {
    expect(activityNoun("Run")).toBe("run");
    expect(activityNoun("Ride")).toBe("ride");
    expect(activityNoun("Hike")).toBe("hike");
  });

  it("keeps the historical run default for types it does not know", () => {
    expect(activityNoun("")).toBe("run");
    expect(activityNoun("Workout")).toBe("run");
  });

  it("treats a hike as on foot", () => {
    expect(isOnFoot("Hike")).toBe(true);
    expect(isOnFoot("Run")).toBe(true);
    expect(isOnFoot("Ride")).toBe(false);
  });
});
