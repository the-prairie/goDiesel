import { describe, expect, it } from "vitest";

import { PLACE_DEFAULT_LIGHT, lightAtHour, localStartHour, runLight } from "@/labs/overland/model/run-light";

describe("localStartHour", () => {
  it("reads the start in the route's own time zone, not the viewer's", () => {
    // Her Kyoto run started at 21:54 UTC, 06:54 in Japan.
    expect(localStartHour({ startTimeUtc: "2025-11-24T21:54:19Z", timeZone: "Asia/Tokyo", lng: 135.8 })).toBeCloseTo(6.9, 1);
    expect(localStartHour({ startTimeUtc: "2025-07-01T12:00:00Z", timeZone: "America/Edmonton", lng: -114 })).toBeCloseTo(6, 5);
  });

  it("falls back to solar time from the longitude when the zone is missing or unknown", () => {
    expect(localStartHour({ startTimeUtc: "2025-11-24T21:54:19Z", lng: 135 })).toBeCloseTo(6.9, 1);
    expect(localStartHour({ startTimeUtc: "2025-11-24T21:54:19Z", timeZone: "Not/AZone", lng: 135 })).toBeCloseTo(6.9, 1);
    expect(localStartHour({ startTimeUtc: "2025-01-01T02:00:00Z", lng: -90 })).toBeCloseTo(20, 5);
  });

  it("has no hour without a valid timestamp", () => {
    expect(localStartHour({ lng: 10 })).toBeNull();
    expect(localStartHour({ startTimeUtc: "yesterday", timeZone: "Europe/Rome", lng: 10 })).toBeNull();
  });
});

describe("lightAtHour", () => {
  it("buckets the day", () => {
    expect([0, 4.9, 5, 6.9, 7, 10.4, 10.5, 14.9, 15, 17.9, 18, 20.9, 21, 23.5].map(lightAtHour)).toEqual([
      "night", "night", "dawn", "dawn", "morning", "morning", "midday", "midday", "golden", "golden", "dusk", "dusk", "night", "night",
    ]);
  });
});

describe("runLight", () => {
  it("is the light of the run's local start, or the place's default without one", () => {
    expect(runLight({ startTimeUtc: "2025-11-24T21:54:19Z", timeZone: "Asia/Tokyo", lng: 135.8 })).toBe("dawn");
    expect(runLight({ lng: 135.8 })).toBe(PLACE_DEFAULT_LIGHT);
    expect(PLACE_DEFAULT_LIGHT).toBe("golden");
  });
});
