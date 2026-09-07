import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { reliefCamera, reliefCameraGeometry } from "@/ui/maps/relief-camera";

const trace = [0, 1, 2, 3, 4].map(i => ({ d: i * 500, lat: 51 + i * 0.0045, lng: -115, elev: 1000 + i * 150 }));

describe("notebook landscape camera", () => {
  it("anchors at the held distance and leaves room for mountainous terrain", () => {
    const camera = reliefCameraGeometry(trace, 1000)!;
    expect(camera.at).toEqual(trace[2]);
    expect(camera.from.lat).toBeLessThan(camera.at.lat);
    expect(camera.rangeM).toBeGreaterThan(1000);
    expect(reliefCameraGeometry(trace.map(p => ({ ...p, elev: 0 })), 1000)!.rangeM).toBeLessThan(camera.rangeM);
  });
  it("uses the approach heading at the finish rather than a duplicate endpoint", () => {
    const east = trace.map((p, i) => ({ ...p, lat: 51, lng: -115 + i * 0.006 }));
    expect(reliefCameraGeometry(east, 2000)!.heading).toBeCloseTo(90, 1);
  });
  it("raises the eye over terrain between the camera and the held point", () => {
    let received: number[] = [];
    const map = {
      queryTerrainElevation: (p: { lat: number }) => p.lat < 51.008 ? 2600 : 1755,
      calculateCameraOptionsFromTo: (_from: unknown, eye: number, _to: unknown, target: number) => { received = [eye, target]; return { zoom: 13, pitch: 60 }; },
    } as unknown as MapLibreMap;
    const camera = reliefCamera(map, trace, 1000)!;
    expect(camera.sampled).toBe(32);
    expect(received[0]).toBeGreaterThan(2730);
    expect(received[1]).toBe(1755);
  });
  it("reports no terrain samples when only the recorded envelope is available", () => {
    const map = { queryTerrainElevation: () => null, calculateCameraOptionsFromTo: () => ({}) } as unknown as MapLibreMap;
    expect(reliefCamera(map, trace, 1000)!.sampled).toBe(0);
  });
});
