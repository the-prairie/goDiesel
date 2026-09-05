import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { QuestRoute } from "@/domain/route";
import { DEFAULT_WORLD_ENVIRONMENT, WORLD_QUALITY, completedEdgeCount, isWorldPlayable, labelFeature, labelText, normalizeEnvironment, presentationSun, recordedEdges, worldStatus } from "./world-model";
import { WorldFrame } from "./world-frame";
import { WorldRoute } from "./world-route";

const route = {
  route: [0, 100, 200, 300].map((d) => ({ lat: 51 + d / 100_000, lng: -114, elev: 1000 + d / 10, d })),
  elevationStatus: "recorded",
  provenance: { discontinuities: [], elevation: { status: "recorded" } },
} as unknown as QuestRoute;

describe("Cinematic world contract", () => {
  it("keeps optional layer failures playable, but never promotes absent terrain", () => {
    const ready = { terrain: "ready", atmosphere: "ready", labels: "ready", route: "ready" } as const;
    expect(worldStatus(ready)).toBe("ready");
    expect(worldStatus({ ...ready, labels: "off" })).toBe("ready");
    expect(worldStatus({ ...ready, atmosphere: "unavailable" })).toBe("partial");
    expect(worldStatus({ ...ready, labels: "loading" })).toBe("partial");
    expect(worldStatus({ ...ready, terrain: "loading" })).toBe("loading");
    expect(worldStatus({ ...ready, terrain: "unavailable" })).toBe("unavailable");
    expect(isWorldPlayable("partial")).toBe(true);
    expect(isWorldPlayable("unavailable")).toBe(false);
  });
  it("bounds presentation settings including non-finite and prototype keys", () => {
    expect(normalizeEnvironment({ ...DEFAULT_WORLD_ENVIRONMENT, clouds: NaN }).clouds).toBe(0.35);
    expect(normalizeEnvironment({ ...DEFAULT_WORLD_ENVIRONMENT, clouds: 20 }).clouds).toBe(1);
    expect(normalizeEnvironment({ ...DEFAULT_WORLD_ENVIRONMENT, clouds: -4 }).clouds).toBe(0);
    expect(normalizeEnvironment({ ...DEFAULT_WORLD_ENVIRONMENT, quality: "constructor" as never }).quality).toBe("balanced");
    for (const preset of Object.values(WORLD_QUALITY)) {
      expect(preset.pixelRatio).toBeLessThanOrEqual(2);
      expect(preset.labelBudget).toBeLessThanOrEqual(1);
    }
    expect(WORLD_QUALITY.light.clouds).toBe(false);
  });
  it.each(["daylight", "golden", "blue"] as const)("makes %s a local presentation direction, independent of route time", (light) => {
    expect(new Vector3(...presentationSun(light)).length()).toBeCloseTo(1);
  });
  it("does not bridge a recording gap or a zero-width track boundary", () => {
    const gapRoute = { ...route, provenance: { ...route.provenance, discontinuities: [{ kind: "recording_gap", source: "recorded_timestamps", startD: 100, endD: 200 }] } } as QuestRoute;
    expect(recordedEdges(gapRoute).map(([a, b]) => [a.d, b.d])).toEqual([[0, 100], [200, 300]]);
    gapRoute.provenance.discontinuities[0].endD = 100;
    expect(recordedEdges(gapRoute).map(([a, b]) => [a.d, b.d])).toEqual([[100, 200], [200, 300]]);
    expect(recordedEdges(route)).toHaveLength(3);
  });
  it("finds progress in real distance rather than array-index ratios", () => {
    expect(completedEdgeCount([1, 10, 1000], 12)).toBe(2);
    expect(completedEdgeCount([], 12)).toBe(0);
    expect(completedEdgeCount([1, 10, 1000], Infinity)).toBe(3);
  });
  it("labels named roads/places from both supported schemas, not arbitrary polygons", () => {
    expect(labelFeature("transportation_name", { name: "Road to Nepal" }, 2)).toBe(true);
    expect(labelFeature("roads", { ref: "22" }, 2)).toBe(true);
    expect(labelFeature("places", { name: "Bragg Creek" }, 1)).toBe(true);
    expect(labelFeature("buildings", { name: "Unknown" }, 3)).toBe(false);
    expect(labelText({ name: 124 })).toBe("");
    expect(labelText({ name: "x".repeat(500) })).toHaveLength(100);
  });
});

describe("Earth/local frame", () => {
  it.each([[51, -114], [0, 179.999], [89, 20], [-33, 151]])("round-trips terrain coordinates near %s,%s", (lat, lng) => {
    const frame = new WorldFrame(lat, lng);
    expect(frame.position(lat, lng, 0).length()).toBeLessThan(0.00001);
    expect(frame.height(frame.position(lat + 0.001, lng, 1234))).toBeCloseTo(1234, 5);
    expect(frame.normal(lat, lng).dot(new Vector3(0, 0, 1))).toBeCloseTo(1, 8);
  });
  it("does not jump around the Earth at the date line", () => {
    const frame = new WorldFrame(0, 179.999);
    expect(frame.position(0, -179.999, 0).length()).toBeLessThan(225);
  });
  it("honors native range/heading/tilt semantics and finite clip planes", () => {
    const frame = new WorldFrame(51, -114);
    const camera = new PerspectiveCamera();
    const pose = { center: { lat: 51, lng: -114, altitude: 1000 }, headingDeg: 0, tiltDeg: 60, rangeM: 1000, fovDeg: 54, progressM: 0 };
    const target = frame.camera(camera, pose, 1000);
    expect(camera.position.distanceTo(target)).toBeCloseTo(1000);
    expect(camera.position.z - target.z).toBeCloseTo(500);
    expect(camera.position.y).toBeLessThan(target.y);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
  });
});

describe("Recorded route rendering", () => {
  it("keeps source elevation immutable while terrain-seating the display", () => {
    const original = JSON.stringify(route);
    const trace = new WorldRoute(route, new WorldFrame(51, -114));
    trace.settle(() => 1070, 1000);
    trace.update(150);
    expect(trace.grounded).toBe(true);
    expect(JSON.stringify(route)).toBe(original);
    trace.dispose();
  });
  it("does not render a fabricated sea-level route when elevation and terrain are missing", () => {
    const missing = { ...route, elevationStatus: "unavailable", provenance: { ...route.provenance, elevation: { status: "unavailable" } } } as QuestRoute;
    const trace = new WorldRoute(missing, new WorldFrame(51, -114));
    trace.settle(() => null, 1000);
    expect(trace.grounded).toBe(false);
    expect(trace.group.children.every((child) => !child.visible)).toBe(true);
    trace.invalidate(); trace.settle(() => 1200, 2000);
    expect(trace.grounded).toBe(true);
    trace.dispose();
  });
});
