import { describe, expect, it } from "vitest";

import { bearingAt, markerRotation, markerSize, scrubKeyTarget } from "@/labs/sketch/sketch-replay-controls";

describe("scrubKeyTarget", () => {
  const total = 30_000;
  it("steps 1% with the arrows, 5% with shift, 10% by page, and jumps to the ends", () => {
    expect(scrubKeyTarget({ key: "ArrowRight", shiftKey: false }, 9_000, total)).toBe(9_300);
    expect(scrubKeyTarget({ key: "ArrowUp", shiftKey: false }, 9_000, total)).toBe(9_300);
    expect(scrubKeyTarget({ key: "ArrowLeft", shiftKey: true }, 9_000, total)).toBe(7_500);
    expect(scrubKeyTarget({ key: "PageUp", shiftKey: false }, 9_000, total)).toBe(12_000);
    expect(scrubKeyTarget({ key: "PageDown", shiftKey: false }, 9_000, total)).toBe(6_000);
    expect(scrubKeyTarget({ key: "Home", shiftKey: false }, 9_000, total)).toBe(0);
    expect(scrubKeyTarget({ key: "End", shiftKey: false }, 9_000, total)).toBe(total);
  });

  it("stays within the route and leaves other keys alone", () => {
    expect(scrubKeyTarget({ key: "ArrowRight", shiftKey: true }, 29_900, total)).toBe(total);
    expect(scrubKeyTarget({ key: "ArrowLeft", shiftKey: false }, 100, total)).toBe(0);
    expect(scrubKeyTarget({ key: "a", shiftKey: false }, 100, total)).toBeNull();
  });
});

describe("the position marker", () => {
  it("is larger close up and smaller over the whole route, never vanishing or looming", () => {
    expect(markerSize(150)).toBe(32);
    expect(markerSize(300)).toBe(32);
    expect(markerSize(20_000)).toBe(18);
    expect(markerSize(1_500)).toBeLessThan(32);
    expect(markerSize(1_500)).toBeGreaterThan(18);
    expect(markerSize(undefined)).toBe(24);
  });

  it("points along the route relative to the camera, as seen on screen", () => {
    expect(markerRotation(90, 0)).toBe(90);
    expect(markerRotation(90, 90)).toBe(0);
    expect(markerRotation(10, 350)).toBe(20);
    expect(markerRotation(350, 10)).toBe(-20);
  });

  it("reads the route's bearing where she is", () => {
    // North, then east.
    const route = [
      { lat: 35, lng: 135, d: 0 },
      { lat: 35.001, lng: 135, d: 111 },
      { lat: 35.001, lng: 135.001, d: 202 },
    ];
    expect(bearingAt(route, 50)).toBeCloseTo(0, 0);
    expect(bearingAt(route, 150)).toBeCloseTo(90, 0);
    expect(bearingAt(route, 500)).toBeCloseTo(90, 0);
  });
});
