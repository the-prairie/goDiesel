import { describe, expect, it } from "vitest";

import { frameStats, readoutLine } from "@/labs/sketch/moment-review-readout";

describe("the phone readout in review mode", () => {
  it("averages the frame times of the last few seconds and names the worst", () => {
    const now = 10_000;
    // Frames ending at these times, each with its own length.
    const frames = [
      { at: 6_000, ms: 90 }, // too old: outside the window
      { at: 8_000, ms: 16 },
      { at: 9_000, ms: 20 },
      { at: 9_500, ms: 48 },
    ];
    expect(frameStats(frames, now, 3_000)).toEqual({ averageMs: 28, worstMs: 48, frames: 3 });
    expect(frameStats([], now, 3_000)).toEqual({ averageMs: 0, worstMs: 0, frames: 0 });
  });

  it("says it all on one line with plain labels, to read out or paste", () => {
    const line = readoutLine({
      frame: { averageMs: 17.4, worstMs: 51.2, frames: 170 },
      tiles: { wanted: 6, drawn: 5 },
      lastTileMs: 1240.6,
      triangles: 412345.4,
      canvas: { width: 1206, height: 2622 },
      dpr: 3,
      contextLosses: 0,
    });
    expect(line).toBe("frame 17 ms average, 51 ms worst (last 3 s) · tiles 5 of 6 drawn · last tile 1241 ms · triangles 412,345 · canvas 1206×2622 at 3x · context lost 0 times");
  });

  it("says when no tile has been built yet", () => {
    const line = readoutLine({ frame: { averageMs: 0, worstMs: 0, frames: 0 }, tiles: { wanted: 0, drawn: 0 }, lastTileMs: null, triangles: 0, canvas: { width: 1, height: 1 }, dpr: 1, contextLosses: 1 });
    expect(line).toContain("last tile none yet");
    expect(line).toContain("context lost 1 time");
  });
});
