import { describe, expect, it } from "vitest";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { LRUCache, PriorityQueue, type Tile } from "3d-tiles-renderer/core";
import { pruneWorldStaleWork } from "./world-stale-work";

describe("obsolete downloaded terrain", () => {
  it("uses the cache cancellation owner, preserves used/running tiles and caps work", async () => {
    const tiles = new TilesRenderer();
    tiles.parseQueue = new PriorityQueue(); tiles.parseQueue.autoUpdate=false;
    tiles.lruCache = new LRUCache();
    const state = tiles as unknown as { loadingTiles: Set<Tile>; stats: { parsing: number } };
    state.stats.parsing = 16;
    const items = Array.from({length:16}, () => ({} as Tile));
    let cancelled=0;
    const promises = items.map(tile => {
      state.loadingTiles.add(tile);
      tiles.lruCache.add(tile, () => { cancelled++; state.stats.parsing--; state.loadingTiles.delete(tile); tiles.parseQueue.remove(tile); });
      return tiles.parseQueue.add(tile, () => Promise.resolve()).catch(() => "cancelled");
    });
    tiles.lruCache.markAllUnused();
    tiles.lruCache.markUsed(items[0]); tiles.visibleTiles.add(items[1]);
    // Removing a queued item is not the same thing as interrupting a running decoder.
    // A started callback is no longer in the pinned queue's pending map.
    tiles.parseQueue.maxJobs=1; tiles.parseQueue.tryRunJobs();
    const running = items.find(tile => !tiles.parseQueue.has(tile))!;
    expect(pruneWorldStaleWork(tiles)).toBe(4);
    expect(cancelled).toBe(4); expect(state.stats.parsing).toBe(12);
    expect(tiles.lruCache.has(items[0])).toBe(true);
    expect(tiles.lruCache.has(items[1])).toBe(true);
    expect(tiles.lruCache.has(running)).toBe(true);
    for (const tile of items) tiles.lruCache.remove(tile);
    await Promise.all(promises);
    tiles.visibleTiles.clear(); state.loadingTiles.clear();
    tiles.dispose();
  });
});
