import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestRoute } from "@/domain/route";
import { WorldRoute } from "./world-route";
import { WorldFrame } from "./world-frame";

afterEach(() => vi.restoreAllMocks());
function fixture(missing = false) {
  const route = { route: Array.from({ length: 25 }, (_, i) => ({ lat: 51, lng: -114 + i * 0.001, elev: 1000, d: i * 100 })),
    elevationStatus: missing ? "unavailable" : "recorded",
    provenance: { discontinuities: [], elevation: { status: missing ? "unavailable" : "recorded" } },
  } as unknown as QuestRoute;
  return { route, trace: new WorldRoute(route, new WorldFrame(51, -114)) };
}

describe("route grounding during continuous refinement", () => {
  it("does not starve later points when tile visibility changes every frame", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { route, trace } = fixture(true);
    const seen = new Set<number>();
    const sample = vi.fn((_lat: number, lng: number) => { seen.add(lng); return 1100; });
    try {
      for (let frame = 0; frame < 4; frame++) {
        const before = sample.mock.calls.length;
        trace.invalidate(); trace.settle(sample, frame * 16);
        expect(sample.mock.calls.length - before).toBeLessThanOrEqual(8);
      }
      expect(seen.size).toBe(route.route.length);
      expect(trace.grounded).toBe(true);
      expect(route.route.every((point) => point.elev === 1000)).toBe(true);
    } finally { trace.dispose(); }
  });
  it("stops sampling a settled route until new terrain arrives", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { trace } = fixture();
    const sample = vi.fn(() => 1000);
    try {
      for (let i = 0; i < 5; i++) trace.settle(sample, i * 16);
      expect(sample).toHaveBeenCalledTimes(25);
      trace.invalidate(); trace.settle(sample, 100);
      expect(sample).toHaveBeenCalledTimes(33);
    } finally { trace.dispose(); }
  });
});
