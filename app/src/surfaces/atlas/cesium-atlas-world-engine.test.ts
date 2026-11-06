import { afterEach, describe, expect, it, vi } from "vitest";
import { Cartesian3 } from "cesium";

import {
  CesiumAtlasWorldEngine,
  guardAtlasCameraRotation,
  routeForPickedEntity,
} from "@/surfaces/atlas/cesium-atlas-world-engine";
import { completedRoutes } from "@/data/routes";

function globalViewer(
  canvas: { dataset: Record<string, string> },
  flyTo: ReturnType<typeof vi.fn>,
) {
  return {
    canvas,
    camera: { flyTo, frustum: {} },
    scene: { globe: { show: false }, primitives: { remove: vi.fn() } },
    bottomContainer: { setAttribute: vi.fn() },
    useDefaultRenderLoop: false,
    isDestroyed: () => false,
  };
}

describe("CesiumAtlasWorldEngine", () => {
  afterEach(() => {
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
      Object.assign(engine, { viewer });

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
      vi.stubGlobal("window", {
        clearInterval,
        matchMedia: () => ({ matches: false }),
      });
      let settleFlight: (() => void) | undefined;
      const onStatus = vi.fn();
      const canvas = { dataset: {} as Record<string, string> };
      const flyTo = vi.fn((options: { complete?: () => void; cancel?: () => void }) => {
        settleFlight = options[settleWith];
      });
      const engine = new CesiumAtlasWorldEngine();
      Object.assign(engine, {
        viewer: globalViewer(canvas, flyTo),
        onStatus,
      });

      engine.setSelectedRegion(undefined);

      expect(onStatus.mock.calls.map(([status]) => status.state)).toEqual(["loading"]);
      expect(canvas.dataset.cameraState).toBe("transitioning");

      settleFlight?.();
      await Promise.resolve();

      expect(onStatus.mock.calls.map(([status]) => status.state)).toEqual([
        "loading",
        "ready",
      ]);
      expect(canvas.dataset.cameraState).toBe("settled");
    },
  );

  it("settles the global camera immediately for reduced motion", async () => {
    vi.stubGlobal("window", {
      clearInterval,
      matchMedia: () => ({ matches: true }),
    });
    const onStatus = vi.fn();
    const canvas = { dataset: {} as Record<string, string> };
    const flyTo = vi.fn();
    const engine = new CesiumAtlasWorldEngine();
    Object.assign(engine, {
      viewer: globalViewer(canvas, flyTo),
      onStatus,
    });

    engine.setSelectedRegion(undefined);
    await Promise.resolve();

    expect(flyTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
    expect(onStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
    expect(canvas.dataset.cameraState).toBe("settled");
  });

  it("shares an active global camera flight with reset requests", async () => {
    vi.stubGlobal("window", {
      clearInterval,
      matchMedia: () => ({ matches: false }),
    });
    let settleFlight: (() => void) | undefined;
    const onStatus = vi.fn();
    const canvas = { dataset: {} as Record<string, string> };
    const flyTo = vi.fn((options: { complete?: () => void }) => {
      settleFlight = options.complete;
    });
    const engine = new CesiumAtlasWorldEngine();
    Object.assign(engine, {
      viewer: globalViewer(canvas, flyTo),
      onStatus,
    });

    engine.setSelectedRegion(undefined);
    engine.resetView();

    expect(flyTo).toHaveBeenCalledOnce();
    expect(onStatus.mock.calls.map(([status]) => status.state)).toEqual(["loading"]);

    settleFlight?.();
    await Promise.resolve();

    expect(onStatus.mock.calls.map(([status]) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
  });

  it("waits for the latest global camera generation", async () => {
    let resolveInitial!: () => void;
    let resolveReplacement!: () => void;
    const initialCameraReady = new Promise<void>((resolve) => {
      resolveInitial = resolve;
    });
    const replacementCameraReady = new Promise<void>((resolve) => {
      resolveReplacement = resolve;
    });
    const engine = new CesiumAtlasWorldEngine();
    Object.assign(engine, {
      viewer: { isDestroyed: () => false },
      globalCameraGeneration: 1,
      globalCameraReady: initialCameraReady,
    });
    const waitForSettlement = (
      engine as unknown as { waitForGlobalCameraSettlement: () => Promise<void> }
    ).waitForGlobalCameraSettlement();
    let settled = false;
    void waitForSettlement.then(() => {
      settled = true;
    });

    resolveInitial();
    Object.assign(engine, {
      globalCameraGeneration: 2,
      globalCameraReady: replacementCameraReady,
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    resolveReplacement();
    await waitForSettlement;

    expect(settled).toBe(true);
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
