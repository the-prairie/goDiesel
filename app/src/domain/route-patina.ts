/**
 * Patina — wear and fade for Weathered Atlas route ink.
 *
 * wear: repetitions deepen the stroke (0–1)
 * fade: months without travel desaturate toward paper (0–1, where 1 is freshest)
 */

export interface PatinaInput {
  /** ISO date string of last travel, or null if unknown */
  lastTraveledAt?: string | null;
  /** How many times this route has been traveled (defaults to 1 for completed) */
  travelCount?: number;
  lifecycle?: "completed" | "planned" | "discovered";
}

export interface PatinaStyle {
  wear: number;
  freshness: number;
  strokeWidthPx: number;
  opacity: number;
  /** CSS color for the route stroke */
  stroke: string;
  /** graphite for planned, indigo for lived */
  kind: "ink" | "pencil";
}

const DAY_MS = 86_400_000;
const FADE_FLOOR = 0.28;
const FRESH_DAYS = 21;
const FADE_DAYS = 180;

export function daysSince(isoDate: string | null | undefined, now = Date.now()) {
  if (!isoDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / DAY_MS);
}

/** Freshness 1 = recent, approaches FADE_FLOOR as time passes. */
export function freshnessFromAge(days: number) {
  if (!Number.isFinite(days)) return FADE_FLOOR;
  if (days <= FRESH_DAYS) return 1;
  if (days >= FADE_DAYS) return FADE_FLOOR;
  const t = (days - FRESH_DAYS) / (FADE_DAYS - FRESH_DAYS);
  return 1 - t * (1 - FADE_FLOOR);
}

/** Wear 0–1 from travel count. */
export function wearFromCount(count: number) {
  const n = Math.max(0, count);
  if (n <= 1) return 0.15;
  if (n >= 40) return 1;
  return 0.15 + (Math.log(n) / Math.log(40)) * 0.85;
}

export function patinaForRoute(input: PatinaInput, now = Date.now()): PatinaStyle {
  if (input.lifecycle === "planned" || input.lifecycle === "discovered") {
    return {
      wear: 0,
      freshness: 1,
      strokeWidthPx: 2,
      opacity: 0.72,
      stroke: "var(--graphite)",
      kind: "pencil",
    };
  }

  const count = input.travelCount ?? 1;
  const wear = wearFromCount(count);
  const freshness = freshnessFromAge(daysSince(input.lastTraveledAt, now));
  const strokeWidthPx = 1.5 + wear * 2.5;
  const opacity = Math.max(FADE_FLOOR, 0.42 + freshness * 0.5 + wear * 0.08);

  return {
    wear,
    freshness,
    strokeWidthPx,
    opacity,
    stroke: freshness > 0.7 ? "var(--route)" : "var(--route-history)",
    kind: "ink",
  };
}

/** Stable low-amplitude width jitter for repeated-pen character (0–1 seed). */
export function strokeIrregularity(seed: string, index: number) {
  let hash = 0;
  const key = `${seed}:${index}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const unit = ((hash >>> 0) % 1000) / 1000;
  return 0.85 + unit * 0.3;
}
