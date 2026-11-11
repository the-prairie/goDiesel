import { describe, expect, it } from "vitest";

import { seededUnitValue, splayFan, splayPlacement } from "@/ui/route-gallery/splay";

const OPTIONS = { containerWidth: 700, cardWidth: 180, seed: "17654151284" };

describe("splay geometry", () => {
  it("centres the fan whatever the count", () => {
    for (const count of [2, 3, 8]) {
      const total = splayFan(count, OPTIONS).reduce(
        (sum, placement) => sum + placement.x,
        0,
      );
      expect(Math.abs(total)).toBeLessThan(0.0001);
    }
  });

  it("places cards left to right in route order", () => {
    const fan = splayFan(5, OPTIONS);
    const xs = fan.map((placement) => placement.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("never lets the fan exceed its container", () => {
    const fan = splayFan(12, OPTIONS);
    const width =
      Math.max(...fan.map((p) => p.x)) - Math.min(...fan.map((p) => p.x)) +
      OPTIONS.cardWidth;
    expect(width).toBeLessThanOrEqual(OPTIONS.containerWidth + 1);
  });

  it("tightens the overlap as cards are added rather than growing", () => {
    const few = splayFan(3, OPTIONS);
    const many = splayFan(10, OPTIONS);
    const gap = (fan: typeof few) => fan[1].x - fan[0].x;
    expect(gap(many)).toBeLessThan(gap(few));
  });

  it("keeps a single card square and centred", () => {
    expect(splayPlacement(0, 1, OPTIONS)).toEqual({
      x: 0,
      y: 0,
      rotationDeg: 0,
      zIndex: 0,
    });
  });

  it("is deterministic, so a route always fans the same way", () => {
    expect(splayFan(6, OPTIONS)).toEqual(splayFan(6, OPTIONS));
  });

  it("fans differently for a different route", () => {
    const other = splayFan(6, { ...OPTIONS, seed: "13358070690" });
    expect(splayFan(6, OPTIONS)).not.toEqual(other);
  });

  it("keeps rotation within its bound", () => {
    for (const placement of splayFan(9, OPTIONS)) {
      expect(Math.abs(placement.rotationDeg)).toBeLessThanOrEqual(9);
    }
  });

  it("removes rotation and lift when asked to lie flat", () => {
    for (const placement of splayFan(6, { ...OPTIONS, flat: true })) {
      expect(placement.rotationDeg).toBe(0);
      expect(placement.y).toBe(0);
    }
  });

  it("stacks later cards above earlier ones", () => {
    const fan = splayFan(4, OPTIONS);
    expect(fan.map((placement) => placement.zIndex)).toEqual([0, 1, 2, 3]);
  });

  it("maps a seed into the unit interval", () => {
    for (const seed of ["a", "b", "17654151284:3"]) {
      const value = seededUnitValue(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
