import { describe, expect, it } from "vitest";
import { MVTAnnotationsDriver, MVTAnnotationsPlugin } from "3d-tiles-renderer/three/plugins";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer/three";
import { Vector3 } from "three";
import { observeWorldLabelSettling } from "./world-label-settling";

function slicedPlugin() {
  const occupancy = { needsUpdate: false };
  const settlingManager = {
    queued: true,
    *_settleItem(item: { ready: boolean }) {
      this.queued = false;
      yield "sample-one";
      yield "sample-two";
      item.ready = true;
    },
  };
  return { occupancy, settlingManager };
}

describe("MVT settling completion", () => {
  it("wakes static-camera layout after sliced work, without changing yields", () => {
    const plugin = slicedPlugin();
    observeWorldLabelSettling(plugin);
    const item = { ready: false };
    const work = plugin.settlingManager._settleItem(item);
    expect(work.next()).toEqual({ value: "sample-one", done: false });
    expect(plugin.settlingManager.queued).toBe(false);
    expect(plugin.occupancy.needsUpdate).toBe(false);
    expect(work.next()).toEqual({ value: "sample-two", done: false });
    expect(plugin.occupancy.needsUpdate).toBe(false);
    expect(work.next().done).toBe(true);
    expect(item.ready).toBe(true);
    expect(plugin.occupancy.needsUpdate).toBe(true);
  });

  it("also observes the actual pinned plugin's original settling method", () => {
    // The real plugin can be constructed without a browser using its base driver.
    const plugin = new MVTAnnotationsPlugin({ overlay: {}, driver: new MVTAnnotationsDriver() });
    const internals = plugin as unknown as {
      occupancy: { needsUpdate: boolean };
      settlingManager: {
        tiles: unknown;
        elevationSource: unknown;
        _settleItem(item: { ready: boolean; lat: number; lon: number; lodLevel: number; position: Vector3 }): Generator;
      };
    };
    internals.settlingManager.tiles = { ellipsoid: WGS84_ELLIPSOID };
    internals.settlingManager.elevationSource = { sampleCartographicElevation: () => 1000 };
    observeWorldLabelSettling(plugin);
    const point = { ready: false, lat: 51 * Math.PI / 180, lon: -114 * Math.PI / 180, lodLevel: 14, position: new Vector3() };
    expect(internals.settlingManager._settleItem(point).next().done).toBe(true);
    expect(point.ready).toBe(true);
    expect(point.position.length()).toBeGreaterThan(6_000_000);
    expect(internals.occupancy.needsUpdate).toBe(true);
  });

  it("restores the method and does not wake disposed or different instances", () => {
    const plugin = slicedPlugin();
    const other = slicedPlugin();
    const original = plugin.settlingManager._settleItem;
    const dispose = observeWorldLabelSettling(plugin);
    const work = plugin.settlingManager._settleItem({ ready: false });
    work.next();
    dispose(); dispose();
    work.next(); work.next();
    expect(plugin.occupancy.needsUpdate).toBe(false);
    expect(other.occupancy.needsUpdate).toBe(false);
    expect(plugin.settlingManager._settleItem).toBe(original);
  });

  it("rejects changed library contracts instead of silently doing nothing", () => {
    expect(() => observeWorldLabelSettling({})).toThrow("contract changed");
  });
});
