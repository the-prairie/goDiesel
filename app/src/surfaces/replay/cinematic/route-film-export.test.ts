import { describe, expect, it } from "vitest";

// @ts-expect-error The offline renderer is intentionally a Node ESM module.
import * as routeFilmExport from "../../../../scripts/route-film-export.mjs";

const {
  createExportManifest,
  createFramePlan,
  evaluateVisualQuality,
  evaluateVisualStability,
  exportFingerprint,
  frameFilename,
  resumeFrameIndex,
  sampleVisualGrid,
} = routeFilmExport;

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

function visualGrid(
  pixel: (column: number, row: number) => [number, number, number],
  columns = 24,
  rows = 16,
) {
  return {
    columns,
    pixels: Array.from({ length: columns * rows }, (_, index) =>
      pixel(index % columns, Math.floor(index / columns)),
    ),
    rows,
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

  it("samples RGBA frames on a deterministic normalized grid", () => {
    const rgba = new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]);

    expect(
      sampleVisualGrid(
        { data: rgba, height: 2, width: 2 },
        { columns: 2, rows: 2 },
      ),
    ).toEqual({
      columns: 2,
      pixels: [
        [10, 20, 30],
        [40, 50, 60],
        [70, 80, 90],
        [100, 110, 120],
      ],
      rows: 2,
    });
  });

  it("rejects blank and uniformly low-detail frames", () => {
    const blank = evaluateVisualQuality(visualGrid(() => [248, 248, 248]));
    expect(blank.accepted).toBe(false);
    expect(blank.score).toBe(0);
    expect(blank.findings).toContain("blank");

    const lowDetail = evaluateVisualQuality(
      visualGrid((column) => {
        const value = 96 + Math.floor(column / 6) * 5;
        return [value, value + 1, value + 2];
      }),
    );
    expect(lowDetail.accepted).toBe(false);
    expect(lowDetail.findings).toContain("low-detail");
  });

  it("accepts varied city and terrain-like imagery", () => {
    const cityTerrain = evaluateVisualQuality(
      visualGrid((column, row) => {
        if (row < 5) {
          const cloud = (column * 11 + row * 7) % 29;
          return [104 + cloud, 151 + cloud, 188 + cloud];
        }
        const texture = (column * 37 + row * 53 + column * row * 3) % 96;
        return [
          42 + texture,
          58 + ((texture * 3) % 112),
          38 + ((texture * 5) % 104),
        ];
      }),
    );

    expect(cityTerrain.accepted).toBe(true);
    expect(cityTerrain.findings).toEqual([]);
    expect(cityTerrain.score).toBeGreaterThanOrEqual(90);
  });

  it("reports a large flat region without rejecting a detailed landscape", () => {
    const landscapeWithSky = evaluateVisualQuality(
      visualGrid((column, row) => {
        if (row < 8) return [112, 166, 205];
        const texture = (column * 41 + row * 29) % 120;
        return [35 + texture, 62 + (texture % 88), 44 + (texture % 71)];
      }),
    );

    expect(landscapeWithSky.accepted).toBe(true);
    expect(landscapeWithSky.findings).toContain(
      "large-low-variation-region",
    );
    expect(
      landscapeWithSky.metrics.largestLowVariationRegion,
    ).toBeCloseTo(0.5);
  });

  it("rejects a low-variation region that overwhelms the frame", () => {
    const mostlyFlat = evaluateVisualQuality(
      visualGrid((column, row) => {
        if (row < 14) return [118, 162, 196];
        const texture = (column * 47 + row * 31) % 120;
        return [31 + texture, 48 + (texture % 91), 39 + (texture % 73)];
      }),
    );

    expect(mostlyFlat.accepted).toBe(false);
    expect(mostlyFlat.findings).toContain("large-low-variation-region");
    expect(mostlyFlat.metrics.largestLowVariationRegion).toBeCloseTo(
      14 / 16,
    );
  });

  it("rejects long hard boundaries that dominate an image", () => {
    const tileBoundary = evaluateVisualQuality(
      visualGrid((column, row) => {
        const texture = (column * 17 + row * 23) % 9;
        return column < 12
          ? [58 + texture, 91 + texture, 70 + texture]
          : [151 + texture, 167 + texture, 148 + texture];
      }),
    );

    expect(tileBoundary.accepted).toBe(false);
    expect(tileBoundary.findings).toContain("hard-boundary");
    expect(
      tileBoundary.metrics.strongestBoundary.orientation,
    ).toBe("vertical");
    expect(tileBoundary.metrics.strongestBoundary.offset).toBe(12);
    expect(tileBoundary.metrics.strongestBoundary.coverage).toBe(1);
  });

  it("detects a qualifying hard boundary despite a stronger nonqualifying candidate", () => {
    const competingBoundaries = evaluateVisualQuality(
      visualGrid((column, row) => {
        const verticalBoundary = column < 12 ? 30 : 90;
        const horizontalOffset = row < 8 ? 0 : column < 14 ? 45 : 90;
        const value = verticalBoundary + horizontalOffset;
        return [value, value, value];
      }),
    );

    expect(competingBoundaries.accepted).toBe(false);
    expect(competingBoundaries.findings).toContain("hard-boundary");
    expect(competingBoundaries.metrics.strongestBoundary).toMatchObject({
      coverage: 1,
      offset: 12,
      orientation: "vertical",
    });
  });

  it("resumes at the first frame without evidence or a file", () => {
    const configuration = {
      captureHeight: 2160,
      captureWidth: 3840,
      cut: "feature",
      durationSeconds: 2,
      fps: 2,
      motionSamples: 1,
      qualityPolicyVersion: 1,
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
    manifest.completedFrames[0] = {
      settled: true,
      visualQuality: { accepted: true },
    };
    manifest.completedFrames[1] = {
      settled: true,
      visualQuality: { accepted: true },
    };
    expect(
      resumeFrameIndex(
        manifest,
        frames,
        new Set(["frame-000000.png", "frame-000001.png"]),
      ),
    ).toBe(2);
    expect(exportFingerprint(configuration)).toBe(manifest.fingerprint);
  });

  it("invalidates cached frames when manifest or director versions change", () => {
    const configuration = {
      allowUnsettled: false,
      captureHeight: 1080,
      captureWidth: 1920,
      cut: "feature",
      directorVersion: 2,
      durationSeconds: 17.5,
      filmKind: "trailer",
      fps: 24,
      manifestVersion: 2,
      motionSamples: 1,
      qualityPolicyVersion: 1,
      route: "route-private",
      settleAttempts: 12,
      settleDelayMs: 180,
      stabilityPolicyVersion: 1,
    };

    expect(exportFingerprint({ ...configuration, manifestVersion: 3 })).not.toBe(
      exportFingerprint(configuration),
    );
    expect(exportFingerprint({ ...configuration, directorVersion: 3 })).not.toBe(
      exportFingerprint(configuration),
    );
    expect(exportFingerprint({ ...configuration, filmKind: "feature" })).not.toBe(
      exportFingerprint(configuration),
    );
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
        qualityPolicyVersion: 1,
        route: "route",
        settleAttempts: 12,
        settleDelayMs: 180,
        stabilityPolicyVersion: 1,
      },
      frames,
    );
    manifest.completedFrames[0] = {
      settled: false,
      visualQuality: { accepted: true },
    };

    expect(
      resumeFrameIndex(manifest, frames, new Set(["frame-000000.png"])),
    ).toBe(0);
  });

  it("resumes diagnostic unsettled frames only with accepted visual quality", () => {
    const frames = createFramePlan({
      durationSeconds: 1,
      fps: 1,
      motionSamples: 1,
    });
    const manifest = createExportManifest(
      {
        allowUnsettled: true,
        captureHeight: 2160,
        captureWidth: 3840,
        cut: "feature",
        durationSeconds: 1,
        fps: 1,
        motionSamples: 1,
        qualityPolicyVersion: 1,
        route: "route",
        settleAttempts: 12,
        settleDelayMs: 180,
        stabilityPolicyVersion: 1,
      },
      frames,
    );
    manifest.completedFrames[0] = {
      settled: false,
      visualQuality: { accepted: true },
    };

    expect(
      resumeFrameIndex(manifest, frames, new Set(["frame-000000.png"])),
    ).toBe(1);
    manifest.completedFrames[0].visualQuality.accepted = false;
    expect(
      resumeFrameIndex(manifest, frames, new Set(["frame-000000.png"])),
    ).toBe(0);
  });

  it("does not resume frames captured before visual quality evidence existed", () => {
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
        qualityPolicyVersion: 1,
        route: "route",
        settleAttempts: 12,
        settleDelayMs: 180,
        stabilityPolicyVersion: 1,
      },
      frames,
    );
    manifest.completedFrames[0] = { settled: true };

    expect(
      resumeFrameIndex(manifest, frames, new Set(["frame-000000.png"])),
    ).toBe(0);
  });
});
