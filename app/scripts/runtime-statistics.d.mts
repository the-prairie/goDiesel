export interface QuantileEvidence {
  value: number | null;
  status: "available" | "insufficient-samples";
  minimumSamples: 2 | 20 | 100;
}

export interface DistributionEvidence {
  name: string;
  unit: string;
  sampleCount: number;
  min: number;
  max: number;
  mean: number;
  sampleStdDev: number;
  coefficientOfVariation: number | null;
  medianAbsoluteDeviation: number;
  p50: QuantileEvidence;
  p95: QuantileEvidence;
  p99: QuantileEvidence;
}

export function summarizeDistribution(
  name: string,
  unit: string,
  observations: number[],
): DistributionEvidence;

export function aggregateRuntimeStatistics(options: {
  rawDirectory: string;
  outputDirectory: string;
  sourceCommit: string;
  liveBlocker?: string;
}): {
  protocol: { measuredRepetitions: number; liveProvider: unknown };
  distributions: DistributionEvidence[];
  artifacts: Array<{ sha256: string }>;
};

export function normalizeProfileUrl(url?: string): string;
