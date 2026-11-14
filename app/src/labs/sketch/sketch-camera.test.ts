import { describe, expect, it } from "vitest";

import { cityView, farView, fitZoom, routeStartView, streetView } from "@/labs/sketch/sketch-camera";

const line: [number, number][] = [
  [135.77, 35.0],
  [135.772, 35.0],
  [135.78, 35.01],
];

describe("camera targets", () => {
  it("starts far out, flat, over the whole country", () => {
    const far = farView();
    expect(far.zoom).toBeLessThan(5.5);
    expect(far.pitch).toBe(0);
  });

  it("fits the city view to her routes there, tilted, closer on a wide screen than a narrow one", () => {
    const wide = cityView([line], { width: 1440, height: 900 });
    const phone = cityView([line], { width: 375, height: 640 });
    expect(wide.center[0]).toBeCloseTo(135.775, 3);
    expect(wide.center[1]).toBeCloseTo(35.005, 3);
    expect(wide.pitch).toBeGreaterThan(30);
    expect(wide.zoom).toBeGreaterThan(phone.zoom);
    expect(phone.zoom).toBeGreaterThan(12);
  });

  it("fits a box: halving the screen takes one zoom level off", () => {
    const box = { west: 0, east: 1, south: 0, north: 1 };
    expect(fitZoom(box, { width: 1024, height: 1024 }, 0) - fitZoom(box, { width: 512, height: 512 }, 0)).toBeCloseTo(1, 5);
  });

  it("puts the route start close and tilted, looking along the route's first stretch", () => {
    const start = routeStartView(line);
    expect(start.center).toEqual(line[0]);
    expect(start.zoom).toBeGreaterThan(16);
    expect(start.pitch).toBeGreaterThanOrEqual(55);
    // The first stretch runs east, then north-east.
    expect(start.bearing).toBeGreaterThan(30);
    expect(start.bearing).toBeLessThan(90);
  });

  it("goes low and steep for the street view", () => {
    const street = streetView(line);
    expect(street.pitch).toBeGreaterThan(routeStartView(line).pitch);
    expect(street.zoom).toBeGreaterThan(17);
  });

  it("does not fail on a route of one point", () => {
    expect(routeStartView([[135, 35]]).bearing).toBe(0);
  });
});
