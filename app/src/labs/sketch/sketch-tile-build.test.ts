import { describe, expect, it } from "vitest";

import { BUILDING, oneBuildingTile } from "../../../e2e/helpers/one-building-tile";
import { roofAt } from "@/labs/sketch/sketch-roof-tops";
import { buildTile } from "@/labs/sketch/sketch-tile-build";

describe("a made tile", () => {
  it("names each building's box and drawn top, so a marker can stand on its roof", () => {
    const made = buildTile(new Uint8Array(oneBuildingTile()), "14/14370/6490", null);
    expect(made.tops.length).toBe(5);
    expect([...made.tops.slice(0, 4)]).toEqual([BUILDING.west, BUILDING.north, BUILDING.east, BUILDING.south]);
    const top = made.tops[4];
    expect(top).toBeGreaterThan(3);
    expect(roofAt(made.tops, 2030, 2030)).toBe(top);
  });
});
