import { describe, expect, it } from "vitest";

import { recordedLightAt } from "@/domain/geometry/recorded-light";
import type { RoutePoint, RouteTemporalProvenance } from "@/domain/route";

const route: RoutePoint[] = [
  { lat: 35, lng: 135, elev: 10, d: 0, elapsedS: 0 },
  { lat: 35.1, lng: 135.1, elev: 20, d: 1_000, elapsedS: 10_800 },
];

function temporal(startTimeUtc: string): RouteTemporalProvenance {
  return {
    status: "recorded",
    startTimeUtc,
    elapsedTimeS: 10_800,
    timeZone: "Asia/Tokyo",
  };
}

describe("recordedLightAt", () => {
  it.each([
    ["2026-07-12T20:30:00Z", "dawn"],
    ["2026-07-12T03:00:00Z", "midday"],
    ["2026-07-12T09:30:00Z", "dusk"],
    ["2026-07-12T14:00:00Z", "night"],
  ] as const)("maps recorded local time to %s", (startTimeUtc, phase) => {
    expect(recordedLightAt(route, temporal(startTimeUtc), 0)).toMatchObject({
      status: "recorded",
      phase,
    });
  });

  it("uses recorded point elapsed time at the active route distance", () => {
    const light = recordedLightAt(route, temporal("2026-07-12T20:30:00Z"), 1_000);

    expect(light).toMatchObject({ status: "recorded", phase: "midday" });
    if (light.status !== "recorded") throw new Error("expected recorded light");
    expect(light.localTimeLabel).toContain("8:30");
  });

  it("stays neutral without both a recorded timestamp and timezone", () => {
    expect(
      recordedLightAt(route, { status: "recorded", startTimeUtc: "2026-07-12T12:00:00Z", elapsedTimeS: 1 }, 0),
    ).toEqual({ status: "neutral", phase: "neutral" });
    expect(recordedLightAt(route, { status: "unavailable" }, 0)).toEqual({
      status: "neutral",
      phase: "neutral",
    });
  });
});
