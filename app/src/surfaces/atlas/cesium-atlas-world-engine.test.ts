import { afterEach, describe, expect, it, vi } from "vitest";
import { Cartesian3 } from "cesium";

import {
  CesiumAtlasWorldEngine,
  guardAtlasCameraRotation,
  routeForPickedEntity,
} from "@/surfaces/atlas/cesium-atlas-world-engine";
import { completedRoutes } from "@/data/routes";

describe("CesiumAtlasWorldEngine", () => {
  afterEach(() => vi.useRealTimers());

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
