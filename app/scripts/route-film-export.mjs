import { PNG } from "pngjs";

export const DEFAULT_STABILITY_POLICY = Object.freeze({
  maximumMeanPixelChange: 5.5,
  minimumColorBins: 44,
  minimumLuminanceVariance: 135,
  requiredStableSamples: 2,
});

export const DEFAULT_VISUAL_QUALITY_POLICY = Object.freeze({
  blankMaximumColorBins: 4,
  blankMaximumLuminanceVariance: 18,
  detailEdgeThreshold: 11,
  flatRegionFindingFraction: 0.48,
  flatRegionRejectFraction: 0.82,
  hardBoundaryMinimumContrastRatio: 3.5,
  hardBoundaryMinimumCoverage: 0.72,
  hardBoundaryMinimumJump: 22,
  hardBoundaryMaximumJumpVariationRatio: 0.2,
  lowDetailMaximumColorBins: 14,
  lowDetailMaximumEdgeDensity: 0.035,
  lowDetailMaximumLuminanceVariance: 90,
  minimumScore: 60,
  similarPixelDistance: 9,
});

export function createFramePlan({
  durationSeconds,
  fps,
  motionSamples = 1,
}) {
  const captureFps = fps * motionSamples;
  const totalFrames = Math.ceil(durationSeconds * captureFps);
  return Array.from({ length: totalFrames }, (_, index) => ({
    filename: frameFilename(index),
    index,
    seconds: index / captureFps,
  }));
}

export function frameFilename(index) {
  return `frame-${String(index).padStart(6, "0")}.png`;
}

export function exportFingerprint(configuration) {
  return JSON.stringify({
    allowUnsettled: configuration.allowUnsettled,
    captureHeight: configuration.captureHeight,
    captureWidth: configuration.captureWidth,
    cut: configuration.cut,
    durationSeconds: Number(configuration.durationSeconds.toFixed(6)),
    fps: configuration.fps,
    motionSamples: configuration.motionSamples,
    route: configuration.route,
    sourceFingerprint: configuration.sourceFingerprint ?? "",
    qualityPolicyVersion: configuration.qualityPolicyVersion,
    settleAttempts: configuration.settleAttempts,
    settleDelayMs: configuration.settleDelayMs,
    stabilityPolicyVersion: configuration.stabilityPolicyVersion,
  });
}

export function visualSample(image) {
  const png = PNG.sync.read(image);
  const colors = new Set();
  const luminance = [];
  const pixels = [];
  const stride = Math.max(12, Math.floor(Math.min(png.width, png.height) / 56));
  for (let y = 0; y < png.height; y += stride) {
    for (let x = 0; x < png.width; x += stride) {
      const index = (y * png.width + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      luminance.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
      pixels.push(red, green, blue);
    }
  }
  const mean =
    luminance.reduce((total, value) => total + value, 0) / luminance.length;
  const luminanceVariance =
    luminance.reduce((total, value) => total + (value - mean) ** 2, 0) /
    luminance.length;
  return {
    colorBins: colors.size,
    luminanceVariance,
    pixels,
  };
}

export function sampleVisualGrid(
  { data, height, width },
  { columns = 32, rows = 18 } = {},
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length < width * height * 4
  ) {
    throw new TypeError("Expected complete RGBA image data.");
  }
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2
  ) {
    throw new TypeError("Visual grid must have at least two rows and columns.");
  }

  const pixels = [];
  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(
      height - 1,
      Math.floor(((row + 0.5) * height) / rows),
    );
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(
        width - 1,
        Math.floor(((column + 0.5) * width) / columns),
      );
      const index = (y * width + x) * 4;
      pixels.push([
        data[index],
        data[index + 1],
        data[index + 2],
      ]);
    }
  }

  return { columns, pixels, rows };
}

function colorDistance(left, right) {
  return (
    Math.abs(left[0] - right[0]) +
    Math.abs(left[1] - right[1]) +
    Math.abs(left[2] - right[2])
  ) / 3;
}

function luminance(pixel) {
  return pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
}

function largestSimilarRegion(grid, maximumDistance) {
  const visited = new Uint8Array(grid.pixels.length);
  let largest = 0;

  for (let start = 0; start < grid.pixels.length; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    const pending = [start];
    let size = 0;

    while (pending.length > 0) {
      const index = pending.pop();
      size += 1;
      const row = Math.floor(index / grid.columns);
      const column = index % grid.columns;
      const neighbors = [
        column > 0 ? index - 1 : -1,
        column + 1 < grid.columns ? index + 1 : -1,
        row > 0 ? index - grid.columns : -1,
        row + 1 < grid.rows ? index + grid.columns : -1,
      ];

      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          !visited[neighbor] &&
          colorDistance(grid.pixels[index], grid.pixels[neighbor]) <=
            maximumDistance
        ) {
          visited[neighbor] = 1;
          pending.push(neighbor);
        }
      }
    }

    largest = Math.max(largest, size);
  }

  return largest / grid.pixels.length;
}

