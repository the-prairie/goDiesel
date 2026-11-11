import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Cartesian3,
  Cesium3DTileset,
  Event as CesiumEvent,
  TileMapServiceImageryProvider,
} from "cesium";

import {
  CesiumAtlasWorldEngine,
  guardAtlasCameraRotation,
  routeForPickedEntity,
} from "@/surfaces/atlas/cesium-atlas-world-engine";
import {
  initialAtlasWorldEngineState,
  reduceAtlasWorldEngine,
  type AtlasWorldEngineEvent,
} from "@/surfaces/atlas/atlas-world-engine-state";
import { completedRoutes } from "@/data/routes";
import { routeRegions } from "@/data/route-regions";

const cesiumDoubles = vi.hoisted(() => ({
  createViewer: undefined as undefined | ((container: unknown) => unknown),
}));

vi.mock("cesium", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cesium")>();
  return {
    ...actual,
    Viewer: class {
      constructor(container: unknown) {
        return cesiumDoubles.createViewer!(container) as object;
      }
    },
    ScreenSpaceEventHandler: class {
      setInputAction() {}
      destroy() {}
    },
    buildModuleUrl: (path: string) => path,
  };
});

describe("CesiumAtlasWorldEngine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([["zoomIn", 0.72], ["zoomOut", 1.35]] as const)(
    "%s persists after an interrupted initialization flight would have completed",
    (command, factor) => {
      let height = 10_000_000;
      let finishFlight: (() => void) | undefined = () => { height = 18_500_000; };
      const viewer = {
        isDestroyed: () => false,
        canvas: { dataset: {} },
        scene: { screenSpaceCameraController: {
          minimumZoomDistance: 1, maximumZoomDistance: 100_000_000,
        } },
        camera: {
          positionCartographic: { get height() { return height; } },
          cancelFlight: () => { finishFlight = undefined; },
          zoomIn: (amount: number) => { height -= amount; },
          zoomOut: (amount: number) => { height += amount; },
        },
      };
      const engine = new CesiumAtlasWorldEngine();
      const events: AtlasWorldEngineEvent[] = [
        { type: "mountStarted", routeCount: 0 },
        { type: "viewerAttached", operationId: 1 },
      ];
      Object.assign(engine, {
        viewer,
        state: events.reduce(reduceAtlasWorldEngine, initialAtlasWorldEngineState()),
      });

      engine[command]();
      finishFlight?.();

      expect(height).toBeCloseTo(10_000_000 * factor);
    },
  );

  it("ignores only the zero-axis rotation produced by a centered pinch", () => {
    const rotate = vi.fn();
    const camera = { rotate };
    guardAtlasCameraRotation(camera);

    camera.rotate(new Cartesian3(0, 0, 0), 1e-8);
    expect(rotate).not.toHaveBeenCalled();

    const axis = new Cartesian3(0, 0, 1);
    camera.rotate(axis, 0.25);
    expect(rotate).toHaveBeenCalledWith(axis, 0.25);
    expect(rotate.mock.contexts[0]).toBe(camera);
    const tinyAxis = new Cartesian3(0, 0, 1e-12);
    camera.rotate(tinyAxis, 1e-8);
    expect(rotate).toHaveBeenLastCalledWith(tinyAxis, 1e-8);

    const invalidAxis = new Cartesian3(Number.NaN, 0, 0);
    camera.rotate(invalidAxis, 0.1);
    expect(rotate).toHaveBeenLastCalledWith(invalidAxis, 0.1);
    camera.rotate(Cartesian3.ZERO, Number.NaN);
    expect(rotate).toHaveBeenLastCalledWith(Cartesian3.ZERO, Number.NaN);
  });

  it("releases Cesium listeners, keyboard input, and the viewer", () => {
    const removeRenderErrorListener = vi.fn();
    const removeCameraChangedListener = vi.fn();
    const removeEventListener = vi.fn();
    const destroyViewer = vi.fn();
    const keyDownHandler = vi.fn();
    const viewer = {
      canvas: { removeEventListener },
      bottomContainer: { setAttribute: vi.fn() },
      camera: { frustum: {} },
      scene: { globe: { show: false } },
      useDefaultRenderLoop: false,
      isDestroyed: () => false,
      destroy: destroyViewer,
    };
    const engine = new CesiumAtlasWorldEngine();

    Object.assign(engine, {
      viewer,
      removeRenderErrorListener,
      removeCameraChangedListener,
      keyDownHandler,
    });

    engine.destroy();

    expect(removeRenderErrorListener).toHaveBeenCalledOnce();
    expect(removeCameraChangedListener).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith("keydown", keyDownHandler);
    expect(destroyViewer).toHaveBeenCalledOnce();

    engine.destroy();
    expect(destroyViewer).toHaveBeenCalledOnce();
  });

  it("does not treat a terrain readiness timeout as loaded tiles", async () => {
    vi.useFakeTimers();
    const removeLoadedListener = vi.fn();
    const addEventListener = vi.fn(() => removeLoadedListener);
    const engine = new CesiumAtlasWorldEngine();
    const waitForUsefulTerrain = Reflect.get(
      engine,
      "waitForUsefulTerrain",
    ) as (tileset: {
      tilesLoaded: boolean;
      allTilesLoaded: { addEventListener: typeof addEventListener };
    }) => Promise<boolean>;

    const result = waitForUsefulTerrain.call(engine, {
      tilesLoaded: false,
      allTilesLoaded: { addEventListener },
    });
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(result).resolves.toBe(false);
    expect(removeLoadedListener).toHaveBeenCalledOnce();
  });

  it.each(["complete", "cancel"] as const)(
    "reports the global Atlas ready only after its camera flight %ss",
    async (settleWith) => {
      vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
      const h = await mountedInFallback();
      h.onStatus.mockClear();

      h.engine.setSelectedRegion(undefined);

      expect(h.onStatus.mock.calls.map(([status]) => status.state)).toEqual(["loading"]);
      expect(h.values.cameraState).toBe("transitioning");

      h.globalFlights.at(-1)![settleWith]!();
      await Promise.resolve();

      expect(h.onStatus.mock.calls.map(([status]) => status.state)).toEqual([
        "loading",
        "ready",
      ]);
      expect(h.values.cameraState).toBe("settled");
    },
  );

  it("settles the global camera immediately for reduced motion", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = await mountedInFallback({ reducedMotion: true });
    h.onStatus.mockClear();

    h.engine.setSelectedRegion(undefined);
    await Promise.resolve();

    expect(h.globalFlights.at(-1)!.duration).toBe(0);
    expect(h.onStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
    expect(h.values.cameraState).toBe("settled");
  });

  it("does not start another global flight when the globe is already settled", async () => {
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    h.onStatus.mockClear();

    h.engine.setSelectedRegion(undefined);

    expect(h.globalFlights).toHaveLength(1);
    expect(h.onStatus).toHaveBeenCalledWith({
      state: "ready",
      message: "Atlas world ready.",
    });
  });

  it("shares an active global camera flight with reset requests", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = await mountedInFallback();
    const flights = h.globalFlights.length;
    h.onStatus.mockClear();

    h.engine.setSelectedRegion(undefined);
    h.engine.resetView();

    expect(h.globalFlights).toHaveLength(flights + 1);
    expect(h.onStatus.mock.calls.map(([status]) => status.state)).toEqual(["loading"]);

    h.globalFlights.at(-1)!.complete!();
    await Promise.resolve();

    expect(h.onStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
  });

  it("waits for the latest global camera generation", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness();
    let mounted = false;
    void h.mount().then(() => { mounted = true; });
    await flushMicrotasks();
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRegion(undefined);

    h.globalFlights[0].complete!();
    await flushMicrotasks();

    expect(mounted).toBe(false);

    h.globalFlights[1].complete!();
    await flushMicrotasks();

    expect(mounted).toBe(true);
  });

  it("resolves a picked terrain thread only within the selected region", () => {
    const kyoto = completedRoutes.find((route) => route.region === "Kyoto, Japan")!;
    const crete = completedRoutes.find((route) => route.region === "Crete, Greece")!;
    const kyotoEntity = {};
    const creteEntity = {};
    const entries = [
      { regionName: kyoto.region, route: kyoto, entity: kyotoEntity },
      { regionName: crete.region, route: crete, entity: creteEntity },
    ];

    expect(
      routeForPickedEntity(entries as never, kyoto.region, kyotoEntity as never),
    ).toBe(kyoto);
    expect(
      routeForPickedEntity(entries as never, kyoto.region, creteEntity as never),
    ).toBeUndefined();
    expect(routeForPickedEntity(entries as never, undefined, kyotoEntity as never)).toBeUndefined();
  });
});

