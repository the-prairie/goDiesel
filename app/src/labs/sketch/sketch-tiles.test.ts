import { describe, expect, it } from "vitest";

import { tilesToDraw } from "@/labs/sketch/sketch-tiles";

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
