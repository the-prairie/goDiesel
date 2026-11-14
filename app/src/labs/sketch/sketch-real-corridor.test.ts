import { describe, expect, it } from "vitest";

import { MAX_SEGMENTS, nearestSegments } from "@/labs/sketch/sketch-real-corridor";

describe("nearestSegments", () => {
  // Two routes on a local metre plane.
  const lines: [number, number][][] = [
    Array.from({ length: 200 }, (_, i) => [i * 50, 0] as [number, number]),
    [
      [0, 5000],
      [100, 5000],
    ],
  ];

  it("gives the shader the stretches of route nearest the view, as many as it holds", () => {
    const segments = nearestSegments(lines, [3000, 0]);
    expect(segments).toHaveLength(MAX_SEGMENTS);
    // The nearest stretch, round x = 3000, is among them; the far route is not.
    expect(segments.some(([ax, , bx]) => ax <= 3000 && bx >= 3000)).toBe(true);
    expect(segments.some(([, ay]) => ay === 5000)).toBe(false);
  });

  it("keeps every stretch when there are few, and none from a route of one point", () => {
    expect(nearestSegments([[[0, 0], [10, 0], [20, 0]], [[5, 5]]], [0, 0])).toEqual([
      [0, 0, 10, 0],
      [10, 0, 20, 0],
    ]);
  });
});
