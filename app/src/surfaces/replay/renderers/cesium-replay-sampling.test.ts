import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cartographic, Entity } from "cesium";
import { CesiumReplayEngine } from "./cesium-replay-engine";
import type { ReplayPose } from "../playback/replay-controller";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const pose: ReplayPose = {
  lat: 35,
  lng: 135,
  elev: 100,
  progressM: 0,
  progressRatio: 0,
  bearingDeg: 0,
  following: false,
  cameraRangeM: 240,
};

function harness() {
  const requests: Array<{
    positions: Cartographic[];
    resolve: (positions: Cartographic[]) => void;
    reject: () => void;
  }> = [];
  const sampleHeightMostDetailed = vi.fn(
    (positions: Cartographic[]) =>
      new Promise<Cartographic[]>((resolve, reject) => {
        requests.push({
          positions,
          resolve,
          reject: () => reject(new Error("Sample unavailable")),
        });
      }),
  );
  const scene = { sampleHeightSupported: true, sampleHeightMostDetailed };
  const viewer = { scene, isDestroyed: () => false, destroy: vi.fn() };
  const marker = new Entity();
  const engine = new CesiumReplayEngine();
  Object.assign(engine, { viewer, marker });
  const complete = (index: number, height = 120) =>
    requests[index].resolve(
      requests[index].positions.map(
        (position) =>
          new Cartographic(position.longitude, position.latitude, height),
      ),
    );
  const markerHeight = () =>
    Cartographic.fromCartesian(marker.position!.getValue()!).height;
  return { engine, scene, viewer, marker, requests, complete, markerHeight };
}

describe("Cesium Replay sampling contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, clearInterval });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("allows only one provider request while a sample is pending", async () => {
    const h = harness();
    h.engine.setPose(pose);
    await vi.advanceTimersByTimeAsync(500);
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(1);
    h.complete(0);
    await flush();
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(2);
    h.engine.destroy();
  });

  it("waits 250 milliseconds between sample starts", async () => {
    const h = harness();
    h.engine.setPose(pose);
    h.complete(0);
    await flush();
    await vi.advanceTimersByTimeAsync(249);
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(2);
    h.engine.destroy();
  });

  it("uses a current sample to correct the rendered route marker", async () => {
    const h = harness();
    h.engine.setPose(pose);
    await vi.advanceTimersByTimeAsync(100);
    h.complete(0);
    await flush();
    expect(h.markerHeight()).toBeGreaterThan(103);
    expect(h.markerHeight()).toBeLessThanOrEqual(123);
    expect(h.requests).toHaveLength(1);
    h.engine.destroy();
  });

  it("discards stale route elevation and schedules the newest pose", async () => {
    const h = harness();
    h.engine.setPose(pose);
    h.engine.setPose({ ...pose, progressM: 1000, lat: 35.02 });
    h.complete(0, 180);
    await flush();
    expect(h.markerHeight()).toBeCloseTo(103, 3);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].positions[0].latitude).toBeCloseTo(
      (35.02 * Math.PI) / 180,
    );
    h.engine.destroy();
  });

  it("resamples when only the camera target has moved far from the request", async () => {
    const h = harness();
    h.engine.setPose(pose);
    h.engine.setPose({ ...pose, cameraRangeM: 1400 });
    h.complete(0);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].positions[1].latitude).not.toBe(
      h.requests[0].positions[1].latitude,
    );
    h.engine.destroy();
  });

  it("retries a rejected sample without another user input", async () => {
    const h = harness();
    h.engine.setPose(pose);
    h.requests[0].reject();
    await flush();
    await vi.advanceTimersByTimeAsync(249);
    expect(h.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.requests).toHaveLength(2);
    h.engine.destroy();
  });

  it("starts an overdue retry immediately and never overlaps provider work", async () => {
    const h = harness();
    h.engine.setPose(pose);
    await vi.advanceTimersByTimeAsync(500);
    h.requests[0].reject();
    await flush();
    expect(h.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(2);
    h.engine.destroy();
  });

  it("preserves recorded height when the provider returns no sample", async () => {
    const h = harness();
    h.engine.setPose(pose);
    h.requests[0].resolve([]);
    await flush();
    expect(h.markerHeight()).toBeCloseTo(103, 3);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requests).toHaveLength(1);
    h.engine.destroy();
  });

  it("throttles unsupported sampling attempts too", async () => {
    const h = harness();
    h.scene.sampleHeightSupported = false;
    h.engine.setPose(pose);
    h.scene.sampleHeightSupported = true;
    await vi.advanceTimersByTimeAsync(249);
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    h.engine.setPose(pose);
    expect(h.requests).toHaveLength(1);
    h.engine.destroy();
  });

  it.each(["pending", "retry"])(
    "destroy releases %s work and ignores late outcomes",
    async (stage) => {
      const h = harness();
      h.engine.setPose(pose);
      if (stage === "retry") {
        h.requests[0].reject();
        await flush();
      }
      h.engine.destroy();
      if (stage === "pending") {
        h.complete(0);
        await flush();
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.requests).toHaveLength(1);
      expect(h.viewer.destroy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
