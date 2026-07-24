import { describe, expect, it } from "vitest";

// @ts-expect-error The offline renderer is intentionally a Node ESM module.
import { createExportManifest, createFramePlan, evaluateVisualStability, exportFingerprint, frameFilename, resumeFrameIndex } from "../../../scripts/route-film-export.mjs";

function sample(
  value: number,
  overrides: Record<string, number> = {},
) {
  return {
    colorBins: 80,
    luminanceVariance: 240,
    pixels: Array.from({ length: 24 }, () => value),
    ...overrides,
  };
}

describe("route film export", () => {
  it("creates a deterministic fixed-time frame plan", () => {
    const frames = createFramePlan({
      durationSeconds: 1,
      fps: 24,
      motionSamples: 2,
    });
    expect(frames).toHaveLength(48);
    expect(frames[0]).toEqual({
      filename: "frame-000000.png",
      index: 0,
      seconds: 0,
    });
    expect(frames.at(-1)?.seconds).toBeCloseTo(47 / 48);
    expect(frameFilename(42)).toBe("frame-000042.png");
  });

  it("requires detailed consecutive stable samples", () => {
    const unstable = evaluateVisualStability([
      sample(20),
      sample(80),
      sample(22),
    ]);
    expect(unstable.stable).toBe(false);

    const stable = evaluateVisualStability([
      sample(20),
      sample(21),
      sample(21),
    ]);
    expect(stable.stable).toBe(true);
    expect(stable.finalMeanPixelChange).toBe(0);

    const blank = evaluateVisualStability([
      sample(20, { colorBins: 2, luminanceVariance: 0 }),
      sample(20, { colorBins: 2, luminanceVariance: 0 }),
      sample(20, { colorBins: 2, luminanceVariance: 0 }),
    ]);
    expect(blank.stable).toBe(false);
  });

  it("resumes at the first frame without evidence or a file", () => {
    const configuration = {
      captureHeight: 2160,
      captureWidth: 3840,
      cut: "feature",
      durationSeconds: 2,
      fps: 2,
      motionSamples: 1,
      route: "route",
      settleAttempts: 12,
      settleDelayMs: 180,
      stabilityPolicyVersion: 1,
    };
    const frames = createFramePlan({
      durationSeconds: 2,
      fps: 2,
      motionSamples: 1,
    });
    const manifest = createExportManifest(configuration, frames);
    manifest.completedFrames[0] = { settled: true };
    manifest.completedFrames[1] = { settled: true };
    expect(
      resumeFrameIndex(
        manifest,
        frames,
        new Set(["frame-000000.png", "frame-000001.png"]),
      ),
    ).toBe(2);
    expect(exportFingerprint(configuration)).toBe(manifest.fingerprint);
  });

  it("does not resume strict exports from diagnostic unsettled frames", () => {
    const frames = createFramePlan({
      durationSeconds: 1,
      fps: 1,
      motionSamples: 1,
    });
    const manifest = createExportManifest(
      {
        allowUnsettled: false,
        captureHeight: 2160,
        captureWidth: 3840,
        cut: "feature",
        durationSeconds: 1,
        fps: 1,
        motionSamples: 1,
        route: "route",
        settleAttempts: 12,
        settleDelayMs: 180,
        stabilityPolicyVersion: 1,
      },
      frames,
    );
    manifest.completedFrames[0] = { settled: false };

    expect(
      resumeFrameIndex(manifest, frames, new Set(["frame-000000.png"])),
    ).toBe(0);
  });
});
