import { afterEach, describe, expect, it, vi } from "vitest";
import { Cartesian3, JulianDate } from "cesium";

import {
  CesiumAtlasWorldEngine,
  configureAtlasIllumination,
  routeForPickedEntity,
} from "@/surfaces/atlas/cesium-atlas-world-engine";
import { completedRoutes } from "@/data/routes";

describe("CesiumAtlasWorldEngine", () => {
  afterEach(() => vi.useRealTimers());

  it("freezes fixture illumination without changing production time", () => {
    const fixtureTime = "2026-03-20T12:00:00Z";
    const fixture = {
      canvas: { dataset: {} },
      clock: { currentTime: JulianDate.now(), shouldAnimate: true },
    };
    configureAtlasIllumination(fixture as never, fixtureTime);

    expect(fixture.canvas.dataset).toEqual({ illuminationTime: fixtureTime });
    expect(fixture.clock.shouldAnimate).toBe(false);
    expect(
      JulianDate.equals(
        fixture.clock.currentTime,
        JulianDate.fromIso8601(fixtureTime),
      ),
    ).toBe(true);

    const productionTime = JulianDate.now();
    const production = {
      canvas: { dataset: {} },
      clock: { currentTime: productionTime, shouldAnimate: true },
    };
    configureAtlasIllumination(production as never);

    expect(production.canvas.dataset).toEqual({ illuminationTime: "system" });
    expect(production.clock.currentTime).toBe(productionTime);
    expect(production.clock.shouldAnimate).toBe(true);
  });

  it("releases Cesium listeners, keyboard input, and the viewer", () => {
    const removeRenderErrorListener = vi.fn();
    const removeCameraChangedListener = vi.fn();
    const removeEventListener = vi.fn();
    const destroyViewer = vi.fn();
    const keyDownHandler = vi.fn();
    const viewer = {
      canvas: { removeEventListener },
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
