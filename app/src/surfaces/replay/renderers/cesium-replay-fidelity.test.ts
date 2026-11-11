import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { QuestRoute } from "@/domain/route";
import { CesiumReplayEngine } from "./cesium-replay-engine";

type TestEvent = {
  addEventListener: (callback: () => void) => () => void;
  raise: () => void;
  count: () => number;
};
type TestTileset = {
  tilesLoaded: boolean;
  tileFailed: TestEvent;
  allTilesLoaded: TestEvent;
};
type TestViewer = { destroy: Mock };
const provider = vi.hoisted(() => ({
  viewers: [] as TestViewer[],
  tilesets: [] as TestTileset[],
  reject: false,
  loaded: true,
  blank: false,
  holdZoom: false,
  heldZooms: [] as Array<{ resolve: () => void; reject: () => void }>,
  holdTileset: false,
  heldTilesets: [] as Array<{ resolve: () => void; reject: () => void }>,
  doubleDestroyThrows: false,
}));
vi.mock("cesium", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cesium")>();
  const event = () => {
    const callbacks = new Set<() => void>();
    return {
      addEventListener: (callback: () => void) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
      raise: () => callbacks.forEach((callback) => callback()),
      count: () => callbacks.size,
    };
  };
  return {
    ...actual,
    Viewer: class {
      destroyed = false;
      scene = {
        globe: { show: true },
        screenSpaceCameraController: {},
        primitives: { add: vi.fn() },
      };
      entities = { add: (options: unknown) => options };
      canvas = {
        width: 100,
        height: 100,
        getContext: () => ({
          RGBA: 1,
          UNSIGNED_BYTE: 1,
          readPixels: (
            _x: number,
            _y: number,
            _width: number,
            _height: number,
            _format: number,
            _type: number,
            pixels: Uint8Array,
          ) => pixels.fill(provider.blank ? 0 : 255),
        }),
      };
      zoomTo = vi.fn(() =>
        provider.holdZoom
          ? new Promise<void>((resolve, reject) =>
              provider.heldZooms.push({
                resolve,
                reject: () => reject(new Error("Camera failed")),
              }),
            )
          : Promise.resolve(),
      );
      destroy = vi.fn(() => {
        if (this.destroyed && provider.doubleDestroyThrows)
          throw new Error("This object was destroyed");
        this.destroyed = true;
      });
      isDestroyed = () => this.destroyed;
      constructor() {
        provider.viewers.push(this);
      }
    },
    Cesium3DTileset: {
      fromUrl: vi.fn(async () => {
        if (provider.holdTileset) {
          let fail = false;
          await new Promise<void>((resolve) =>
            provider.heldTilesets.push({
              resolve,
              reject: () => {
                fail = true;
                resolve();
              },
            }),
          );
          if (fail) throw new Error("Provider failed");
        }
        if (provider.reject) throw new Error("Provider failed");
        const tileset = {
          tilesLoaded: provider.loaded,
          tileFailed: event(),
          allTilesLoaded: event(),
        };
        provider.tilesets.push(tileset);
        return tileset;
      }),
    },
  };
});
const route = {
  name: "Test route",
  route: [
    { lat: 35, lng: 135, elev: 100 },
    { lat: 35.01, lng: 135.01, elev: 120 },
  ],
} as QuestRoute;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function start() {
  const engine = new CesiumReplayEngine();
  const onStatus = vi.fn();
  const mounted = engine.mount({
    container: {} as HTMLElement,
    route,
    onStatus,
  });
  return { engine, onStatus, mounted };
}

