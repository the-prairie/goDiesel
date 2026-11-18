import { describe, expect, it } from "vitest";

import { MAPLIBRE_FOV_DEG, matchCamera } from "@/labs/sketch/sketch-camera-match";

const kyoto = { center: [135.7737, 34.9948] as [number, number], groundEllipsoidM: 90 };

describe("matchCamera (MapLibre view -> Cesium camera)", () => {
  it("looking straight down, stands above the centre at the height MapLibre's view implies", () => {
    const camera = matchCamera({ ...kyoto, zoom: 17, pitch: 0, bearing: 0, width: 375, height: 812 });
    expect(camera.lng).toBeCloseTo(kyoto.center[0], 6);
    expect(camera.lat).toBeCloseTo(kyoto.center[1], 6);
    // 812 px tall at zoom 17: about 1.2 km of ground per 1000 px... at 35°N, 0.98 m/px.
    const metresPerPixel = (40075016.686 * Math.cos((kyoto.center[1] * Math.PI) / 180)) / (512 * 2 ** 17);
    const distance = (812 / 2 / Math.tan((MAPLIBRE_FOV_DEG * Math.PI) / 360)) * metresPerPixel;
    expect(camera.heightM).toBeCloseTo(kyoto.groundEllipsoidM + distance, 3);
    expect(camera.pitchDeg).toBeCloseTo(-90, 6);
  });

  it("tilted, stands back from the centre against the bearing, and lower", () => {
    const flat = matchCamera({ ...kyoto, zoom: 17, pitch: 0, bearing: 90, width: 375, height: 812 });
    const tilted = matchCamera({ ...kyoto, zoom: 17, pitch: 60, bearing: 90, width: 375, height: 812 });
    expect(tilted.lng).toBeLessThan(kyoto.center[0]);
    expect(tilted.lat).toBeCloseTo(kyoto.center[1], 5);
    expect(tilted.heightM - kyoto.groundEllipsoidM).toBeCloseTo((flat.heightM - kyoto.groundEllipsoidM) / 2, 3);
    expect(tilted.headingDeg).toBeCloseTo(90, 6);
    expect(tilted.pitchDeg).toBeCloseTo(-30, 6);
  });

  it("gives Cesium the same field of view: vertical on a portrait phone, the wider horizontal on a landscape screen", () => {
    expect(matchCamera({ ...kyoto, zoom: 16, pitch: 0, bearing: 0, width: 375, height: 812 }).fovDeg).toBeCloseTo(MAPLIBRE_FOV_DEG, 6);
    const wide = matchCamera({ ...kyoto, zoom: 16, pitch: 0, bearing: 0, width: 1440, height: 900 }).fovDeg;
    expect(Math.tan((wide * Math.PI) / 360)).toBeCloseTo(Math.tan((MAPLIBRE_FOV_DEG * Math.PI) / 360) * (1440 / 900), 6);
  });
});