function boundaryCandidate(grid, orientation, offset, policy) {
  const vertical = orientation === "vertical";
  const length = vertical ? grid.rows : grid.columns;
  let jumpTotal = 0;
  let baselineTotal = 0;
  let suspicious = 0;
  const jumps = [];

  for (let position = 0; position < length; position += 1) {
    const index = vertical
      ? position * grid.columns + offset
      : offset * grid.columns + position;
    const step = vertical ? 1 : grid.columns;
    const jump = colorDistance(
      grid.pixels[index - step],
      grid.pixels[index],
    );
    const before = colorDistance(
      grid.pixels[index - step * 2],
      grid.pixels[index - step],
    );
    const after = colorDistance(
      grid.pixels[index],
      grid.pixels[index + step],
    );
    const baseline = (before + after) / 2;
    jumps.push(jump);
    jumpTotal += jump;
    baselineTotal += baseline;
    if (
      jump >= policy.hardBoundaryMinimumJump &&
      jump >= baseline * policy.hardBoundaryMinimumContrastRatio
    ) {
      suspicious += 1;
    }
  }

  const meanJump = jumpTotal / length;
  const meanBaseline = baselineTotal / length;
  const jumpDeviation = Math.sqrt(
    jumps.reduce(
      (total, jump) => total + (jump - meanJump) ** 2,
      0,
    ) / jumps.length,
  );
  return {
    contrastRatio: meanJump / Math.max(1, meanBaseline),
    coverage: suspicious / length,
    jumpVariationRatio: jumpDeviation / Math.max(1, meanJump),
    meanJump,
    offset,
    orientation,
  };
}

function strongestHardBoundary(grid, policy) {
  let strongest = null;
  const consider = (candidate) => {
    const qualifying =
      candidate.coverage >= policy.hardBoundaryMinimumCoverage &&
      candidate.meanJump >= policy.hardBoundaryMinimumJump &&
      candidate.contrastRatio >= policy.hardBoundaryMinimumContrastRatio &&
      candidate.jumpVariationRatio <=
        policy.hardBoundaryMaximumJumpVariationRatio;
    if (
      qualifying &&
      (!strongest ||
        candidate.coverage > strongest.coverage ||
        (candidate.coverage === strongest.coverage &&
          candidate.contrastRatio > strongest.contrastRatio))
    ) {
      strongest = candidate;
    }
  };

  for (let column = 2; column < grid.columns - 1; column += 1) {
    consider(boundaryCandidate(grid, "vertical", column, policy));
  }
  for (let row = 2; row < grid.rows - 1; row += 1) {
    consider(boundaryCandidate(grid, "horizontal", row, policy));
  }

  return strongest;
}

