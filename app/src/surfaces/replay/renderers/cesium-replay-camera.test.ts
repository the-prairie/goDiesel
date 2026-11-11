import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cartesian3, Cartographic, Entity } from "cesium";
import { CesiumReplayEngine } from "./cesium-replay-engine";
import type { ReplayPose } from "../playback/replay-controller";

const pose: ReplayPose = {
  lat: 35,
  lng: 135,
  elev: 100,
  progressM: 0,
  progressRatio: 0,
  bearingDeg: 0,
  following: true,
  cameraRangeM: 120,
};

function harness() {
  const camera = {
    positionWC: Cartesian3.fromDegrees(135, 35, 200),
    get positionCartographic() {
      return Cartographic.fromCartesian(this.positionWC);
    },
    heading: 0,
    pitch: -0.5,
    setView: vi.fn(function (this: typeof camera, view: {
      destination: Cartesian3;
      orientation: { heading: number; pitch: number };
    }) {
      this.positionWC = Cartesian3.clone(view.destination);
      this.heading = view.orientation.heading;
      this.pitch = view.orientation.pitch;
    }),
  };
  const scene = {
    sampleHeightSupported: true,
    sampleHeight: () => 100,
    sampleHeightMostDetailed: () => new Promise<Cartographic[]>(() => {}),
  };
  const engine = new CesiumReplayEngine();
  Object.assign(engine, {
    viewer: { scene, camera, isDestroyed: () => false, destroy: vi.fn() },
    marker: new Entity(),
  });
  return { engine, camera };
}

describe("Cesium Replay camera discontinuities", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("frames a distant paused seek in one update instead of retaining the old heading", () => {
    const { engine, camera } = harness();
    engine.setPose(pose);
    vi.advanceTimersByTime(16);
    engine.setPose({ ...pose, lat: 35.02, progressM: 2200, bearingDeg: 180 });
    const destination = camera.positionCartographic;
    expect(destination.latitude * 180 / Math.PI).toBeGreaterThan(35.02);
    expect(Math.cos(camera.heading)).toBeCloseTo(-1, 6);
    expect(camera.pitch).toBeCloseTo(-Math.atan2(destination.height - 103, 120), 6);
  });

  it("retains eased orientation during nearby continuous playback", () => {
    const { engine, camera } = harness();
    engine.setPose(pose);
    const initialHeading = camera.heading;
    vi.advanceTimersByTime(16);
    engine.setPose({ ...pose, lat: 35.00001, progressM: 1, bearingDeg: 20 });
    expect(camera.heading).toBeGreaterThan(initialHeading);
    expect(camera.heading).toBeLessThan(20 * Math.PI / 180);
  });
});
