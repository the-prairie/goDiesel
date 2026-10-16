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
      zoomTo = vi.fn().mockResolvedValue(undefined);
      destroy = vi.fn(() => {
        this.destroyed = true;
      });
      isDestroyed = () => this.destroyed;
      constructor() {
        provider.viewers.push(this);
      }
    },
    Cesium3DTileset: {
      fromUrl: vi.fn(async () => {
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
});
