import { describe, expect, it } from "vitest";

import { MAPLIBRE_FOV_DEG } from "@/labs/sketch/sketch-camera-match";
import { fovAlongFlight, mapCameraForReplay } from "@/labs/sketch/sketch-jump-camera";

const pose = { center: { lat: 35, lng: 135.77 }, headingDeg: 300, tiltDeg: 52, rangeM: 420, fovDeg: 54 };

describe("mapCameraForReplay", () => {
  it("stands MapLibre's camera where the 3D replay's opening camera stands: same centre, heading, tilt and field of view", () => {
    const camera = mapCameraForReplay(pose, { height: 812 });
    expect(camera.center).toEqual([135.77, 35]);
    expect(camera.bearing).toBe(300);
    expect(camera.pitch).toBe(52);
    expect(camera.fovDeg).toBe(54);
  });

  it("chooses the zoom at which MapLibre's camera is the replay's range from the centre", () => {
    const camera = mapCameraForReplay(pose, { height: 812 });
    const metresPerPixel = (40075016.686 * Math.cos((35 * Math.PI) / 180)) / (512 * 2 ** camera.zoom);
    const distancePx = 812 / 2 / Math.tan((54 * Math.PI) / 360);
    expect(distancePx * metresPerPixel).toBeCloseTo(420, 3);
  });

  it("goes closer for a shorter range", () => {
    expect(mapCameraForReplay({ ...pose, rangeM: 200 }, { height: 812 }).zoom).toBeGreaterThan(mapCameraForReplay(pose, { height: 812 }).zoom);
  });

  it("keeps within MapLibre's pitch", () => {
    expect(mapCameraForReplay({ ...pose, tiltDeg: 88 }, { height: 812 }).pitch).toBeLessThanOrEqual(80);
  });
});

describe("fovAlongFlight", () => {
  it("moves the field of view from MapLibre's own to the replay's as the flight closes in, by zoom", () => {
    expect(fovAlongFlight({ fromZoom: 12, toZoom: 17, zoom: 12, toFov: 54 })).toBeCloseTo(MAPLIBRE_FOV_DEG, 6);
    expect(fovAlongFlight({ fromZoom: 12, toZoom: 17, zoom: 17, toFov: 54 })).toBeCloseTo(54, 6);
    const mid = fovAlongFlight({ fromZoom: 12, toZoom: 17, zoom: 14.5, toFov: 54 });
    expect(mid).toBeGreaterThan(MAPLIBRE_FOV_DEG);
    expect(mid).toBeLessThan(54);
  });

  it("stays put when the flight does not change zoom, and never overshoots", () => {
    expect(fovAlongFlight({ fromZoom: 16, toZoom: 16, zoom: 16, toFov: 54 })).toBeCloseTo(54, 6);
    expect(fovAlongFlight({ fromZoom: 12, toZoom: 17, zoom: 18, toFov: 54 })).toBeCloseTo(54, 6);
  });
});
