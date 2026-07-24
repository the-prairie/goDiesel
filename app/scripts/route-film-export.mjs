import { PNG } from "pngjs";

export const DEFAULT_STABILITY_POLICY = Object.freeze({
  maximumMeanPixelChange: 5.5,
  minimumColorBins: 44,
  minimumLuminanceVariance: 135,
  requiredStableSamples: 2,
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
