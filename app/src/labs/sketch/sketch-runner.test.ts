import { describe, expect, it } from "vitest";

import { SKETCH_INK, SKETCH_RED, sketchRunnerFrames } from "@/labs/sketch/sketch-runner";

describe("sketchRunnerFrames", () => {
  it("draws her in ink from behind, with the one red accent, in four steps of a stride", () => {
    const frames = sketchRunnerFrames("run", 60);
    expect(frames.urls).toHaveLength(4);
    expect(new Set(frames.urls).size).toBe(4);
    for (const url of frames.urls) {
      const svg = decodeURIComponent(url.replace("data:image/svg+xml;charset=utf-8,", ""));
      expect(svg).toContain(SKETCH_INK);
      expect(svg).toContain(SKETCH_RED);
      expect(svg).toMatch(/^<svg /);
    }
  });

  it("sizes the figure to the screen, taller on a taller screen", () => {
    expect(sketchRunnerFrames("run", 900).height).toBeGreaterThan(sketchRunnerFrames("run", 600).height);
    expect(sketchRunnerFrames("run", 900).height).toBeGreaterThanOrEqual(44);
  });

  it("draws a rider on a bike for a ride", () => {
    const svg = decodeURIComponent(sketchRunnerFrames("ride", 800).urls[0]);
    expect(svg).toContain("<circle");
  });
});
