import { describe, expect, it } from "vitest";

import { groundAtFoot, riseAt, tilesForView, tilesToDraw } from "@/labs/sketch/sketch-tiles";

const keys = (tiles: { x: number; y: number }[]) => tiles.map(({ x, y }) => `${x}/${y}`);

describe("tilesToDraw", () => {
  it("looking straight down, takes the tiles round the middle of the view, nearest first", () => {
    const tiles = tilesToDraw({ camera: [10.5, 20.5], center: [10.5, 20.5], maxTiles: 9 });
    expect(tiles).toHaveLength(9);
    expect(keys(tiles)[0]).toBe("10/20");
    expect(keys(tiles)).toEqual(expect.arrayContaining(["9/19", "11/21", "10/21"]));
  });

  it("tilted low, starts under the camera, where the nearest buildings stand, not at the far middle of the view", () => {
    // A street-level view: the camera stands four tiles short of what it looks at.
    const tiles = tilesToDraw({ camera: [10.5, 24.5], center: [10.5, 20.5], maxTiles: 6 });
    expect(keys(tiles)[0]).toBe("10/24");
    expect(keys(tiles)).toContain("10/23");
    expect(keys(tiles)).toContain("10/22");
    expect(tiles.length).toBeLessThanOrEqual(6);
  });

  it("never asks for the same tile twice", () => {
    const tiles = tilesToDraw({ camera: [3.2, 3.7], center: [5.9, 1.1], maxTiles: 20 });
    expect(new Set(keys(tiles)).size).toBe(tiles.length);
  });
});

// Mercator tile coordinates at zoom z, for checking the ground point.
const tileOf = (lng: number, lat: number, z: number): [number, number] => {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

describe("groundAtFoot", () => {
  const view = { center: [135.77, 35.0] as [number, number], zoom: 16, height: 800, fovDeg: 36.87 };

  it("looking straight down, is half a screen below the middle", () => {
    const [x, y] = groundAtFoot({ ...view, pitch: 0, bearing: 0 }, 16);
    const [cx, cy] = tileOf(135.77, 35.0, 16);
    expect(x).toBeCloseTo(cx, 6);
    // 512 px tiles: half of 800 px is 400/512 of a tile.
    expect(y - cy).toBeCloseTo(400 / 512, 4);
  });

  it("tilted, stands nearer the camera along the line of sight, behind the way it looks", () => {
    const [cx, cy] = tileOf(135.77, 35.0, 16);
    // Pitch 60, field of view 36.87: the foot of the screen is 0.634 of the screen height short of the middle.
    const [x, y] = groundAtFoot({ ...view, pitch: 60, bearing: 0 }, 16);
    expect(x).toBeCloseTo(cx, 6);
    expect(y - cy).toBeCloseTo((0.6336 * 800) / 512, 2);
    // Looking east, the foot lies to the west.
    const [ex, ey] = groundAtFoot({ ...view, pitch: 60, bearing: 90 }, 16);
    expect(cx - ex).toBeCloseTo((0.6336 * 800) / 512, 2);
    expect(ey).toBeCloseTo(cy, 6);
  });

  it("is the same point at another tile zoom, scaled", () => {
    const a = groundAtFoot({ ...view, pitch: 50, bearing: -30 }, 16);
    const b = groundAtFoot({ ...view, pitch: 50, bearing: -30 }, 14);
    expect(b[0]).toBeCloseTo(a[0] / 4, 6);
    expect(b[1]).toBeCloseTo(a[1] / 4, 6);
  });
});

describe("tilesForView", () => {
  it("takes the tiles a camera will draw, from the ground at its foot to its middle", () => {
    const camera = { center: [135.77, 35.0] as [number, number], zoom: 16.4, pitch: 60, bearing: 20, height: 714, fovDeg: 36.87 };
    const expected = tilesToDraw({ camera: groundAtFoot(camera, 14), center: tileOf(135.77, 35.0, 14), maxTiles: 6 });
    expect(tilesForView(camera, 14, 6)).toEqual(expected);
  });
});

describe("riseAt", () => {
  it("lets a building tile rise from the ground over the draw, eased, and stay up", () => {
    expect(riseAt(0, 700)).toBe(0);
    expect(riseAt(350, 700)).toBeGreaterThan(0.5);
    expect(riseAt(700, 700)).toBe(1);
    expect(riseAt(5000, 700)).toBe(1);
  });

  it("with no draw (reduced motion), is up at once", () => {
    expect(riseAt(0, 0)).toBe(1);
  });
});
