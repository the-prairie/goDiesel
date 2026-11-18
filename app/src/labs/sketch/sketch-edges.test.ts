import { describe, expect, it } from "vitest";

import { buildingEdges } from "@/labs/sketch/sketch-edges";

const square: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

const segments = (edges: Float32Array) => {
  const out: number[][] = [];
  for (let i = 0; i < edges.length; i += 6) out.push([...edges.slice(i, i + 6)]);
  return out;
};

describe("buildingEdges", () => {
  it("draws a box as its roof outline, its base and its four corners", () => {
    const edges = segments(buildingEdges([square], 12, 0));
    const roof = edges.filter((s) => s[2] === 12 && s[5] === 12);
    const base = edges.filter((s) => s[2] === 0 && s[5] === 0);
    const corners = edges.filter((s) => s[2] !== s[5]);
    expect(roof).toHaveLength(4);
    expect(base).toHaveLength(4);
    expect(corners).toHaveLength(4);
    for (const corner of corners) expect([corner[2], corner[5]].sort()).toEqual([0, 12]);
  });

  it("starts a raised part at its minimum height", () => {
    const edges = segments(buildingEdges([square], 20, 8));
    expect(Math.min(...edges.flatMap((s) => [s[2], s[5]]))).toBe(8);
  });

  it("draws no corner where a wall only bends a little, as round a curved building", () => {
    const circle: [number, number][] = Array.from({ length: 25 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return [Math.cos(a) * 20, Math.sin(a) * 20];
    });
    const corners = segments(buildingEdges([circle], 10, 0)).filter((s) => s[2] !== s[5]);
    expect(corners).toHaveLength(0);
  });

  it("outlines a courtyard (an inner ring) at the roof only", () => {
    const hole: [number, number][] = [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
      [3, 3],
    ];
    const edges = segments(buildingEdges([square, hole], 12, 0));
    expect(edges.filter((s) => s[2] === 12 && s[5] === 12)).toHaveLength(8);
    expect(edges.filter((s) => s[2] === 0 && s[5] === 0)).toHaveLength(4);
  });

  it("draws nothing for a building with no height", () => {
    expect(buildingEdges([square], 0, 0)).toHaveLength(0);
  });
});
