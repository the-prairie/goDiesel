import { describe, expect, it } from "vitest";
import { Matrix4, Vector2, Vector3 } from "three";
import { observeWorldLabelSettling } from "./world-label-settling";
// Intentional contract tests of the pinned dependency's real sliced generator.
// @ts-expect-error The dependency omits types for internal managers.
import { SettlingManager } from "3d-tiles-renderer/src/three/plugins/mvt/SettlingManager.js";
// @ts-expect-error The dependency omits types for internal annotations.
import { LineAnnotation } from "3d-tiles-renderer/src/three/plugins/mvt/annotations/LineAnnotation.js";

function road() {
  const manager = new SettlingManager();
  const line = new LineAnnotation();
  line.lat = [-0.1, 0.1]; line.lon = [-0.1, 0.1]; line.lodLevel = 14;
  line.positions = [new Vector3(), new Vector3()];
  manager._items.add(line);
  manager._settleSample = (lat: number, lon: number, target: Vector3) => target.set(lon, lat, 0);
  const occupancy = { needsUpdate: false };
  return { manager, line, occupancy };
}

describe("stationary-camera road settling", () => {
  it("reproduces the missing completion notification without the adapter", () => {
    const { manager, line, occupancy } = road();
    manager._deadlineExpired = () => false;
    manager._settleItem(line).next();
    expect(line.ready).toBe(true);
    expect(occupancy.needsUpdate).toBe(false);
  });
  it("refreshes the real line projection after its sliced job empties the queue", () => {
    const { manager, line, occupancy } = road();
    const stop = observeWorldLabelSettling({ settlingManager: manager, occupancy });
    let expired = true;
    manager._deadlineExpired = () => expired;
    const camera = new Matrix4(), viewport = new Vector2(1000, 1000);
    line.updateTransform(camera, viewport, null);
    expect(line.cumulativeLen[1]).toBe(0);
    const work = manager._settleItem(line);
    expect(work.next().done).toBe(false);
    expect(manager.hasPendingWork).toBe(false);
    expect(occupancy.needsUpdate).toBe(false);
    expired = false;
    expect(work.next().done).toBe(true);
    expect(line.ready).toBe(true);
    expect(occupancy.needsUpdate).toBe(true);
    line.updateTransform(camera, viewport, null);
    expect(line.cumulativeLen[1]).toBeGreaterThan(100);
    stop();
  });
  it("does not publish an unregistered or abandoned road as newly ready", () => {
    const { manager, line, occupancy } = road();
    const stop = observeWorldLabelSettling({ settlingManager: manager, occupancy });
    manager._deadlineExpired = () => true;
    const work = manager._settleItem(line);
    work.next(); manager.unregister(line);
    expect(work.next().done).toBe(true);
    expect(line.ready).toBe(false);
    expect(occupancy.needsUpdate).toBe(false);
    stop();
  });
});
