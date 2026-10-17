import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRouteDetail } from "@/domain/route";
import { loadGoogleMaps } from "@/providers/google-maps-loader";
import { googleRouteThreadTreatment, initialGoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";
import { ProviderError } from "@/providers/provider-error";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorStatus,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";

vi.mock("@/providers/google-maps-loader", () => ({ loadGoogleMaps: vi.fn() }));

const route = parseRouteDetail(JSON.parse(readFileSync(new URL(
  "../../../../public/data/routes/14736711660.json", import.meta.url,
), "utf8")));

class FakeElement extends EventTarget {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  removed = false;
  declare path: Array<{ lat: number; lng: number; altitude?: number }>;

  constructor(options: object) {
    super();
    Object.assign(this, options);
  }

  append(element: FakeElement) { this.children.push(element); }
  remove() { this.removed = true; }
}

const maps: FakeElement[] = [];
class FakeMap extends FakeElement {
  constructor(options: object) {
    super(options);
    maps.push(this);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const library = {
  AltitudeMode: { RELATIVE_TO_MESH: "mesh", CLAMP_TO_GROUND: "ground", RELATIVE_TO_GROUND: "relative-ground" },
  GestureHandling: { GREEDY: "greedy" },
  MapMode: { SATELLITE: "satellite" },
  Map3DElement: FakeMap,
  Polyline3DElement: FakeElement,
};
let runtime: EventTarget;
let importLibrary: ReturnType<typeof vi.fn>;

function mount(overrides: Partial<Parameters<ReturnType<typeof createGoogleRouteNavigatorEngine>["mount"]>[0]> = {}) {
  const engine = createGoogleRouteNavigatorEngine();
  const statuses: GoogleRouteNavigatorStatus[] = [];
  const replaceChildren = vi.fn();
  const options = {
    apiKey: "test-key", route, groundingMode: "mesh" as const,
    container: { replaceChildren } as unknown as HTMLElement,
    onStatus: (status: GoogleRouteNavigatorStatus) => statuses.push(status),
    ...overrides,
  };
  const done = engine.mount(options);
  return { engine, statuses, replaceChildren, options, done };
}

function steady(map = maps.at(-1)!, isSteady = true) {
  map.dispatchEvent(Object.assign(new Event("gmp-steadychange"), { isSteady }));
}

async function sceneCreated() {
  await vi.advanceTimersByTimeAsync(0);
  expect(maps).toHaveLength(1);
  return maps[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(loadGoogleMaps).mockReset().mockResolvedValue();
  maps.length = 0;
  importLibrary = vi.fn().mockResolvedValue(library);
  runtime = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout,
    google: { maps: { importLibrary, maps3d: library } },
  });
  vi.stubGlobal("window", runtime);
  vi.stubGlobal("google", { maps: { importLibrary, maps3d: library } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google renderer lifecycle adapter", () => {
  it("keeps every filament layer on terrain and preserves the optional mesh mode", async () => {
    const run = mount({ groundingMode: "ground", routeStyle: { mode: "filament", color: "#fff", outerColor: "#fff", outerWidth: 0, width: 2 } });
    const map = await sceneCreated();
    steady(map);
    await run.done;
    expect(map.children).toHaveLength(4);
    for (const layer of map.children) expect(layer).toMatchObject({ altitudeMode: "ground" });
    for (const mode of ["mesh", "ground"] as const) {
      run.engine.setGrounding(mode);
      for (const layer of map.children) expect(layer).toMatchObject({ altitudeMode: mode });
    }
  });

  it("renders a grounded immersive thread without changing recorded geometry", async () => {
    const source = structuredClone(route.route);
    const run = mount({
      groundingMode: "ground",
      routeStyle: { mode: "filament", palette: "immersive", color: "#fff", outerColor: "#fff", outerWidth: 0, width: 2 },
    });
    const map = await sceneCreated();
    steady(map);
    await run.done;
    run.engine.setCinematicRoute(googleRouteThreadTreatment(route, {
      ...initialGoogleRouteNavigatorState(), cameraMode: "chase", progressM: 26_000,
    }));
    const [guide, future, traveled, marker] = map.children;
    expect(guide).toMatchObject({ strokeColor: "#70e1dc", style: { opacity: "0.45" } });
    expect(future).toMatchObject({ strokeColor: "#70e1dc", strokeWidth: 3.5, style: { opacity: "1" } });
    expect(traveled).toMatchObject({ strokeColor: "#ff9d54", strokeWidth: 7, style: { opacity: "1" } });
    expect(marker).toMatchObject({ strokeColor: "#fff3d6", strokeWidth: 4.5 });
    for (const layer of map.children) {
      expect(layer).toMatchObject({ altitudeMode: "relative-ground", drawsOccludedSegments: false });
      expect(layer.path.every(({ altitude }) => altitude === (layer === marker ? 1.6 : 1.25))).toBe(true);
    }
    run.engine.setGrounding("mesh");
    for (const layer of map.children) expect(layer).toMatchObject({ altitudeMode: "mesh" });
    run.engine.setGrounding("ground");
    for (const layer of map.children) expect(layer).toMatchObject({ altitudeMode: "relative-ground" });
    expect(route.route).toEqual(source);
  });

  it("keeps the position ring at the actual distance through start, seek, and finish", async () => {
    const run = mount({ routeStyle: { mode: "filament", palette: "immersive", color: "#fff", outerColor: "#fff", outerWidth: 0, width: 2 } });
    const map = await sceneCreated();
    steady(map);
    await run.done;
    const marker = map.children[3];
    for (const point of [route.route[0], route.route[250], route.route.at(-1)!]) {
      run.engine.setCinematicRoute(googleRouteThreadTreatment(route, {
        ...initialGoogleRouteNavigatorState(), cameraMode: "chase", progressM: point.d,
      }));
      expect(marker.dataset.routeVisible).toBe("true");
      expect(marker.path).toHaveLength(33);
      expect(marker.path[0]).toEqual(marker.path.at(-1));
      for (const vertex of marker.path) {
        const northM = (vertex.lat - point.lat) * Math.PI / 180 * 6_371_000;
        const eastM = (vertex.lng - point.lng) * Math.PI / 180 * 6_371_000 * Math.cos(point.lat * Math.PI / 180);
        expect(Math.hypot(northM, eastM)).toBeCloseTo(3, 2);
      }
    }
    expect(map.children[1].dataset.routeVisible).toBe("false");
    expect(map.children[2].dataset.routeVisible).toBe("true");
  });

  it.each([undefined, "neutral"] as const)("preserves the %s cinematic filament treatment", async (palette) => {
    const run = mount({ groundingMode: "ground", routeStyle: { mode: "filament", palette, color: "#fff", outerColor: "#fff", outerWidth: 0, width: 2 } });
    const map = await sceneCreated();
    steady(map);
    await run.done;
    run.engine.setCinematicRoute(googleRouteThreadTreatment(route, {
      ...initialGoogleRouteNavigatorState(), cameraMode: "chase", progressM: 26_000,
    }));
    const [, , traveled, glint] = map.children;
    expect(traveled).toMatchObject({ strokeColor: palette === "neutral" ? "#f5f5f5" : "#f06b50", altitudeMode: "ground", style: { opacity: "0.92" } });
    expect(traveled.path.every(({ altitude }) => altitude === 0.2)).toBe(true);
    expect(glint.path[0]).not.toEqual(glint.path.at(-1));
  });

  it.each([
    { overrides: { apiKey: "" }, message: "A Google Maps JavaScript API browser key is required." },
    { overrides: { route: { ...route, route: [] } }, message: "Recorded route geometry is unavailable." },
  ])("reports missing inputs without requesting Google", async ({ overrides, message }) => {
    const run = mount(overrides);
    await run.done;
    expect(run.statuses).toEqual([
      { state: "loading", message: "Loading Google photorealistic 3D." },
      { state: "unavailable", message },
    ]);
    expect(loadGoogleMaps).not.toHaveBeenCalled();
  });

  it("reports a named script failure and can retry on the same engine", async () => {
    vi.mocked(loadGoogleMaps).mockRejectedValueOnce(new ProviderError("Google Maps could not be loaded."));
    const run = mount();
    await run.done;
    expect(run.statuses.at(-1)).toEqual({ state: "unavailable", message: "Google Maps could not be loaded." });
    const retry = run.engine.mount(run.options);
    await sceneCreated();
    steady();
    await retry;
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading", "unavailable", "loading", "ready"]);
  });

  it.each(["library", "construction"])("names an unexpected %s failure", async (stage) => {
    const error = new Error("SDK internal details");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    if (stage === "library") importLibrary.mockRejectedValue(error);
    else importLibrary.mockResolvedValue({ ...library, Map3DElement: class { constructor() { throw error; } } });
    const run = mount();
    await run.done;
    expect(run.statuses.at(-1)).toEqual({
      state: "unavailable",
      message: "Google photorealistic 3D could not start in this browser. Atlas replay works everywhere.",
    });
    expect(logged).toHaveBeenCalledWith("[goDiesel] provider failure:", error);
  });

  it("waits for a true steady event and clears the scene deadline", async () => {
    const run = mount();
    const map = await sceneCreated();
    expect(run.replaceChildren).toHaveBeenCalledWith(map);
    expect(map.children).toHaveLength(1);
    steady(map, false);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
    steady(map);
    await run.done;
    await vi.advanceTimersByTimeAsync(30_001);
    expect(run.statuses.at(-1)).toEqual({ state: "ready", message: "Native Google 3D route world ready." });
    expect(run.statuses).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not recover after the scene deadline expires", async () => {
    const run = mount();
    await sceneCreated();
    await vi.advanceTimersByTimeAsync(30_000);
    await run.done;
    steady();
    expect(run.statuses.at(-1)).toEqual({ state: "unavailable", message: "Google photorealistic 3D did not finish loading." });
    expect(run.statuses).toHaveLength(2);
  });

  it.each(["loading", "ready"])("reports authentication rejection while %s", async (phase) => {
    const run = mount();
    await sceneCreated();
    if (phase === "ready") { steady(); await run.done; }
    runtime.dispatchEvent(new Event("godiesel:google-maps-auth-failure"));
    expect(run.statuses.at(-1)).toEqual({
      state: "unavailable",
      message: "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
    });
    steady();
    await run.done;
    expect(run.statuses.at(-1)?.state).toBe(phase === "loading" ? "ready" : "unavailable");
  });

  it("keeps authentication rejection visible while the API finishes loading", async () => {
    const loaded = deferred<void>();
    vi.mocked(loadGoogleMaps).mockReturnValue(loaded.promise);
    const run = mount();
    runtime.dispatchEvent(new Event("godiesel:google-maps-auth-failure"));
    loaded.resolve();
    await sceneCreated();
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading", "unavailable"]);
    steady();
    await run.done;
    expect(run.statuses.at(-1)?.state).toBe("ready");
  });

  it("reports both scene-error messages in their existing order", async () => {
    const run = mount();
    const map = await sceneCreated();
    map.dispatchEvent(new Event("gmp-error"));
    await run.done;
    expect(run.statuses.slice(1)).toEqual([
      { state: "unavailable", message: "This browser could not start Google photorealistic 3D. Try a hardware-accelerated Chrome window." },
      { state: "unavailable", message: "Google photorealistic 3D could not render this scene." },
    ]);
    steady(map);
    expect(run.statuses).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports scene errors after ready without restarting the deadline", async () => {
    const run = mount();
    const map = await sceneCreated();
    steady(map);
    await run.done;
    map.dispatchEvent(new Event("gmp-error"));
    expect(run.statuses.at(-1)?.message).toContain("hardware-accelerated Chrome");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish the outcome of a replaced API request", async () => {
    const first = deferred<void>();
    vi.mocked(loadGoogleMaps).mockReturnValueOnce(first.promise);
    const run = mount();
    const secondStatuses: GoogleRouteNavigatorStatus[] = [];
    const second = run.engine.mount({ ...run.options, onStatus: (status) => secondStatuses.push(status) });
    await sceneCreated();
    steady();
    await second;
    first.resolve();
    await run.done;
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
    expect(secondStatuses.map(({ state }) => state)).toEqual(["loading", "ready"]);
    expect(maps).toHaveLength(1);
  });

  it("destroy removes the scene and suppresses pending steady and authentication outcomes", async () => {
    const run = mount();
    const map = await sceneCreated();
    run.engine.destroy();
    runtime.dispatchEvent(new Event("godiesel:google-maps-auth-failure"));
    steady(map);
    await run.done;
    expect(map.removed).toBe(true);
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
  });

  it("destroy during API loading prevents scene installation", async () => {
    const loaded = deferred<void>();
    vi.mocked(loadGoogleMaps).mockReturnValue(loaded.promise);
    const run = mount();
    run.engine.destroy();
    loaded.resolve();
    await run.done;
    expect(run.replaceChildren).not.toHaveBeenCalled();
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
  });

  it("destroy cancels the deadline and detaches scene error callbacks", async () => {
    const run = mount();
    const map = await sceneCreated();
    run.engine.destroy();
    map.dispatchEvent(new Event("gmp-error"));
    await run.done;
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replacement disposes the old scene and publishes auth failures only to the active mount", async () => {
    const run = mount();
    const previousMap = await sceneCreated();
    const nextStatuses: GoogleRouteNavigatorStatus[] = [];
    const next = run.engine.mount({ ...run.options, onStatus: (status) => nextStatuses.push(status) });
    await vi.advanceTimersByTimeAsync(0);
    runtime.dispatchEvent(new Event("godiesel:google-maps-auth-failure"));
    previousMap.dispatchEvent(new Event("gmp-error"));
    steady(maps[1]);
    await Promise.all([run.done, next]);
    expect(run.statuses.map(({ state }) => state)).toEqual(["loading"]);
    expect(nextStatuses.map(({ state }) => state)).toEqual(["loading", "unavailable", "ready"]);
    expect(previousMap.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
