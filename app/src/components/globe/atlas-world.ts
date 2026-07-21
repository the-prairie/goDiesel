import type { RouteRegion } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/routes";

export interface AtlasGlobeProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion) => void;
  className?: string;
}

export interface AtlasGlobeHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

export type AtlasWorldStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; message: string }
  | { state: "unavailable"; message: string };

export interface AtlasRegionProjection {
  name: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface AtlasWorldEngineMountOptions {
  container: HTMLElement;
  regions: RouteRegion[];
  onStatus: (status: AtlasWorldStatus) => void;
}

export interface AtlasWorldEngine {
  mount(options: AtlasWorldEngineMountOptions): Promise<void>;
  setSelectedRegion(region?: RouteRegion): void;
  projectRegions(): AtlasRegionProjection[];
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  destroy(): void;
}

declare global {
  interface Window {
    __GODIESEL_ATLAS_WORLD_ENGINE__?: "three" | "cesium";
    __GODIESEL_ATLAS_WORLD_FACTORY__?: () => AtlasWorldEngine;
  }
}

export function atlasWorldEngineMode() {
  if (typeof window !== "undefined" && window.__GODIESEL_ATLAS_WORLD_ENGINE__) {
    return window.__GODIESEL_ATLAS_WORLD_ENGINE__;
  }
  return import.meta.env.VITE_ATLAS_WORLD_ENGINE === "cesium"
    ? "cesium"
    : "three";
}

export function sampleGlobalRoutePoints(
  route: RouteSummary,
  maximumPoints = 96,
): RoutePoint[] {
  if (route.trace.length <= maximumPoints) return route.trace;
  const stride = Math.ceil((route.trace.length - 1) / (maximumPoints - 1));
  const sampled = route.trace.filter(
    (_, index) => index === 0 || index % stride === 0,
  );
  const last = route.trace.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}
