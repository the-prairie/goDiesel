import { DownloadPriorityQueue, LRUCache, PriorityQueue } from "3d-tiles-renderer/core";
import type { TilesRenderer } from "3d-tiles-renderer/three";

/** Replay needs the camera's local terrain, not every sibling of every globe ancestor. */
export function configureWorldStreaming(tiles: TilesRenderer) {
  // 0.5.2's ancestor strategy implicitly loads off-screen siblings and can leave
  // a continent-sized fallback covering already-downloaded street-level tiles.
  tiles.loadAncestors = false;
  tiles.loadSiblings = false;
  const cache = new LRUCache();
  cache.unloadPriorityCallback = tiles.lruCache.unloadPriorityCallback;
  cache.maxBytesSize = 384 * 1024 * 1024;
  cache.minBytesSize = 256 * 1024 * 1024;
  tiles.lruCache = cache;

  // Defaults are shared across renderers. Own the queues so a previous world or
  // a label overlay cannot change this instance's concurrency or scheduling.
  const download = new DownloadPriorityQueue();
  download.priorityCallback = tiles.downloadQueue.priorityCallback;
  download.maxJobsPerOrigin = 8;
  const parse = new PriorityQueue();
  parse.priorityCallback = tiles.parseQueue.priorityCallback;
  parse.maxJobs = 3;
  const nodes = new PriorityQueue();
  nodes.priorityCallback = tiles.processNodeQueue.priorityCallback;
  tiles.downloadQueue = download;
  tiles.parseQueue = parse;
  tiles.processNodeQueue = nodes;
}

/** Keep the mountain horizon at close range without requesting a 100 km disk. */
export function worldFarPlane(rangeM: number) {
  return Math.max(20_000, Math.max(1, Number.isFinite(rangeM) ? rangeM : 1000) * 6);
}

/** A successfully drawn globe triangle is not the landscape the owner selected. */
export function canStartWorldAtmosphere(focusErrorM: number | null, rangeM: number, loadProgress: number) {
  return (focusErrorM !== null && Number.isFinite(focusErrorM) && focusErrorM >= 0 &&
    focusErrorM <= Math.max(16, Math.min(64, rangeM * 0.04))) || loadProgress >= 0.9;
}

/** Visible-frame debt, not a frame count. Very slow frames must not escape adaptation. */
export function nextSlowFrameDebt(debtMs: number, elapsedMs: number, visible: boolean) {
  if (!visible || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return elapsedMs > 50 ? Math.min(5000, debtMs + Math.min(elapsedMs, 1000)) : Math.max(0, debtMs - elapsedMs * 2);
}
