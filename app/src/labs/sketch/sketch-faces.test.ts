import { describe, expect, it } from "vitest";

import { FACE_STRIDE, buildingFaces, nearBuildings, triangulate } from "@/labs/sketch/sketch-faces";

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const ell: [number, number][] = [
  [0, 0],
  [20, 0],
  [20, 10],
  [10, 10],
  [10, 20],
  [0, 20],
  [0, 0],
];

const area = (ring: [number, number][], triangles: number[]) => {
  let sum = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [ring[triangles[i]], ring[triangles[i + 1]], ring[triangles[i + 2]]];
    sum += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  return sum;
};

describe("triangulate", () => {
  it("covers a square with two triangles", () => {
    const triangles = triangulate(square);
    expect(triangles).toHaveLength(6);
    expect(area(square, triangles)).toBeCloseTo(100);
  });

  it("covers an L-shaped footprint exactly, never outside its corner", () => {
    const triangles = triangulate(ell);
    expect(triangles).toHaveLength(12);
    expect(area(ell, triangles)).toBeCloseTo(300);
  });

  it("works whichever way the ring winds", () => {
    expect(area(ell, triangulate([...ell].reverse()))).toBeCloseTo(300);
  });
});

describe("buildingFaces", () => {
  it("makes a roof and four walls for a box, coloured, the walls a shade darker", () => {
    const faces = buildingFaces({ rings: [square], height: 12, minHeight: 0 }, [0.9, 0.8, 0.6], 1);
    expect(faces.length / FACE_STRIDE).toBe(3 * (2 + 4 * 2));
    // The roof comes first: two triangles, six vertices, all at the top.
    const roofRed = faces[3];
    expect(roofRed).toBeCloseTo(0.9);
    for (let v = 0; v < 6; v += 1) expect(faces[v * FACE_STRIDE + 2]).toBe(12);
    for (let i = 6 * FACE_STRIDE; i < faces.length; i += FACE_STRIDE) expect(faces[i + 3]).toBeLessThan(roofRed);
    // Every vertex carries the reveal's strength.
    for (let i = 0; i < faces.length; i += FACE_STRIDE) expect(faces[i + 6]).toBe(1);
  });
});

describe("nearBuildings", () => {
  it("keeps the buildings within the radius, closer ones at full strength", () => {
    const at = (x: number, y: number) => ({ rings: [square.map(([a, b]) => [a + x, b + y] as [number, number])], height: 6, minHeight: 0 });
    const near = nearBuildings([at(0, 0), at(0, 60), at(0, 400)], [[[-100, -5], [100, -5]]], 100);
    expect(near.map((item) => item.strength)).toEqual([1, 0.5]);
  });
});
