import { describe, expect, it } from "vitest";

import { cityView, farView, fitZoom, regionView, routeStartView, streetView } from "@/labs/sketch/sketch-camera";

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

describe("the view over a country or the whole world of her routes", () => {
  const screen = { width: 402, height: 874 };
  it("looks straight down over all of them, north up", () => {
    const camera = regionView([[[-123.4, 48.4], [-123.3, 48.5]], [[135.7, 35.0], [135.8, 35.1]]], screen);
    expect(camera.pitch).toBe(0);
    expect(camera.bearing).toBe(0);
    expect(camera.zoom).toBeLessThan(2);
    expect(camera.zoom).toBeGreaterThanOrEqual(0);
  });

  it("comes in closer for one country than for the world, but never closer than a city view", () => {
    const italy = regionView([[[11.3, 44.5], [11.4, 44.5]], [[12.4, 41.9], [12.5, 41.9]]], screen);
    expect(italy.zoom).toBeGreaterThan(3);
    const one = regionView([[[135.7, 35.0], [135.701, 35.001]]], screen);
    expect(one.zoom).toBeLessThanOrEqual(11);
  });
});

describe("the region view on a tall phone", () => {
  const screen = { width: 402, height: 874 };
  it("fits the routes into the band the buttons and the list leave free", () => {
    const lines: [number, number][][] = [[[11.3, 44.5], [11.4, 44.5]], [[12.4, 41.9], [12.5, 41.9]]];
    const plain = regionView(lines, screen);
    const banded = regionView(lines, screen, { top: 70, bottom: 170 });
    expect(banded.zoom).toBeLessThan(plain.zoom);
    // The list covers more below than the buttons above, so the view sits further south.
    expect(banded.center[1]).toBeLessThan(plain.center[1]);
  });

  it("shows the stretch of the world with most of her routes when they cannot all fit across", () => {
    // Three in western Canada, two in Europe, one in Japan: 260° apart, more than a phone shows.
    const at = (lng: number, lat: number): [number, number][] => [[lng, lat], [lng + 0.01, lat]];
    const lines = [at(-123.4, 48.4), at(-123.3, 48.5), at(-114, 51), at(12.5, 41.9), at(-0.1, 51.5), at(139.7, 35.7)];
    const camera = regionView(lines, screen);
    const half = (screen.width / (512 * 2 ** camera.zoom)) * 180;
    const inView = (lng: number) => Math.abs(lng - camera.center[0]) <= half;
    expect([-123.4, -114, 12.5, -0.1].every(inView)).toBe(true);
    expect(inView(139.7)).toBe(false);
  });
});

describe("the region view keeps her places clear of the keys down the right", () => {
  const screen = { width: 402, height: 874 };
  it("moves the view so the routes sit left of the keys", () => {
    const lines: [number, number][][] = [[[11.3, 44.5], [11.4, 44.5]], [[12.4, 41.9], [12.5, 41.9]]];
    const open = regionView(lines, screen, { top: 70, bottom: 170 });
    const kept = regionView(lines, screen, { top: 70, bottom: 170, right: 60 });
    expect(kept.zoom).toBeLessThanOrEqual(open.zoom);
    // The keys cover the right: the map's middle moves east, so the routes show further left.
    expect(kept.center[0]).toBeGreaterThan(open.center[0]);
  });
});
