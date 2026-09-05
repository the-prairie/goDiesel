import { describe, expect, it } from "vitest";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { canStartWorldAtmosphere, configureWorldStreaming, nextSlowFrameDebt, worldFarPlane } from "./world-streaming";

describe("local terrain streaming", () => {
  it("isolates queues and memory without changing another renderer's shared defaults", () => {
    const one = new TilesRenderer(), other = new TilesRenderer();
    const shared = [other.downloadQueue, other.parseQueue, other.processNodeQueue, other.lruCache];
    const limits = [other.downloadQueue.maxJobsPerOrigin, other.parseQueue.maxJobs, other.lruCache.maxBytesSize];
    configureWorldStreaming(one);
    expect(one.loadAncestors).toBe(false);
    expect(one.loadSiblings).toBe(false);
    expect(one.downloadQueue.maxJobsPerOrigin).toBe(8);
    expect(one.parseQueue.maxJobs).toBe(3);
    [one.downloadQueue, one.parseQueue, one.processNodeQueue, one.lruCache].forEach((q, i) => expect(q).not.toBe(shared[i]));
    expect([other.downloadQueue.maxJobsPerOrigin, other.parseQueue.maxJobs, other.lruCache.maxBytesSize]).toEqual(limits);
    expect(one.lruCache.maxBytesSize).toBe(384 * 1024 * 1024);
    expect(one.parseQueue.priorityCallback).toBe(other.parseQueue.priorityCallback);
    one.dispose(); other.dispose();
  });
  it("preserves a regional horizon without a continent-sized chase frustum", () => {
    expect(worldFarPlane(200)).toBe(20_000);
    expect(worldFarPlane(30_000)).toBe(180_000);
    expect(worldFarPlane(NaN)).toBe(20_000);
  });
  it("gives terrain decoding priority over atmospheric shaders on coarse first tiles", () => {
    expect(canStartWorldAtmosphere(262_978, 200, 0.1)).toBe(false);
    expect(canStartWorldAtmosphere(1027, 3000, 0.6)).toBe(false);
    expect(canStartWorldAtmosphere(null, 200, 0.5)).toBe(false);
    expect(canStartWorldAtmosphere(8, 200, 0.3)).toBe(true);
    expect(canStartWorldAtmosphere(48, 3000, 0.3)).toBe(true);
    expect(canStartWorldAtmosphere(null, 200, 1)).toBe(true);
  });
  it("responds to the worst visible stalls, not just moderately slow frames", () => {
    let debt = 0;
    for (let i = 0; i < 4; i++) debt = nextSlowFrameDebt(debt, 1200, true);
    expect(debt).toBe(4000);
    expect(nextSlowFrameDebt(3000, 5000, false)).toBe(0);
    expect(nextSlowFrameDebt(32, 16, true)).toBe(0);
    expect(nextSlowFrameDebt(3000, NaN, true)).toBe(0);
  });
});
