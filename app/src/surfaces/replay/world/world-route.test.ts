import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Group, Vector3 } from "three";
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


describe("foreground route treatment", () => {
  it("samples the rider's bracketing points first without starving background work", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { route, trace } = fixture(true);
    trace.update(1950,179);
    const sample = vi.fn((_lat: number, _lng: number, _seed: number) => 1100);
    trace.settle(sample,0);
    expect(sample.mock.calls.length).toBeLessThanOrEqual(8);
    expect(sample.mock.calls[0]).toEqual([route.route[19].lat,route.route[19].lng,0]);
    expect(sample.mock.calls[1]).toEqual([route.route[20].lat,route.route[20].lng,0]);
    for (let i=1;i<6;i++) { trace.invalidate(); trace.settle(sample,i*16); }
    expect(new Set(sample.mock.calls.map(call => call[1])).size).toBe(25);
    trace.dispose();
  });
  it("keeps the rider at eighteen CSS pixels across camera distances", () => {
    const { trace } = fixture();
    trace.update(50,179);
    const marker = trace.group.children.find(child => child instanceof Group)!;
    const camera = new PerspectiveCamera(50,1,0.1,100000);
    for (const distance of [179,1000,10000]) {
      camera.position.copy(marker.position).add(new Vector3(0,0,distance));
      camera.lookAt(marker.position); camera.updateMatrixWorld();
      trace.projectMarker(camera,720);
      expect(2*9*marker.scale.x / (2*distance*Math.tan(50*Math.PI/360)) * 720).toBeCloseTo(18);
    }
    trace.dispose();
  });
});
