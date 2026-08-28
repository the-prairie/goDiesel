import { afterEach, describe, expect, it, vi } from "vitest";
import { Cartesian3 } from "cesium";

import {
  CesiumAtlasWorldEngine,
  globalPositionsForRoute,
  routeForPickedEntity,
  sharedGlobalPositionSets,
} from "@/surfaces/atlas/cesium-atlas-world-engine";
import { completedRoutes } from "@/data/routes";
import { buildRouteRegions, type RouteRegion } from "@/data/route-regions";

describe("CesiumAtlasWorldEngine", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("preserves exact global Cartesian values for batched geometry", () => {
    const source = completedRoutes[0];
    const route = { ...source, trace: source.trace.slice(0, 3) };
    const expected = route.trace.flatMap((point) => {
      const position = Cartesian3.fromDegrees(point.lng, point.lat);
      return [position.x, position.y, position.z];
    });

    expect(
      globalPositionsForRoute(route).flatMap((position) => [
        position.x,
        position.y,
        position.z,
      ]),
    ).toEqual(expected);
  });

  it("skips geometry-less routes before batched conversion", () => {
    const source = completedRoutes[0];

    expect(globalPositionsForRoute({ ...source, trace: [] })).toEqual([]);
  });

  it("shares identical geometry while retaining at most two glow passes", () => {
    const source = completedRoutes[0];
    const replica = {
      ...source,
      slug: `${source.slug}-replica`,
      trace: source.trace.map((point) => ({ ...point })),
    };
    const distinct = {
      ...source,
      slug: `${source.slug}-distinct`,
      trace: source.trace.map((point, index) =>
        index === 0 ? { ...point, lng: point.lng + 0.000001 } : { ...point },
      ),
    };

    const shared = sharedGlobalPositionSets([source, replica, replica]);

    expect(shared).toHaveLength(2);
    expect(shared[0]).toBe(shared[1]);
    expect(sharedGlobalPositionSets([source, distinct])).toHaveLength(2);
  });

  it("defers Entities to the selected region", () => {
    const region = buildRouteRegions(
      completedRoutes.filter((route) => route.region === completedRoutes[0].region),
    )[0];
    const oldEntity = { polyline: {} };
    const add = vi.fn(() => ({ polyline: {} }));
    const remove = vi.fn();
    const suspendEvents = vi.fn();
    const resumeEvents = vi.fn();
    const globalRoutePolylines = { show: true };
    const engine = new CesiumAtlasWorldEngine();
    Object.assign(engine, {
      viewer: {
        isDestroyed: () => false,
        entities: { add, remove, suspendEvents, resumeEvents },
      },
      globalRoutePolylines,
      routeEntities: [
        { regionName: "old", route: completedRoutes[0], entity: oldEntity },
      ],
    });
    const showRegionalRouteGeometry = Reflect.get(
      engine,
      "showRegionalRouteGeometry",
    ) as (region: RouteRegion) => void;

    showRegionalRouteGeometry.call(engine, region);

    expect(globalRoutePolylines.show).toBe(false);
    expect(remove).toHaveBeenCalledWith(oldEntity);
    expect(suspendEvents).toHaveBeenCalledOnce();
    expect(resumeEvents).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledTimes(region.routes.length);
    expect(
      (Reflect.get(engine, "routeEntities") as Array<{ regionName: string }>).every(
        (entry) => entry.regionName === region.name,
      ),
    ).toBe(true);
  });

  it("restores the global buffer when regional Entity creation fails", () => {
    const region = buildRouteRegions(
      completedRoutes.filter((route) => route.region === completedRoutes[0].region),
    )[0];
    const stagedEntity = { polyline: {} };
    const add = vi
      .fn()
      .mockReturnValueOnce(stagedEntity)
      .mockImplementationOnce(() => {
        throw new Error("entity add failed");
      });
    const remove = vi.fn();
    const globalRoutePolylines = { show: true };
    const engine = new CesiumAtlasWorldEngine();
    Object.assign(engine, {
      viewer: {
        isDestroyed: () => false,
        entities: {
          add,
          remove,
          suspendEvents: vi.fn(),
          resumeEvents: vi.fn(),
        },
      },
      globalRoutePolylines,
      routeEntities: [],
    });
    const showRegionalRouteGeometry = Reflect.get(
      engine,
      "showRegionalRouteGeometry",
    ) as (region: RouteRegion) => void;

    expect(() => showRegionalRouteGeometry.call(engine, region)).toThrow(
      "entity add failed",
    );
    expect(remove).toHaveBeenCalledWith(stagedEntity);
    expect(globalRoutePolylines.show).toBe(true);
    expect(Reflect.get(engine, "routeEntities")).toEqual([]);
  });
});
