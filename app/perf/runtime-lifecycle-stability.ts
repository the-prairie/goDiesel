export const LIFECYCLE_HEAP_STABILITY_PROTOCOL = {
  minimumCycles: 12,
  maximumCycles: 40,
  window: 8,
  maximumRangeRatio: 1.04,
  maximumNormalizedSlopePerCycle: 0.0025,
  maximumHalfDriftRatio: 1.01,
} as const;

export interface LifecycleHeapStabilityAssessment {
  stable: boolean;
  sampleCount: number;
  windowSampleCount: number;
  observedRangeRatio: number;
  normalizedSlopePerCycle: number;
  observedHalfDriftRatio: number;
}

function mean(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function assessLifecycleHeapStability(
  heapBytes: readonly number[],
): LifecycleHeapStabilityAssessment {
  const protocol = LIFECYCLE_HEAP_STABILITY_PROTOCOL;
  const windowValues = heapBytes.slice(-protocol.window);
  if (
    heapBytes.length < protocol.minimumCycles ||
    windowValues.length < protocol.window ||
    windowValues.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return {
      stable: false,
      sampleCount: heapBytes.length,
      windowSampleCount: windowValues.length,
      observedRangeRatio: Number.POSITIVE_INFINITY,
      normalizedSlopePerCycle: Number.POSITIVE_INFINITY,
      observedHalfDriftRatio: Number.POSITIVE_INFINITY,
    };
  }

  const average = mean(windowValues);
  const center = (windowValues.length - 1) / 2;
  let covariance = 0;
  let xVariance = 0;
  windowValues.forEach((value, index) => {
    const centeredIndex = index - center;
    covariance += centeredIndex * (value - average);
    xVariance += centeredIndex ** 2;
  });
  const normalizedSlopePerCycle = covariance / xVariance / average;
  const half = windowValues.length / 2;
  const firstHalfMean = mean(windowValues.slice(0, half));
  const secondHalfMean = mean(windowValues.slice(half));
  const observedHalfDriftRatio =
    Math.max(firstHalfMean, secondHalfMean) /
    Math.min(firstHalfMean, secondHalfMean);
  const observedRangeRatio =
    Math.max(...windowValues) / Math.min(...windowValues);

  return {
    stable:
      observedRangeRatio <= protocol.maximumRangeRatio &&
      Math.abs(normalizedSlopePerCycle) <=
        protocol.maximumNormalizedSlopePerCycle &&
      observedHalfDriftRatio <= protocol.maximumHalfDriftRatio,
    sampleCount: heapBytes.length,
    windowSampleCount: windowValues.length,
    observedRangeRatio,
    normalizedSlopePerCycle,
    observedHalfDriftRatio,
  };
}