export function evaluateVisualQuality(
  grid,
  policy = DEFAULT_VISUAL_QUALITY_POLICY,
) {
  if (
    !Number.isInteger(grid?.columns) ||
    !Number.isInteger(grid?.rows) ||
    grid.columns < 4 ||
    grid.rows < 4 ||
    grid.pixels?.length !== grid.columns * grid.rows
  ) {
    throw new TypeError("Expected a complete visual sample grid.");
  }

  const colorBins = new Set();
  const luminances = grid.pixels.map((pixel) => {
    colorBins.add(`${pixel[0] >> 4}:${pixel[1] >> 4}:${pixel[2] >> 4}`);
    return luminance(pixel);
  });
  const meanLuminance =
    luminances.reduce((total, value) => total + value, 0) /
    luminances.length;
  const luminanceVariance =
    luminances.reduce(
      (total, value) => total + (value - meanLuminance) ** 2,
      0,
    ) / luminances.length;

  let edges = 0;
  let comparisons = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const index = row * grid.columns + column;
      if (column + 1 < grid.columns) {
        edges +=
          colorDistance(grid.pixels[index], grid.pixels[index + 1]) >=
          policy.detailEdgeThreshold
            ? 1
            : 0;
        comparisons += 1;
      }
      if (row + 1 < grid.rows) {
        edges +=
          colorDistance(
            grid.pixels[index],
            grid.pixels[index + grid.columns],
          ) >= policy.detailEdgeThreshold
            ? 1
            : 0;
        comparisons += 1;
      }
    }
  }

  const edgeDensity = edges / comparisons;
  const largestLowVariationRegion = largestSimilarRegion(
    grid,
    policy.similarPixelDistance,
  );
  const strongestBoundary = strongestHardBoundary(grid, policy);
  const blank =
    colorBins.size <= policy.blankMaximumColorBins &&
    luminanceVariance <= policy.blankMaximumLuminanceVariance;
  const lowDetail =
    colorBins.size <= policy.lowDetailMaximumColorBins &&
    luminanceVariance <= policy.lowDetailMaximumLuminanceVariance &&
    edgeDensity <= policy.lowDetailMaximumEdgeDensity;
  const hardBoundary = strongestBoundary !== null;

  const findings = [];
  if (blank) findings.push("blank");
  else if (lowDetail) findings.push("low-detail");
  if (
    largestLowVariationRegion >= policy.flatRegionFindingFraction
  ) {
    findings.push("large-low-variation-region");
  }
  if (hardBoundary) findings.push("hard-boundary");

  const flatRegionPenalty =
    35 *
    Math.max(
      0,
      (largestLowVariationRegion - policy.flatRegionFindingFraction) /
        (1 - policy.flatRegionFindingFraction),
    );
  const score = Math.max(
    0,
    Math.round(
      100 -
        (blank ? 100 : 0) -
        (!blank && lowDetail ? 55 : 0) -
        flatRegionPenalty -
        (hardBoundary ? 45 : 0),
    ),
  );
  const severeFlatRegion =
    largestLowVariationRegion >= policy.flatRegionRejectFraction;

  return {
    accepted:
      score >= policy.minimumScore &&
      !blank &&
      !lowDetail &&
      !hardBoundary &&
      !severeFlatRegion,
    findings,
    metrics: {
      colorBins: colorBins.size,
      edgeDensity,
      largestLowVariationRegion,
      luminanceVariance,
      strongestBoundary,
    },
    score,
  };
}

export function meanPixelChange(previous, current) {
  if (previous.length !== current.length) return Number.POSITIVE_INFINITY;
  let difference = 0;
  for (let index = 0; index < current.length; index += 1) {
    difference += Math.abs(previous[index] - current[index]);
  }
  return difference / current.length;
}

export function evaluateVisualStability(
  samples,
  policy = DEFAULT_STABILITY_POLICY,
) {
  let stableSamples = 0;
  let bestColorBins = 0;
  let bestLuminanceVariance = 0;
  let finalMeanPixelChange = Number.POSITIVE_INFINITY;

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const previous = samples[index - 1];
    bestColorBins = Math.max(bestColorBins, current.colorBins);
    bestLuminanceVariance = Math.max(
      bestLuminanceVariance,
      current.luminanceVariance,
    );
    finalMeanPixelChange = previous
      ? meanPixelChange(previous.pixels, current.pixels)
      : Number.POSITIVE_INFINITY;
    const detailed =
      current.colorBins >= policy.minimumColorBins &&
      current.luminanceVariance >= policy.minimumLuminanceVariance;
    stableSamples =
      detailed && finalMeanPixelChange <= policy.maximumMeanPixelChange
        ? stableSamples + 1
        : 0;
  }

  return {
    bestColorBins,
    bestLuminanceVariance,
    finalMeanPixelChange,
    stable: stableSamples >= policy.requiredStableSamples,
    stableSamples,
  };
}

export function createExportManifest(configuration, framePlan) {
  return {
    completedFrames: {},
    configuration,
    createdAt: new Date().toISOString(),
    fingerprint: exportFingerprint(configuration),
    frameCount: framePlan.length,
    status: "capturing",
    version: 1,
  };
}

export function resumeFrameIndex(manifest, framePlan, existingFiles) {
  for (const frame of framePlan) {
    const evidence = manifest.completedFrames?.[frame.index];
    const validEvidence =
      evidence &&
      evidence.visualQuality?.accepted === true &&
      (evidence.settled !== false ||
        manifest.configuration?.allowUnsettled === true);
    if (!validEvidence || !existingFiles.has(frame.filename)) {
      return frame.index;
    }
  }
  return framePlan.length;
}

export function timelineVolumeExpression(timeline, volumes) {
  return timeline.reduceRight(
    (next, shot) =>
      `if(lt(t\\,${shot.endSeconds.toFixed(3)})\\,${volumes[shot.kind] ?? 0.01}\\,${next})`,
    "0.01",
  );
}