describe("Cesium Replay fidelity contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "fixture-key");
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => ({}) }),
    });
    provider.viewers = [];
    provider.tilesets = [];
    provider.reject = false;
    provider.loaded = true;
    provider.blank = false;
    provider.holdZoom = false;
    provider.heldZooms = [];
    provider.holdTileset = false;
    provider.heldTilesets = [];
    provider.doubleDestroyThrows = false;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("becomes ready immediately when initial tiles are loaded", async () => {
    const h = start();
    await h.mounted;
    expect(h.onStatus.mock.calls.map((call) => call[0].state)).toEqual([
      "loading",
      "ready",
    ]);
    expect(h.onStatus.mock.lastCall?.[0].message).toBe(
      "The route thread is ready to move.",
    );
    h.engine.destroy();
  });
  it("waits for initial tile completion and removes its listener", async () => {
    provider.loaded = false;
    const h = start();
    await flush();
    expect(h.onStatus).toHaveBeenCalledTimes(1);
    provider.tilesets[0].allTilesLoaded.raise();
    await h.mounted;
    expect(h.onStatus.mock.lastCall?.[0].state).toBe("ready");
    expect(provider.tilesets[0].allTilesLoaded.count()).toBe(0);
    h.engine.destroy();
  });
  it("permits ready after the eight-second tile deadline", async () => {
    provider.loaded = false;
    const h = start();
    await flush();
    await vi.advanceTimersByTimeAsync(7999);
    expect(h.onStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.mounted;
    expect(h.onStatus.mock.lastCall?.[0].message).toBe(
      "The route is ready while finer tile detail continues loading.",
    );
    h.engine.destroy();
  });
  it("publishes partial once at eight failures and never overwrites it with ready", async () => {
    provider.loaded = false;
    const h = start();
    await flush();
    for (let i = 0; i < 7; i++) provider.tilesets[0].tileFailed.raise();
    expect(h.onStatus).toHaveBeenCalledTimes(1);
    provider.tilesets[0].tileFailed.raise();
    provider.tilesets[0].tileFailed.raise();
    provider.tilesets[0].allTilesLoaded.raise();
    await h.mounted;
    expect(h.onStatus.mock.calls.map((call) => call[0].state)).toEqual([
      "loading",
      "partial",
    ]);
    h.engine.destroy();
  });
  it("expires old tile failures outside the fifteen-second window", async () => {
    const h = start();
    await h.mounted;
    for (let i = 0; i < 7; i++) provider.tilesets[0].tileFailed.raise();
    await vi.advanceTimersByTimeAsync(15001);
    provider.tilesets[0].tileFailed.raise();
    expect(h.onStatus.mock.lastCall?.[0].state).toBe("ready");
    h.engine.destroy();
  });
  it("requires two consecutive blank frames and retains partial after recovery", async () => {
    const h = start();
    await h.mounted;
    provider.blank = true;
    await vi.advanceTimersByTimeAsync(8000);
    provider.blank = false;
    await vi.advanceTimersByTimeAsync(8000);
    provider.blank = true;
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.onStatus.mock.lastCall?.[0].state).toBe("ready");
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.onStatus.mock.lastCall?.[0].state).toBe("partial");
    provider.blank = false;
    await vi.advanceTimersByTimeAsync(16000);
    expect(h.onStatus.mock.calls.map((call) => call[0].state)).toEqual([
      "loading",
      "ready",
      "partial",
    ]);
    h.engine.destroy();
  });
  it("cancels pending initialization and diagnostics on disposal", async () => {
    provider.loaded = false;
    const h = start();
    await flush();
    h.engine.destroy();
    await h.mounted;
    provider.tilesets[0].allTilesLoaded.raise();
    provider.tilesets[0].tileFailed.raise();
    await vi.advanceTimersByTimeAsync(32000);
    expect(h.onStatus.mock.calls.map((call) => call[0].state)).toEqual([
      "loading",
    ]);
    expect(provider.viewers[0].destroy).toHaveBeenCalledOnce();
    expect(provider.tilesets[0].tileFailed.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("destroys resources when provider construction fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    provider.reject = true;
    const h = start();
    await h.mounted;
    expect(provider.viewers[0].destroy).toHaveBeenCalledOnce();
    expect(h.onStatus.mock.calls.map((call) => call[0].state)).toEqual([
      "loading",
      "unavailable",
    ]);
  });
  it("rejects missing credentials before constructing resources", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = start();
    await h.mounted;
    expect(provider.viewers).toHaveLength(0);
    expect(h.onStatus.mock.lastCall?.[0].title).toBe("Map tiles unavailable");
  });

  it("destroys a viewer once when disposed before its tileset resolves", async () => {
    provider.holdTileset = true;
    provider.doubleDestroyThrows = true;
    const h = start();
    await flush();
    h.engine.destroy();
    provider.heldTilesets[0].resolve();
    await h.mounted;
    expect(provider.viewers[0].destroy).toHaveBeenCalledOnce();
  });

  describe("status characterization", () => {
    const LOADING = {
      state: "loading",
      title: "Building your route world",
      message: "Loading the bundled Earth engine and photorealistic tiles.",
    };
    const READY_LOADED = {
      state: "ready",
      title: "Earth Replay ready",
      message: "The route thread is ready to move.",
    };
    const READY_TIMEOUT = {
      state: "ready",
      title: "Earth Replay ready",
      message: "The route is ready while finer tile detail continues loading.",
    };
    const PARTIAL_TILES = {
      state: "partial",
      title: "3D tiles partially unavailable",
      message:
        "Several photorealistic tiles failed to load. Replay can continue with gaps.",
    };
    const PARTIAL_BLANK = {
      state: "partial",
      title: "3D tiles partially unavailable",
      message:
        "The 3D scene is not rendering fully. Replay can continue in Atlas instead.",
    };
    const GEOMETRY = {
      state: "unavailable",
      title: "Route geometry unavailable",
      message: "This completed route does not contain enough points to replay.",
    };
    const WEBGL = {
      state: "unavailable",
      title: "WebGL unavailable",
      message: "This browser cannot start the photorealistic replay.",
    };
    const CREDENTIALS = {
      state: "unavailable",
      title: "Map tiles unavailable",
      message: "A Google Map Tiles browser key is required for Earth Replay.",
    };
    const PROVIDER = {
      state: "unavailable",
      title: "Photorealistic world unavailable",
      message: "Google 3D tiles could not load for this route.",
    };
    const payloads = (onStatus: Mock) =>
      onStatus.mock.calls.map(([status]) => status);
    function remount(engine: CesiumReplayEngine, selectedRoute = route) {
      const onStatus = vi.fn();
      const mounted = engine.mount({
        container: {} as HTMLElement,
        route: selectedRoute,
        onStatus,
      });
      return { onStatus, mounted };
    }

    it("successful load with loaded initial tiles", async () => {
      const h = start();
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });

    it("successful load after the initial tile deadline", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      await vi.advanceTimersByTimeAsync(8000);
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, READY_TIMEOUT]);
      h.engine.destroy();
    });

    it("partial fidelity from tile failures during load", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      for (let i = 0; i < 9; i++) provider.tilesets[0].tileFailed.raise();
      provider.tilesets[0].allTilesLoaded.raise();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING, PARTIAL_TILES]);
      h.engine.destroy();
    });

    it("partial fidelity from tile failures after ready", async () => {
      const h = start();
      await h.mounted;
      for (let i = 0; i < 9; i++) provider.tilesets[0].tileFailed.raise();
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([
        LOADING,
        READY_LOADED,
        PARTIAL_TILES,
      ]);
      h.engine.destroy();
    });

    it("partial fidelity from blank frames after ready", async () => {
      const h = start();
      await h.mounted;
      provider.blank = true;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([
        LOADING,
        READY_LOADED,
        PARTIAL_BLANK,
      ]);
      h.engine.destroy();
    });

    it("rejects insufficient geometry", async () => {
      const engine = new CesiumReplayEngine();
      const h = remount(engine, {
        ...route,
        route: route.route.slice(0, 1),
      } as QuestRoute);
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, GEOMETRY]);
      expect(provider.viewers).toHaveLength(0);
      engine.destroy();
    });

    it("rejects missing geometry", async () => {
      const engine = new CesiumReplayEngine();
      const h = remount(engine, { ...route, route: [] } as unknown as QuestRoute);
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, GEOMETRY]);
      expect(provider.viewers).toHaveLength(0);
      engine.destroy();
    });

    it("rejects a browser without WebGL", async () => {
      vi.stubGlobal("document", {
        createElement: () => ({ getContext: () => null }),
      });
      const h = start();
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, WEBGL]);
      expect(provider.viewers).toHaveLength(0);
    });

    it("rejects missing credentials", async () => {
      vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
      const h = start();
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, CREDENTIALS]);
    });

    it("reports provider failure", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      provider.reject = true;
      const h = start();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING, PROVIDER]);
    });

    it("reports provider failure after partial fidelity was announced", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      provider.holdZoom = true;
      const h = start();
      await flush();
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      provider.heldZooms[0].reject();
      await h.mounted;
      provider.tilesets[0].tileFailed.raise();
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING, PARTIAL_TILES, PROVIDER]);
      expect(provider.viewers[0].destroy).toHaveBeenCalledOnce();
    });

    it.each(["resolves", "rejects"] as const)(
      "destroy before the tileset %s publishes nothing further",
      async (outcome) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        provider.holdTileset = true;
        const h = start();
        await flush();
        h.engine.destroy();
        provider.heldTilesets[0][outcome === "resolves" ? "resolve" : "reject"]();
        await h.mounted;
        await vi.advanceTimersByTimeAsync(32000);
        expect(payloads(h.onStatus)).toEqual([LOADING]);
        expect(console.warn).not.toHaveBeenCalled();
      },
    );

    it("destroy during the initial tile wait publishes nothing further", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      h.engine.destroy();
      provider.tilesets[0].allTilesLoaded.raise();
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
    });

    it("destroy after ready publishes nothing further", async () => {
      const h = start();
      await h.mounted;
      h.engine.destroy();
      provider.blank = true;
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING, READY_LOADED]);
    });

    it("a remount after destroy drops the retired run's late tileset", async () => {
      provider.holdTileset = true;
      const h = start();
      await flush();
      h.engine.destroy();
      provider.holdTileset = false;
      const next = remount(h.engine);
      await next.mounted;
      provider.heldTilesets[0].resolve();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      expect(provider.tilesets).toHaveLength(2);
      // The replacement run's tileset resolved first; the retired one never attaches.
      expect(provider.tilesets[0].tileFailed.count()).toBe(1);
      expect(provider.tilesets[1].tileFailed.count()).toBe(0);
      h.engine.destroy();
    });

    it("a remount after destroy drops the retired run's tile outcomes", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      h.engine.destroy();
      provider.loaded = true;
      const next = remount(h.engine);
      await next.mounted;
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      provider.tilesets[0].allTilesLoaded.raise();
      await h.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });

    it("a remount without destroy drops the replaced run's late tileset and disposes its viewer", async () => {
      provider.holdTileset = true;
      const h = start();
      await flush();
      provider.holdTileset = false;
      const next = remount(h.engine);
      await next.mounted;
      provider.heldTilesets[0].resolve();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      expect(provider.viewers[0].destroy).toHaveBeenCalledOnce();
      expect(provider.viewers[1].destroy).not.toHaveBeenCalled();
      h.engine.destroy();
      expect(provider.viewers[1].destroy).toHaveBeenCalledOnce();
    });

    it("a remount without destroy drops the replaced run's tile outcomes", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      provider.loaded = true;
      const next = remount(h.engine);
      await next.mounted;
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      provider.tilesets[0].allTilesLoaded.raise();
      await h.mounted;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });

    it("partial fidelity stays sticky through a remount without destroy", async () => {
      provider.loaded = false;
      const h = start();
      await flush();
      for (let i = 0; i < 8; i++) provider.tilesets[0].tileFailed.raise();
      provider.loaded = true;
      const next = remount(h.engine);
      await next.mounted;
      for (let i = 0; i < 8; i++) provider.tilesets[1].tileFailed.raise();
      provider.blank = true;
      await vi.advanceTimersByTimeAsync(32000);
      expect(payloads(h.onStatus)).toEqual([LOADING, PARTIAL_TILES]);
      expect(payloads(next.onStatus)).toEqual([LOADING]);
      h.engine.destroy();
    });

    it("a remount without destroy after rejected inputs loads normally", async () => {
      vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
      const h = start();
      await h.mounted;
      vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "fixture-key");
      const next = remount(h.engine);
      await next.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, CREDENTIALS]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });

    it("a remount without destroy after provider failure loads normally", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      provider.reject = true;
      const h = start();
      await h.mounted;
      provider.reject = false;
      const next = remount(h.engine);
      await next.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, PROVIDER]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });

    it("a remount without destroy after ready announces loading then ready", async () => {
      const h = start();
      await h.mounted;
      const next = remount(h.engine);
      await next.mounted;
      expect(payloads(h.onStatus)).toEqual([LOADING, READY_LOADED]);
      expect(payloads(next.onStatus)).toEqual([LOADING, READY_LOADED]);
      h.engine.destroy();
    });
  });
});
