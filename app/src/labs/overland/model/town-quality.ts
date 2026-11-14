// How much of the town a device draws. The town starts at a tier chosen
// from what the browser says about the device, then steps down one tier at
// a time while frames run over budget: first the pixel ratio and the
// shadow map shrink, then the forest thins from the outside in.

export type QualityTier = "high" | "medium" | "low";

const TIERS: readonly QualityTier[] = ["high", "medium", "low"];

/** A frame slower than this, as the median of a window, is over budget. */
export const FRAME_BUDGET_MS = 24;
/** How many frames are measured before each judgement. */
export const FRAME_WINDOW = 40;

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  /** The sun's shadow map size; 0 draws no shadows. */
  shadowMapSize: number;
  /** The share of non-feature trees drawn. */
  treeShare: number;
}

export interface DeviceHints {
  /** `navigator.deviceMemory`, in GB, where the browser reports it. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** An explicit `?quality=` choice. */
  override?: string | null;
}

export function initialTier({ deviceMemory, cores, override }: DeviceHints): QualityTier {
  if (override && (TIERS as readonly string[]).includes(override)) return override as QualityTier;
  if (deviceMemory !== undefined && deviceMemory <= 2) return "low";
  if ((deviceMemory !== undefined && deviceMemory <= 4) || (cores !== undefined && cores <= 4)) return "medium";
  return "high";
}

export function qualitySettings(tier: QualityTier, devicePixelRatio: number): QualitySettings {
  const dpr = Math.max(1, devicePixelRatio || 1);
  switch (tier) {
    case "high":
      return { tier, pixelRatio: Math.min(dpr, 2), shadowMapSize: 2048, treeShare: 1 };
    case "medium":
      return { tier, pixelRatio: 1, shadowMapSize: 1024, treeShare: 0.6 };
    case "low":
      return { tier, pixelRatio: 0.75, shadowMapSize: 0, treeShare: 0.3 };
  }
}

/** How many trees, ranked feature-first and nearest-first, are drawn. */
export function treesKept(total: number, features: number, share: number) {
  return Math.min(total, features + Math.round((total - features) * share));
}

/** Below this many frames a second the town is slow however steady it is. */
export const SLOW_FRAME_MS = 40;

/**
 * One judgement over a full window of frame times, in milliseconds. A
 * median over budget steps down when the frames stutter (the median is well
 * above the fastest tenth, so frames are being dropped) or are plainly slow.
 * A steady rate the display itself caps, such as 30 Hz in a headless browser
 * or a phone in low-power mode, is not stutter and keeps the tier.
 */
export function judgeFrames(frameMs: readonly number[], tier: QualityTier): { tier: QualityTier; judged: boolean } {
  if (frameMs.length < FRAME_WINDOW) return { tier, judged: false };
  const sorted = [...frameMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const fastest = sorted[Math.floor(sorted.length / 10)];
  const struggling = median > SLOW_FRAME_MS || median > fastest * 1.4;
  if (median <= FRAME_BUDGET_MS || !struggling) return { tier, judged: true };
  return { tier: TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(tier) + 1)], judged: true };
}

export function lowerTier(a: QualityTier, b: QualityTier): boolean {
  return TIERS.indexOf(b) > TIERS.indexOf(a);
}
