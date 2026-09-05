import type { QuestRoute, RoutePoint } from "@/domain/route";

export type WorldQuality = "balanced" | "cinema" | "light";
export interface WorldEnvironment {
  light: "daylight" | "golden" | "blue";
  clouds: number;
  labels: boolean;
  quality: WorldQuality;
  reducedMotion: boolean;
}
export const DEFAULT_WORLD_ENVIRONMENT: WorldEnvironment = {
  light: "daylight", clouds: 0.35, labels: true, quality: "balanced", reducedMotion: false,
};
export const WORLD_QUALITY = {
  light: { pixelRatio: 1, errorTarget: 16, cloudPreset: "low", clouds: false, labelBudget: 0.35 },
  balanced: { pixelRatio: 1.5, errorTarget: 10, cloudPreset: "low", clouds: true, labelBudget: 0.6 },
  cinema: { pixelRatio: 2, errorTarget: 6, cloudPreset: "high", clouds: true, labelBudget: 1 },
} as const;

export function normalizeEnvironment(value: WorldEnvironment): WorldEnvironment {
  return {
    light: ["daylight", "golden", "blue"].includes(value.light) ? value.light : "daylight",
    clouds: Number.isFinite(value.clouds) ? Math.min(1, Math.max(0, value.clouds)) : 0.35,
    labels: Boolean(value.labels),
    quality: Object.hasOwn(WORLD_QUALITY, value.quality) ? value.quality : "balanced",
    reducedMotion: Boolean(value.reducedMotion),
  };
}

/** Presentation-only sun in the local east/north/up frame. Never a weather observation. */
export function presentationSun(light: WorldEnvironment["light"]): [number, number, number] {
  const elevation = ({ daylight: 48, golden: 7, blue: -3 }[light]) * Math.PI / 180;
  const azimuth = 235 * Math.PI / 180;
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)];
}

/** Preserve only recorded edges. A zero-width segment boundary also breaks the line. */
export function recordedEdges(route: QuestRoute): Array<[RoutePoint, RoutePoint]> {
  const gaps = route.provenance.discontinuities;
  const edges: Array<[RoutePoint, RoutePoint]> = [];
  for (let i = 1; i < route.route.length; i += 1) {
    const a = route.route[i - 1];
    const b = route.route[i];
    const broken = gaps.some(({ startD, endD }) => startD === endD
      ? a.d < startD && b.d >= startD
      : a.d < endD && b.d > startD);
    if (!broken) edges.push([a, b]);
  }
  return edges;
}

export function isWorldPlayable(state: string) { return state === "ready" || state === "partial"; }

export type LayerState = "loading" | "ready" | "unavailable" | "off";
export interface WorldLayers {
  terrain: LayerState;
  atmosphere: LayerState;
  labels: LayerState;
  route: LayerState;
}
export function worldStatus(layers: WorldLayers) {
  if (layers.terrain === "unavailable") return "unavailable" as const;
  if (layers.terrain !== "ready") return "loading" as const;
  return Object.values(layers).some((state) => state === "unavailable" || state === "loading")
    ? "partial" as const : "ready" as const;
}

/** Binary search avoids scanning the recorded path during every animation frame. */
export function completedEdgeCount(endDistances: readonly number[], progressM: number) {
  let low = 0, high = endDistances.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (endDistances[mid] <= progressM) low = mid + 1; else high = mid;
  }
  return low;
}

export function labelText(properties: Record<string, unknown>): string {
  const value = properties.name ?? properties["name:en"] ?? properties.ref;
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}
export function labelFeature(layer: string, properties: Record<string, unknown>, type: number) {
  return Boolean(labelText(properties)) && (
    type === 2 && ["roads", "transportation_name"].includes(layer) ||
    type === 1 && ["places", "place", "pois", "poi", "mountain_peak", "water_name"].includes(layer)
  );
}
