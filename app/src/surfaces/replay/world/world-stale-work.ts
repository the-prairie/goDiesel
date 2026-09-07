import type { Tile } from "3d-tiles-renderer/core";
import type { TilesRenderer } from "3d-tiles-renderer/three";
interface PendingTiles extends TilesRenderer { loadingTiles: Set<Tile>; stats: { parsing: number }; }

/**
 * 0.5.2 cancels obsolete queued HTTP work, but leaves downloaded bodies queued
 * for parsing. Drop only irrelevant, NOT-YET-RUNNING parses under pressure.
 * Use cache.remove so the dependency owns abort, counters and disposal together.
 */
export function pruneWorldStaleWork(tiles: TilesRenderer, budget = 4) {
  const pending = tiles as PendingTiles;
  if (!(pending.loadingTiles instanceof Set) || !pending.stats) throw new Error("World pending tile contract changed");
  if (pending.stats.parsing < 12) return 0;
  let removed = 0;
  for (const tile of [...pending.loadingTiles]) {
    if (removed >= budget) break;
    if (tiles.parseQueue.has(tile) && !tiles.lruCache.isUsed(tile) && !tiles.visibleTiles.has(tile)) {
      if (tiles.lruCache.remove(tile)) removed++;
    }
  }
  return removed;
}
