import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { normaliseRouteLine } from "@/labs/overland/model/route-line";

const xs = (line: Array<[number, number]>) => line.map(([x]) => x);
const ys = (line: Array<[number, number]>) => line.map(([, y]) => y);

describe("normaliseRouteLine", () => {
  it("stretches the longer side across 0 to 100 and centres the shorter one", () => {
    const line = normaliseRouteLine([
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 2 },
    ]);
    expect(Math.min(...xs(line))).toBeCloseTo(0, 6);
    expect(Math.max(...xs(line))).toBeCloseTo(100, 6);
    expect(Math.min(...ys(line)) + Math.max(...ys(line))).toBeCloseTo(100, 6);
    expect(Math.max(...ys(line)) - Math.min(...ys(line))).toBeCloseTo(25, 1);
  });

  it("scales longitude by latitude so shapes are not stretched east to west", () => {
    // At 60°N one degree of longitude is half a degree of latitude.
    const line = normaliseRouteLine([
      { lat: 60, lng: 0 },
      { lat: 60.5, lng: 1 },
    ]);
    const width = Math.max(...xs(line)) - Math.min(...xs(line));
    const height = Math.max(...ys(line)) - Math.min(...ys(line));
    expect(width / height).toBeCloseTo(1, 1);
  });

  it("draws north up, so y grows southward", () => {
    const [start, end] = normaliseRouteLine([
      { lat: 10, lng: 0 },
      { lat: 11, lng: 0 },
    ]);
    expect(start[1]).toBeGreaterThan(end[1]);
  });

  it("keeps the first and last points when it thins a long trace", () => {
    // Monotone in both axes, so the ends set the box whatever is thinned.
    const trace = Array.from({ length: 500 }, (_, index) => ({
      lat: 51 + index * 0.001,
      lng: -114 + index * 0.0005 + Math.sin(index / 20) * 0.0001,
    }));
    const full = normaliseRouteLine(trace, 1_000);
    const thinned = normaliseRouteLine(trace, 64);
    expect(thinned.length).toBeLessThanOrEqual(64);
    expect(thinned[0]).toEqual(full[0]);
    expect(thinned.at(-1)).toEqual(full.at(-1));
  });

  it("puts a trace with no extent in the middle, and an empty trace nowhere", () => {
    expect(normaliseRouteLine([{ lat: 5, lng: 5 }, { lat: 5, lng: 5 }])).toEqual([
      [50, 50],
      [50, 50],
    ]);
    expect(normaliseRouteLine([])).toEqual([]);
  });

  it("gives every bundled route a drawable line inside the box", () => {
    for (const route of routes) {
      const line = normaliseRouteLine(route.trace);
      expect(line.length, route.slug).toBeGreaterThanOrEqual(2);
      for (const [x, y] of line) {
        expect(x, route.slug).toBeGreaterThanOrEqual(0);
        expect(x, route.slug).toBeLessThanOrEqual(100);
        expect(y, route.slug).toBeGreaterThanOrEqual(0);
        expect(y, route.slug).toBeLessThanOrEqual(100);
      }
    }
  });
});