const kyoto = routeRegions.find((region) => region.name === "Kyoto, Japan")!;
const flushMicrotasks = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

const LIFECYCLE_DATASET_KEYS = [
  "atlasEngine", "heatLines", "routePalette", "atlasState", "cameraState",
  "terrainState", "regionRouteCount", "cameraRegion", "selectedRoute",
  "cameraDurationMs", "regionCameraRange", "regionSphereRadius",
  "regionCameraPitch", "cameraTarget", "cameraHeading", "cameraPitch",
] as const;

interface FlightRequest {
  duration?: number;
  complete?: () => void;
  cancel?: () => void;
}

/**
 * A Cesium viewer double that records every canvas dataset change (a write
 * that repeats the current value is not a change) and every camera flight.
 */
function mountHarness({
  reducedMotion = false,
  webgl = true,
  viewerThrows = false,
  imagery = "resolves" as "resolves" | "rejects" | "pending",
} = {}) {
  const values: Record<string, string> = {};
  const history: Record<string, string[]> = {};
  const dataset = new Proxy(values, {
    set(target, key: string, value) {
      const next = String(value);
      if (target[key] !== next) (history[key] ??= []).push(next);
      target[key] = next;
      return true;
    },
  });
  const globalFlights: FlightRequest[] = [];
  const regionFlights: FlightRequest[] = [];
  let height = 18_500_000;
  let pitch = -Math.PI / 2;
  const viewers: Array<Record<string, unknown>> = [];
  cesiumDoubles.createViewer = () => {
    if (viewerThrows) throw new Error("Viewer construction failed");
    const camera = {
      frustum: {},
      percentageChanged: 0,
      heading: 0,
      get pitch() { return pitch; },
      positionCartographic: { get height() { return height; } },
      positionWC: new Cartesian3(0, 0, 1),
      changed: new CesiumEvent(),
      rotate: vi.fn(),
      setView: vi.fn(),
      cancelFlight: vi.fn(),
      zoomIn: vi.fn((amount: number) => { height -= amount; }),
      zoomOut: vi.fn((amount: number) => { height += amount; }),
      flyTo: vi.fn((options: FlightRequest) => { globalFlights.push(options); }),
      flyToBoundingSphere: vi.fn((_sphere: unknown, options: FlightRequest) => {
        regionFlights.push(options);
      }),
    };
    const viewer = {
      canvas: {
        dataset, clientWidth: 1280, clientHeight: 720, width: 1280, height: 720,
        tabIndex: -1, setAttribute: vi.fn(), classList: { add: vi.fn() },
        addEventListener: vi.fn(), removeEventListener: vi.fn(), getContext: () => null,
      },
      bottomContainer: { setAttribute: vi.fn() },
      camera,
      resolutionScale: 1,
      useDefaultRenderLoop: true,
      scene: {
        postProcessStages: { fxaa: { enabled: false } },
        skyAtmosphere: { atmosphereLightIntensity: 0 },
        globe: { show: false },
        screenSpaceCameraController: { minimumZoomDistance: 1, maximumZoomDistance: 0 },
        primitives: { add: vi.fn(), remove: vi.fn() },
        renderError: new CesiumEvent(),
        pick: vi.fn(),
      },
      imageryLayers: { addImageryProvider: vi.fn(() => ({ show: true })) },
      entities: {
        add: vi.fn((options: { polyline: object }) => ({ show: true, polyline: { ...options.polyline } })),
      },
      destroyed: false,
      isDestroyed() { return this.destroyed; },
      destroy: vi.fn(function (this: { destroyed: boolean }) { this.destroyed = true; }),
    };
    viewers.push(viewer);
    return viewer;
  };
  let resolveImagery: (value: unknown) => void = () => {};
  vi.spyOn(TileMapServiceImageryProvider, "fromUrl").mockImplementation(() => {
    if (imagery === "rejects") return Promise.reject(new Error("Imagery unavailable"));
    if (imagery === "pending") return new Promise((resolve) => { resolveImagery = resolve; }) as never;
    return Promise.resolve({}) as never;
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: reducedMotion }),
    devicePixelRatio: 1,
    setInterval,
    clearInterval,
  });
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => (webgl ? {} : null) }),
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("HTMLElement", class {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const onStatus = vi.fn();
  const engine = new CesiumAtlasWorldEngine();
  const viewer = () => viewers.at(-1) as unknown as {
    destroy: ReturnType<typeof vi.fn>;
    useDefaultRenderLoop: boolean;
    scene: { renderError: CesiumEvent };
    camera: { changed: CesiumEvent; setView: ReturnType<typeof vi.fn> };
  } | undefined;
  return {
    engine,
    onStatus,
    globalFlights,
    regionFlights,
    viewer,
    values,
    resolveImagery: () => resolveImagery({}),
    mount: () => engine.mount({
      container: { clientWidth: 1280, clientHeight: 720 } as unknown as HTMLElement,
      regions: routeRegions,
      onStatus,
    }),
    statuses: () => onStatus.mock.calls.map(([status]) =>
      "regionName" in status
        ? `${status.state}:${status.regionName}:${status.message}`
        : `${status.state}:${status.message}`),
    lifecycleDataset: () => Object.fromEntries(
      LIFECYCLE_DATASET_KEYS.filter((key) => key in history).map((key) => [key, history[key]]),
    ),
    setCamera: (next: { height?: number; pitch?: number }) => {
      height = next.height ?? height;
      pitch = next.pitch ?? pitch;
    },
  };
}

/** Mounted, settled globally, then Kyoto selected and fallen back (no map key). */
async function mountedInFallback(options: Parameters<typeof mountHarness>[0] = {}) {
  const h = mountHarness(options);
  void h.mount();
  await flushMicrotasks();
  h.globalFlights[0].complete?.();
  await flushMicrotasks();
  h.engine.setSelectedRegion(kyoto);
  h.regionFlights[0].complete!();
  await flushMicrotasks();
  expect(h.values.atlasState).toBe("region-fallback");
  return h;
}

const LOADING = "loading:Opening the Atlas world.";
const READY = "ready:Atlas world ready.";
const COULD_NOT_LOAD = "unavailable:The Cesium world could not load.";
const STOPPED = "unavailable:The Cesium world stopped rendering.";
const KYOTO_LOADING = `region-loading:${kyoto.name}:Loading ${kyoto.name} terrain`;
const KYOTO_FALLBACK = `region-fallback:${kyoto.name}:3D terrain partially unavailable`;
const KYOTO_READY = `region-ready:${kyoto.name}:${kyoto.name} terrain ready.`;
const GLOBAL_POSE = {
  cameraTarget: "18500000",
  cameraHeading: "0.000000",
  cameraPitch: (-Math.PI / 2).toFixed(6),
};
const MOUNT_DATASET = {
  atlasEngine: ["cesium"],
  heatLines: [String(routeRegions.reduce((count, region) => count + region.routes.length, 0))],
  routePalette: ["monochrome"],
  atlasState: ["global"],
  terrainState: ["global"],
  regionRouteCount: ["0"],
  regionCameraRange: [""],
  regionSphereRadius: [""],
  regionCameraPitch: [""],
};

describe("CesiumAtlasWorldEngine mount lifecycle (characterization)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("succeeds after the initial global flight completes", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness();
    let mounted = false;
    void h.mount().then(() => { mounted = true; });
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING]);
    expect(h.globalFlights).toHaveLength(1);
    expect(h.globalFlights[0].duration).toBe(0.6);
    expect(h.values.cameraState).toBe("transitioning");
    expect(mounted).toBe(false);

    h.globalFlights[0].complete!();
    await flushMicrotasks();
    expect(mounted).toBe(true);
    expect(h.statuses()).toEqual([LOADING, READY]);
    expect(h.lifecycleDataset()).toEqual({
      ...MOUNT_DATASET,
      cameraState: ["settled", "transitioning", "settled"],
      cameraDurationMs: ["600"],
      cameraTarget: [GLOBAL_POSE.cameraTarget],
      cameraHeading: [GLOBAL_POSE.cameraHeading],
      cameraPitch: [GLOBAL_POSE.cameraPitch],
    });
  });

  it("settles the mount flight immediately for reduced motion", async () => {
    const h = mountHarness({ reducedMotion: true });
    await h.mount();
    expect(h.globalFlights[0].duration).toBe(0);
    expect(h.statuses()).toEqual([LOADING, READY]);
    expect(h.lifecycleDataset().cameraState).toEqual(["settled"]);
    expect(h.lifecycleDataset().cameraDurationMs).toEqual(["0"]);
  });

  it("reports an unusable browser before creating a viewer", async () => {
    const h = mountHarness({ webgl: false });
    await h.mount();
    expect(h.statuses()).toEqual([LOADING, "unavailable:This browser cannot start the Cesium world."]);
    expect(h.viewer()).toBeUndefined();
    h.engine.setSelectedRegion(kyoto);
    h.engine.resetView();
    expect(h.statuses()).toHaveLength(2);
  });

  it("fails before the viewer exists and ignores later selection", async () => {
    const h = mountHarness({ viewerThrows: true });
    await h.mount();
    expect(h.statuses()).toEqual([LOADING, COULD_NOT_LOAD]);
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRegion(undefined);
    h.engine.resetView();
    expect(h.statuses()).toEqual([LOADING, COULD_NOT_LOAD]);
  });

  /** Selection, reset, and route commands an unavailable engine must refuse. */
  function expectSelectionRefused(h: ReturnType<typeof mountHarness>) {
    const statuses = h.statuses();
    const dataset = { ...h.values };
    const flights = [h.globalFlights.length, h.regionFlights.length];
    h.viewer()!.useDefaultRenderLoop = false;
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRoute(kyoto.routes[0]);
    h.engine.setSelectedRegion(undefined);
    h.engine.resetView();
    expect(h.statuses()).toEqual(statuses);
    expect([h.globalFlights.length, h.regionFlights.length]).toEqual(flights);
    expect(h.viewer()!.useDefaultRenderLoop).toBe(false);
    expect(h.values).toEqual(dataset);
  }

  it("keeps a mount that failed after the viewer existed unavailable for selection", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness({ imagery: "rejects" });
    await h.mount();
    expect(h.statuses()).toEqual([LOADING, COULD_NOT_LOAD]);
    expect(h.globalFlights).toHaveLength(0);
    expectSelectionRefused(h);
    expect(h.statuses()).toEqual([LOADING, COULD_NOT_LOAD]);
  });

  it("suppresses mount readiness after a render error and refuses later selection", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness();
    let mounted = false;
    void h.mount().then(() => { mounted = true; });
    await flushMicrotasks();
    h.viewer()!.scene.renderError.raiseEvent();
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    expect(mounted).toBe(true);
    expect(h.statuses()).toEqual([LOADING, STOPPED]);
    expectSelectionRefused(h);
  });

  it("refuses reset and selection after a render error that follows readiness", async () => {
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    h.viewer()!.scene.renderError.raiseEvent();
    expect(h.statuses()).toEqual([LOADING, READY, STOPPED]);
    expectSelectionRefused(h);
  });

  it("keeps the render error when a region that was loading settles afterwards", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const tileset = {
      tilesLoaded: false, allTilesLoaded: new CesiumEvent(), tileFailed: new CesiumEvent(), destroy: vi.fn(),
    };
    vi.spyOn(Cesium3DTileset, "fromUrl").mockResolvedValue(tileset as unknown as Cesium3DTileset);
    const h = mountHarness({ reducedMotion: true });
    await h.mount();
    h.engine.setSelectedRegion(kyoto);
    await flushMicrotasks();
    h.viewer()!.scene.renderError.raiseEvent();
    h.regionFlights[0].complete!();
    tileset.allTilesLoaded.raiseEvent();
    await flushMicrotasks();
    for (let i = 0; i < 8; i++) tileset.tileFailed.raiseEvent();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.statuses()).toEqual([LOADING, READY, KYOTO_LOADING, STOPPED]);
    h.engine.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a mount that is destroyed while imagery loads", async () => {
    const h = mountHarness({ imagery: "pending" });
    const mounted = h.mount();
    await flushMicrotasks();
    h.engine.destroy();
    h.resolveImagery();
    await mounted;
    expect(h.statuses()).toEqual([LOADING]);
    expect(h.viewer()!.destroy).toHaveBeenCalledOnce();
    expect(h.globalFlights).toHaveLength(0);
  });

  it("drops readiness when destroyed during the mount flight", async () => {
    const h = mountHarness();
    const mounted = h.mount();
    await flushMicrotasks();
    h.engine.destroy();
    await mounted;
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING]);
    expect(h.values.cameraState).toBe("transitioning");
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRoute(kyoto.routes[0]);
    h.engine.resetView();
    expect(h.statuses()).toEqual([LOADING]);
    expect(h.globalFlights).toHaveLength(1);
  });

  it("shares the mount flight with reset and global selection requests", async () => {
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    h.engine.resetView();
    h.engine.setSelectedRegion(undefined);
    expect(h.globalFlights).toHaveLength(1);
    expect(h.statuses()).toEqual([LOADING, LOADING]);
    h.globalFlights[0].cancel!();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING, LOADING, READY, READY]);
    expect(h.lifecycleDataset().cameraState).toEqual(["settled", "transitioning", "settled"]);
    expect(h.lifecycleDataset().cameraRegion).toEqual([""]);
  });

  it("waits for the replacement global flight before reporting mount readiness", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRegion(undefined);
    await flushMicrotasks();
    expect(h.globalFlights).toHaveLength(2);
    expect(h.statuses()).toEqual([LOADING, KYOTO_LOADING, LOADING]);
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING, KYOTO_LOADING, LOADING]);
    h.globalFlights[1].complete!();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING, KYOTO_LOADING, LOADING, READY, READY]);
  });

  it("does not fly again when the settled globe is selected globally", async () => {
    const h = mountHarness({ reducedMotion: true });
    await h.mount();
    h.engine.setSelectedRegion(undefined);
    expect(h.globalFlights).toHaveLength(1);
    expect(h.statuses()).toEqual([LOADING, READY, READY]);
  });

  it("round-trips a region through fallback and back to the globe", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    h.engine.setSelectedRoute(kyoto.routes[1]);
    h.engine.setSelectedRegion(kyoto);
    expect(h.values.cameraState).toBe("transitioning");
    h.regionFlights[0].complete!();
    await flushMicrotasks();
    expect(h.viewer()!.useDefaultRenderLoop).toBe(false);
    h.engine.setSelectedRegion(undefined);
    expect(h.viewer()!.useDefaultRenderLoop).toBe(true);
    expect(h.globalFlights).toHaveLength(2);
    h.globalFlights[1].complete!();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING, READY, KYOTO_LOADING, KYOTO_FALLBACK, LOADING, READY]);
    const dataset = h.lifecycleDataset();
    expect(dataset).toMatchObject({
      atlasState: ["global", "region-loading", "region-fallback", "global"],
      terrainState: ["global", "loading", "fallback", "global"],
      cameraState: ["settled", "transitioning", "settled", "transitioning", "settled", "transitioning", "settled"],
      regionRouteCount: ["0", String(kyoto.routes.length), "0"],
      cameraRegion: [kyoto.name, ""],
      selectedRoute: [kyoto.routes[1].slug],
      cameraDurationMs: ["600", "1150", "600"],
      regionCameraPitch: ["", "-1.02"],
    });
    expect(dataset.regionCameraRange).toHaveLength(2);
    expect(dataset.regionSphereRadius).toHaveLength(2);
    expect(dataset.cameraTarget).toEqual([
      GLOBAL_POSE.cameraTarget, dataset.regionCameraRange![1], GLOBAL_POSE.cameraTarget,
    ]);
  });

  it("keeps the dataset transitioning through the terrain wait until regional readiness", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    const tileset = {
      tilesLoaded: false, allTilesLoaded: new CesiumEvent(), tileFailed: new CesiumEvent(), destroy: vi.fn(),
    };
    vi.spyOn(Cesium3DTileset, "fromUrl").mockResolvedValue(tileset as unknown as Cesium3DTileset);
    const h = mountHarness({ reducedMotion: true });
    await h.mount();
    h.engine.setSelectedRegion(kyoto);
    h.regionFlights[0].complete!();
    await flushMicrotasks();
    expect(h.values.cameraState).toBe("transitioning");
    tileset.allTilesLoaded.raiseEvent();
    await flushMicrotasks();
    expect(h.statuses()).toEqual([LOADING, READY, KYOTO_LOADING, KYOTO_READY]);
    expect(h.lifecycleDataset()).toMatchObject({
      atlasState: ["global", "region-loading", "region-ready"],
      terrainState: ["global", "loading", "ready"],
      cameraState: ["settled", "transitioning", "settled"],
      cameraDurationMs: ["0", "120"],
    });
    h.engine.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the styled route on global return without rewriting the selected-route attribute", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = mountHarness({ reducedMotion: true });
    await h.mount();
    h.engine.setSelectedRegion(kyoto);
    h.engine.setSelectedRoute(kyoto.routes[0]);
    h.engine.setSelectedRegion(undefined);
    expect(h.values.selectedRoute).toBe(kyoto.routes[0].slug);
    h.engine.setSelectedRoute(undefined);
    expect(h.lifecycleDataset().selectedRoute).toEqual([kyoto.routes[0].slug, ""]);
  });

  it("clamps orbital pitch only while the camera is not transitioning", async () => {
    const h = mountHarness();
    void h.mount();
    await flushMicrotasks();
    const camera = h.viewer()!.camera;
    h.setCamera({ height: 10_000_000, pitch: 0 });
    camera.changed.raiseEvent();
    expect(camera.setView).not.toHaveBeenCalled();
    h.globalFlights[0].complete!();
    await flushMicrotasks();
    camera.changed.raiseEvent();
    expect(camera.setView).toHaveBeenCalledOnce();
    expect(h.values.cameraHeight).toBe("10000000");
    expect(h.values.cameraTarget).toBe("10000000");
  });
});
