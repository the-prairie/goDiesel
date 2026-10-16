import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cesium3DTileset, Event } from "cesium";

import { routeRegions } from "@/data/route-regions";
import { CesiumAtlasWorldEngine } from "@/surfaces/atlas/cesium-atlas-world-engine";

const kyoto = routeRegions.find((region) => region.name === "Kyoto, Japan")!;
const crete = routeRegions.find((region) => region.name === "Crete, Greece")!;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness() {
  let cameraComplete = () => {};
  let cameraCancel = () => {};
  let blank = false;
  const tileset = {
    tilesLoaded: false,
    allTilesLoaded: new Event(),
    tileFailed: new Event(),
    destroy: vi.fn(),
  };
  const tileRequests: Array<(value: typeof tileset) => void> = [];
  vi.spyOn(Cesium3DTileset, "fromUrl").mockImplementation(() =>
    new Promise((resolve) => tileRequests.push((value) => resolve(value as unknown as Cesium3DTileset))),
  );
  const onStatus = vi.fn();
  const viewer = {
    canvas: { dataset: {} as Record<string, string>, clientWidth: 1280, clientHeight: 720,
      width: 1280, height: 720, getContext: () => ({ RGBA: 1, UNSIGNED_BYTE: 1,
        readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, pixels: Uint8Array) => pixels.fill(blank ? 0 : 255),
      }) },
    isDestroyed: () => false,
    destroy: vi.fn(),
    bottomContainer: { setAttribute: vi.fn() },
    useDefaultRenderLoop: true,
    scene: { globe: { show: true }, primitives: { add: vi.fn(), remove: vi.fn() } },
    camera: { frustum: {}, flyTo: vi.fn(), flyToBoundingSphere: vi.fn((_sphere, options) => {
      cameraComplete = options.complete;
      cameraCancel = options.cancel;
    }) },
  };
  const engine = new CesiumAtlasWorldEngine();
  Object.assign(engine, { viewer, onStatus });
  return { engine, viewer, onStatus, tileset, tileRequests,
    finishCamera: () => cameraComplete(), cancelCamera: () => cameraCancel(),
    setBlank: (value: boolean) => { blank = value; },
  };
}

describe("Atlas regional transition contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), setInterval, clearInterval });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["camera", "terrain"])("waits for both actors when %s finishes first", async (first) => {
    const h = harness();
    h.engine.setSelectedRegion(kyoto);
    expect(h.onStatus).toHaveBeenLastCalledWith({ state: "region-loading", regionName: kyoto.name, message: `Loading ${kyoto.name} terrain` });
    h.tileRequests[0](h.tileset);
    await flush();
    if (first === "camera") h.finishCamera(); else h.tileset.allTilesLoaded.raiseEvent();
    await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-loading");
    if (first === "camera") h.tileset.allTilesLoaded.raiseEvent(); else h.finishCamera();
    await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-ready");
    expect(h.viewer.scene.globe.show).toBe(false);
    h.engine.destroy();
  });

  it("treats camera cancellation as settlement and still waits for terrain", async () => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    h.cancelCamera(); h.tileRequests[0](h.tileset); await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-loading");
    h.tileset.allTilesLoaded.raiseEvent(); await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-ready");
    h.engine.destroy();
  });

  it("waits for camera settlement before missing-key fallback", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    expect(h.tileRequests).toHaveLength(0);
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-loading");
    h.cancelCamera(); await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    h.engine.destroy();
  });

  it("falls back on provider construction failure without waiting for the camera", async () => {
    const h = harness();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(Cesium3DTileset.fromUrl).mockRejectedValueOnce(new Error("Provider unavailable"));
    h.engine.setSelectedRegion(kyoto);
    await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    expect(h.viewer.useDefaultRenderLoop).toBe(false);
    h.finishCamera(); await flush();
    expect(h.onStatus.mock.calls.filter(([status]) => status.state === "region-fallback")).toHaveLength(1);
    h.engine.destroy();
  });

  it("falls back immediately when route geometry is absent", () => {
    const h = harness(); h.engine.setSelectedRegion({ ...kyoto, routes: [] });
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    expect(h.viewer.camera.flyToBoundingSphere).not.toHaveBeenCalled();
    h.engine.destroy();
  });

  it("waits for the camera after terrain times out and cannot revive from late tiles", async () => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    h.tileRequests[0](h.tileset); await flush();
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-loading");
    h.finishCamera(); await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    h.tileset.allTilesLoaded.raiseEvent(); await flush();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    h.engine.destroy();
  });

  it("falls back on the eighth recent tile failure and removes pending readiness", async () => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    h.tileRequests[0](h.tileset); await flush();
    for (let i = 0; i < 7; i++) h.tileset.tileFailed.raiseEvent();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-loading");
    h.tileset.tileFailed.raiseEvent();
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    expect(h.tileset.allTilesLoaded.numberOfListeners).toBe(0);
    h.finishCamera(); await flush();
    expect(h.onStatus.mock.calls.filter(([status]) => status.state === "region-ready")).toHaveLength(0);
    h.engine.destroy();
  });

  it("requires two consecutive blank diagnostics after readiness", async () => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    h.tileset.tilesLoaded = true; h.tileRequests[0](h.tileset); h.finishCamera(); await flush();
    h.setBlank(true); await vi.advanceTimersByTimeAsync(4000);
    h.setBlank(false); await vi.advanceTimersByTimeAsync(4000);
    h.setBlank(true); await vi.advanceTimersByTimeAsync(4000);
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-ready");
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.viewer.canvas.dataset.atlasState).toBe("region-fallback");
    h.engine.destroy();
  });

  it.each(["replace", "clear", "destroy"])("discards late construction after %s", async (action) => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    if (action === "replace") h.engine.setSelectedRegion(crete);
    if (action === "clear") h.engine.setSelectedRegion();
    if (action === "destroy") h.engine.destroy();
    const count = h.onStatus.mock.calls.length;
    h.tileRequests[0](h.tileset); await flush();
    expect(h.tileset.destroy).toHaveBeenCalledOnce();
    expect(h.viewer.scene.primitives.add).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenCalledTimes(count);
    h.engine.destroy();
  });

  it("reselects the same region as a fresh operation and disposes pending listeners", async () => {
    const h = harness(); h.engine.setSelectedRegion(kyoto);
    h.tileRequests[0](h.tileset); await flush();
    h.engine.setSelectedRegion();
    expect(h.tileset.allTilesLoaded.numberOfListeners).toBe(0);
    expect(h.tileset.tileFailed.numberOfListeners).toBe(0);
    expect(h.viewer.canvas.dataset.atlasState).toBe("global");
    h.engine.setSelectedRegion(kyoto);
    expect(h.tileRequests).toHaveLength(2);
    h.engine.destroy(); h.tileRequests[1](h.tileset); await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});
