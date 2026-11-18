import { describe, expect, it } from "vitest";

import { TREE_SEGMENTS, treesIn } from "@/labs/sketch/sketch-trees";

const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

describe("treesIn (tree places invented inside real parks)", () => {
  const trees = (edges: Float32Array) => edges.length / 6 / TREE_SEGMENTS;

  it("plants a park of a hectare with about a hundred trees, none outside it", () => {
    const edges = treesIn([[square(0, 0, 100)]], { metresPerUnit: 1, seed: 1 });
    expect(trees(edges)).toBeGreaterThan(60);
    expect(trees(edges)).toBeLessThan(140);
    for (let i = 0; i < edges.length; i += 3) {
      expect(edges[i]).toBeGreaterThanOrEqual(-4);
      expect(edges[i]).toBeLessThanOrEqual(104);
    }
  });

  it("stands each tree on the ground with its crown above its trunk", () => {
    const edges = treesIn([[square(0, 0, 30)]], { metresPerUnit: 1, seed: 2 });
    const zs = [...edges].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBeGreaterThan(5);
  });

  it("leaves a courtyard in a park empty", () => {
    const edges = treesIn([[square(0, 0, 100), [...square(30, 30, 40)].reverse()]], { metresPerUnit: 1, seed: 3 });
    for (let i = 0; i < edges.length; i += 6) {
      if (edges[i + 2] !== 0) continue;
      const [x, y] = [edges[i], edges[i + 1]];
      expect(x > 31 && x < 69 && y > 31 && y < 69).toBe(false);
    }
  });

  it("is the same every time, and keeps to a budget in a forest", () => {
    expect(treesIn([[square(0, 0, 50)]], { metresPerUnit: 1, seed: 4 })).toEqual(treesIn([[square(0, 0, 50)]], { metresPerUnit: 1, seed: 4 }));
    expect(trees(treesIn([[square(0, 0, 2000)]], { metresPerUnit: 1, seed: 5 }))).toBeLessThanOrEqual(1500);
  });
});
