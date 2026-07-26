import { describe, expect, it } from "vitest";

import { patinaForRoute, type PatinaInput } from "@/domain/route-patina";

describe("route patina", () => {
  const now = Date.parse("2026-07-16T12:00:00Z");

  it("renders planned routes as pencil", () => {
    const style = patinaForRoute({ lifecycle: "planned" }, now);
    expect(style.kind).toBe("pencil");
    expect(style.stroke).toBe("var(--graphite)");
  });

  it("deepens wear with travel count", () => {
    const once = patinaForRoute({ travelCount: 1, lastTraveledAt: "2026-07-01" }, now);
    const often = patinaForRoute({ travelCount: 30, lastTraveledAt: "2026-07-01" }, now);
    expect(often.wear).toBeGreaterThan(once.wear);
    expect(often.strokeWidthPx).toBeGreaterThan(once.strokeWidthPx);
  });

  it("fades forgotten routes but keeps a legible floor", () => {
    const recent = patinaForRoute(
      { travelCount: 3, lastTraveledAt: "2026-07-10" } satisfies PatinaInput,
      now,
    );
    const old = patinaForRoute(
      { travelCount: 3, lastTraveledAt: "2025-01-01" } satisfies PatinaInput,
      now,
    );
    expect(recent.freshness).toBeGreaterThan(old.freshness);
    expect(old.opacity).toBeGreaterThanOrEqual(0.28);
  });
});
