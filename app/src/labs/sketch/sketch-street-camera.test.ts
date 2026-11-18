import { describe, expect, it } from "vitest";

import { eyeOf, streetCamera } from "@/labs/sketch/sketch-street-camera";
import type { LngLat } from "@/labs/sketch/sketch-reveal";

// A straight run heading north from (135, 35), 400 m long.
const north: LngLat[] = Array.from({ length: 41 }, (_, i) => [135, 35 + (i * 10) / 110540]);
const viewport = { height: 874 };
const metresNorth = (lat: number) => (lat - 35) * 110540;
const metresEast = (lng: number) => (lng - 135) * 111320 * Math.cos((35 * Math.PI) / 180);

describe("where the Street view stands", () => {
  it("in an open street: the view it always had, low at the start looking along the route", () => {
    const camera = streetCamera(north, () => 0, viewport);
    expect(camera).toMatchObject({ zoom: 18.2, pitch: 78 });
    expect(camera.bearing).toBeCloseTo(0, 0);
    expect(metresNorth(camera.center[1])).toBeCloseTo(0, 3);
  });

  it("moves along the first stretch, low still, when a building stands right at the start", () => {
    // A 25 m house on the route's first 15 m.
    const house = (lng: number, lat: number) => (Math.abs(metresEast(lng)) < 12 && metresNorth(lat) > -40 && metresNorth(lat) < 15 ? 25 : 0);
    const camera = streetCamera(north, house, viewport);
    expect(metresNorth(camera.center[1])).toBeGreaterThan(20);
    expect(camera.pitch).toBeGreaterThanOrEqual(68);
  });

  it("puts its eye where MapLibre does: behind the centre, along the bearing, high by the pitch", () => {
    const eye = eyeOf({ center: [135, 35], zoom: 18, pitch: 60, bearing: 0 }, viewport);
    expect(metresEast(eye.lng)).toBeCloseTo(0, 3);
    expect(metresNorth(eye.lat)).toBeLessThan(0);
    // tan(pitch) = back / height.
    expect(-metresNorth(eye.lat) / eye.heightM).toBeCloseTo(Math.tan((60 * Math.PI) / 180), 2);
  });

  it("in an ordinary street lined with buildings, keeps the street-level view", () => {
    // 15 m buildings along both sides, 10 m from the route's line, all the way.
    const canyon = (lng: number) => (Math.abs(metresEast(lng)) > 10 ? 15 : 0);
    const camera = streetCamera(north, (lng) => canyon(lng), viewport);
    expect(camera).toMatchObject({ zoom: 18.2, pitch: 78 });
  });

  it("never stands its eye inside a building or looks straight into a wall", () => {
    // A 40 m block across the route's first 60 m, 20 to 60 m north and 30 m to each side.
    const block = (lng: number, lat: number) => (Math.abs(metresEast(lng)) < 30 && metresNorth(lat) > 20 && metresNorth(lat) < 60 ? 40 : 0);
    const camera = streetCamera(north, block, viewport);
    const eye = eyeOf(camera, viewport);
    expect(block(eye.lng, eye.lat)).toBeLessThan(eye.heightM);
    // It moves on past the block, or rises over it.
    expect(metresNorth(camera.center[1]) > 60 || eye.heightM > 40).toBe(true);
  });

  it("with walls everywhere, still gives the least blocked view rather than none", () => {
    const camera = streetCamera(north, () => 300, viewport);
    expect(camera.center).toBeDefined();
    expect(camera.pitch).toBeLessThanOrEqual(60);
  });
});
