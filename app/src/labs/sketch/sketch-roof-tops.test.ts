import { describe, expect, it } from "vitest";

import { roofAt, topOf, TOP_STRIDE } from "@/labs/sketch/sketch-roof-tops";

describe("the tops of the drawn buildings", () => {
  it("is the highest point of a building's faces, roof and rooftop boxes included", () => {
    // Faces are nine floats a vertex: x, y, z, then six more.
    const v = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];
    expect(topOf(new Float32Array([...v(0), ...v(9), ...v(12.6), ...v(3)]))).toBeCloseTo(12.6, 5);
    expect(topOf(new Float32Array())).toBe(0);
  });

  it("finds the roof under a point: the smallest building whose box holds it", () => {
    expect(TOP_STRIDE).toBe(5);
    const tops = new Float32Array([
      0, 0, 100, 100, 30, // a big block around it
      40, 40, 60, 60, 9, // the house it stands on
      200, 200, 210, 210, 50, // far away
    ]);
    expect(roofAt(tops, 50, 50)).toBe(9);
    expect(roofAt(tops, 10, 10)).toBe(30);
    expect(roofAt(tops, 150, 150)).toBeNull();
  });
});
