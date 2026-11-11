import { useSyncExternalStore } from "react";

export type RouteCoverArtwork = {
  src: string;
  kind: string;
  width: number;
  height: number;
  points: string;
};

/**
 * The cover manifest carries an SVG polyline for every route (about 210 kB
 * gzipped), so it is loaded on first use instead of riding in the page chunks.
 * One request per session; a failed request leaves covers on their recorded
 * thread fallback rather than failing the page.
 */
export type RouteCoverArtworkLoad =
  | { status: "loading" }
  | { status: "ready"; covers: Record<string, RouteCoverArtwork> }
  | { status: "unavailable" };

let current: RouteCoverArtworkLoad = { status: "loading" };
let request: Promise<RouteCoverArtworkLoad> | undefined;
const listeners = new Set<() => void>();

function settle(next: RouteCoverArtworkLoad) {
  current = next;
  for (const listener of listeners) listener();
  return next;
}

export function loadRouteCoverArtwork() {
  // The specifier stays the plain manifest path: single-route builds resolve it
  // to a manifest scoped to the shared route (ADR-0011), dynamic or not.
  request ??= import("@/data/route-covers/manifest.json").then(
    (module) => settle({ status: "ready", covers: module.default as Record<string, RouteCoverArtwork> }),
    () => settle({ status: "unavailable" }),
  );
  return request;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void loadRouteCoverArtwork();
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return current;
}

export function useRouteCoverArtwork() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
