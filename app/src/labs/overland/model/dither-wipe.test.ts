import { describe, expect, it } from "vitest";

import { WIPE_STEPS } from "@/labs/overland/overland-jump-state";
import {
  CROSSFADE_MS,
  DIVE_MS,
  WIPE_STEP_MS,
  cellCovered,
  coverPixelScale,
  ditherRank,
  nativeRect,
} from "@/labs/overland/model/dither-wipe";

describe("the wipe schedule", () => {
  it("clears in eight steps over 600 to 900 ms", () => {
    expect(WIPE_STEPS).toBe(8);
    const total = WIPE_STEPS * WIPE_STEP_MS;
    expect(total).toBeGreaterThanOrEqual(600);
    expect(total).toBeLessThanOrEqual(900);
  });

  it("dives in well under half a second and crossfades in 200 ms", () => {
    expect(DIVE_MS).toBeGreaterThanOrEqual(300);
    expect(DIVE_MS).toBeLessThanOrEqual(500);
    expect(CROSSFADE_MS).toBe(200);
  });
});

describe("the ordered dither", () => {
  it("gives every cell of a 4 by 4 tile a different rank", () => {
    const ranks = new Set<number>();
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) ranks.add(ditherRank(x, y));
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(ditherRank(5, 6)).toBe(ditherRank(1, 2));
  });

  it("covers exactly the given share of each tile, and a cleared cell stays clear", () => {
    for (let step = 0; step <= WIPE_STEPS; step += 1) {
      const coverage = 1 - step / WIPE_STEPS;
      let covered = 0;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          if (cellCovered(x, y, coverage)) covered += 1;
          else expect(cellCovered(x, y, coverage - 1 / WIPE_STEPS)).toBe(false);
        }
      }
      expect(covered / 16).toBeCloseTo(coverage);
    }
  });

  it("is fully covered at 1 and fully clear at 0", () => {
    expect(cellCovered(3, 3, 1)).toBe(true);
    expect(cellCovered(0, 0, 0)).toBe(false);
  });
});

describe("the cover's pixels", () => {
  it("are chunky on every screen: about 130 to 240 pixels across", () => {
    for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
      const k = coverPixelScale(width);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(Math.ceil(width / k)).toBeLessThanOrEqual(240);
    }
    expect(Math.ceil(390 / coverPixelScale(390))).toBeGreaterThanOrEqual(120);
  });

  it("maps a screen rectangle to cover pixels by rounding outwards", () => {
    expect(nativeRect({ left: 10, top: 801, width: 100, height: 43 }, 4)).toEqual({ left: 2, top: 200, width: 26, height: 11 });
    expect(nativeRect({ left: 0, top: 0, width: 8, height: 8 }, 4)).toEqual({ left: 0, top: 0, width: 2, height: 2 });
  });
});
