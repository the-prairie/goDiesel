import { describe, expect, it } from "vitest";

import { clockAt, effortColour, findStops, gradesOf, progressAtX, ridgeWindow, sampleRidge, scrubBy, tickStep, verticalRange } from "@/labs/sketch/sketch-ridge";

// A 10 km line: flat, a 1 km climb of 100 m (10%), flat, a 1 km descent, flat.
const route = Array.from({ length: 101 }, (_, i) => {
  const d = i * 100;
  const elev = d < 3000 ? 20 : d < 4000 ? 20 + (d - 3000) / 10 : d < 6000 ? 120 : d < 7000 ? 120 - (d - 6000) / 10 : 20;
  return { lat: 35, lng: 135, d, elev, elapsedS: i * 30 };
});

describe("sampleRidge", () => {
  it("reads elevation, time and distance along the route, between points", () => {
    expect(sampleRidge(route, 3550)).toMatchObject({ d: 3550, elev: 75, elapsedS: 1065 });
    expect(sampleRidge(route, -10).d).toBe(0);
    expect(sampleRidge(route, 99_999).d).toBe(10_000);
  });

  it("has no time where the route has none", () => {
    expect(sampleRidge(route.map(({ elapsedS: _e, ...p }) => p), 500).elapsedS).toBeUndefined();
  });
});

describe("ridgeWindow", () => {
  it("shows the whole run at rest", () => {
    expect(ridgeWindow({ totalM: 32_600, progressM: 25_100, zoom: 0 })).toEqual({ d0: 0, span: 32_600 });
  });

  it("opens to the 6 km round her when zoomed, kept inside the route", () => {
    expect(ridgeWindow({ totalM: 32_600, progressM: 25_100, zoom: 1 })).toEqual({ d0: 22_100, span: 6000 });
    expect(ridgeWindow({ totalM: 32_600, progressM: 500, zoom: 1 })).toEqual({ d0: 0, span: 6000 });
    expect(ridgeWindow({ totalM: 32_600, progressM: 32_500, zoom: 1 })).toEqual({ d0: 26_600, span: 6000 });
  });

  it("never zooms past the whole of a short route", () => {
    expect(ridgeWindow({ totalM: 4000, progressM: 1000, zoom: 1 })).toEqual({ d0: 0, span: 4000 });
  });
});

describe("verticalRange", () => {
  it("fits the hills with a little headroom", () => {
    const { lo, hi } = verticalRange([20, 120, 60], 0);
    expect(lo).toBe(20);
    expect(hi).toBeGreaterThanOrEqual(120);
  });

  it("keeps a flat run a calm low ridge, not amplified noise", () => {
    const { lo, hi } = verticalRange([10, 12, 11, 14], 0);
    expect(lo).toBe(10);
    expect(hi - lo).toBeGreaterThanOrEqual(80);
  });

  it("opens the vertical scale less when zoomed, at least 40 m", () => {
    const { lo, hi } = verticalRange([50, 52], 1);
    expect(hi - lo).toBeGreaterThanOrEqual(40);
    expect(hi - lo).toBeLessThan(80);
  });
});

describe("effort", () => {
  it("smooths the grade and reads flat ground as flat, not stripes", () => {
    const elev = [20, 20.4, 20.1, 20.5, 20.2, 20.6, 20.3, 20.4, 20.2, 20.5];
    expect(gradesOf(elev, 100).every((g) => g === 0)).toBe(true);
  });

  it("reads a steady climb and descent", () => {
    const climb = Array.from({ length: 20 }, (_, i) => i * 8);
    expect(gradesOf(climb, 100)[10]).toBeCloseTo(0.08, 3);
    expect(gradesOf(climb.map((e) => -e), 100)[10]).toBeCloseTo(-0.08, 3);
  });

  it("colours sand on the flat, deepening red as the climb steepens, sage going down", () => {
    expect(effortColour(0)).toEqual([222, 190, 146]);
    expect(effortColour(0.12)).toEqual([190, 40, 26]);
    const gentle = effortColour(0.03);
    const steep = effortColour(0.08);
    expect(steep[1]).toBeLessThan(gentle[1]);
    expect(effortColour(-0.1)).toEqual([118, 152, 140]);
  });
});

describe("findStops", () => {
  it("finds where she stood still four minutes or more, from time against distance", () => {
    // Moving 100 m in 30 s; a 6-minute pause at 5 km and a 2-minute one at 8 km.
    const paused = route.map((p, i) => ({ ...p, elapsedS: i * 30 + (i > 50 ? 360 : 0) + (i > 80 ? 120 : 0) }));
    expect(findStops(paused)).toEqual([{ d: 5000, minutes: 6 }]);
  });

  it("finds none without recorded time", () => {
    expect(findStops(route.map(({ elapsedS: _e, ...p }) => p))).toEqual([]);
  });
});

describe("clockAt", () => {
  it("tells the time of day where she ran, in the route's own time zone", () => {
    expect(clockAt("2025-11-23T23:04:23Z", 0, "Asia/Tokyo")).toBe("8:04 am");
    expect(clockAt("2025-11-23T23:04:23Z", 3 * 3600 + 25 * 60, "Asia/Tokyo")).toBe("11:29 am");
    expect(clockAt("2025-06-01T19:30:00Z", 0, "America/Edmonton")).toBe("1:30 pm");
  });

  it("says nothing without a start or a time zone", () => {
    expect(clockAt(undefined, 10, "Asia/Tokyo")).toBeNull();
    expect(clockAt("2025-11-23T23:04:23Z", 10, undefined)).toBeNull();
  });
});

describe("tickStep", () => {
  it("keeps kilometre ticks readable on short, long and zoomed ridges", () => {
    expect(tickStep(32_600)).toBe(5);
    expect(tickStep(6000)).toBe(1);
    expect(tickStep(7400)).toBe(1);
    expect(tickStep(191_900)).toBe(25);
  });
});

describe("dragging", () => {
  it("puts her where you touch at rest, and moves her by how far you drag when zoomed", () => {
    expect(progressAtX(100, 400, { d0: 0, span: 32_000 })).toBe(8000);
    expect(scrubBy(20_000, 40, 400, { d0: 17_000, span: 6000 }, 32_000)).toBe(20_600);
    expect(scrubBy(31_900, 400, 400, { d0: 26_000, span: 6000 }, 32_000)).toBe(32_000);
  });
});
