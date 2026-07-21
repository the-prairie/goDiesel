import {
  BoundingSphere,
  buildModuleUrl,
  Cartesian3,
  Cesium3DTileset,
  ClassificationType,
  Math as CesiumMath,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  HeadingPitchRoll,
  HeadingPitchRange,
  ImageryLayer,
  PerspectiveFrustum,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  TileMapServiceImageryProvider,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  sampleRegionalRoutePoints,
  sampleGlobalRoutePoints,
  type AtlasRegionProjection,
  type AtlasWorldEngine,
  type AtlasWorldEngineMountOptions,
} from "@/components/globe/atlas-world";
import {
  atlasCameraFrame,
  atlasRegionTransitionDurationSeconds,
} from "@/atlas/atlas-region-camera";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { recordTileFailure, rgbaPixelsLookBlank } from "@/replay/replay-health";
import {
  CESIUM_GROUND_ROUTE_OPTIONS,
  GOOGLE_3D_TILES_RENDER_OPTIONS,
} from "@/replay/cesium/cesium-render-quality";

const DEFAULT_VIEW = { lat: 24, lng: 12, heightM: 18_500_000 };
const GLOBAL_SELECTION_HEIGHT_M = DEFAULT_VIEW.heightM;
const ROUTE_COLOR = Color.fromCssColorString("#62a7ff");
const SELECTED_ROUTE_COLOR = Color.fromCssColorString("#df674b");
const TILE_FAILURE_THRESHOLD = 8;
const TERRAIN_READY_TIMEOUT_MS = 8_000;
const TERRAIN_DIAGNOSTIC_INTERVAL_MS = 4_000;
const REGIONAL_CAMERA_PITCH_RADIANS = -1.02;

interface RegionRouteEntity {
  regionName: string;
  route: RouteSummary;
  entity: Entity;
}

function canvasLooksBlank(canvas: HTMLCanvasElement) {
  const gl =
    canvas.getContext("webgl2") ??
    (canvas.getContext("webgl") as WebGLRenderingContext | null);
  if (!gl || canvas.width < 16 || canvas.height < 16) return false;
  const blockSize = 8;
  const samples = [
    [0.2, 0.2],
    [0.5, 0.2],
    [0.8, 0.2],
    [0.2, 0.65],
    [0.5, 0.65],
    [0.8, 0.65],
  ];
  const sampleSize = blockSize * blockSize * 4;
  const pixels = new Uint8Array(sampleSize * samples.length);
  try {
    samples.forEach(([xRatio, yRatio], sampleIndex) => {
      const x = Math.floor((canvas.width - blockSize) * xRatio);
      const y = Math.floor((canvas.height - blockSize) * yRatio);
      gl.readPixels(
        x,
        y,
        blockSize,
        blockSize,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels.subarray(sampleIndex * sampleSize, (sampleIndex + 1) * sampleSize),
      );
    });
  } catch {
    return false;
  }
  return rgbaPixelsLookBlank(pixels);
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export class CesiumAtlasWorldEngine implements AtlasWorldEngine {
  private viewer?: Viewer;
  private regions: RouteRegion[] = [];
  private routeEntities: RegionRouteEntity[] = [];
  private removeRenderErrorListener?: () => void;
  private removeCameraChangedListener?: () => void;
  private keyDownHandler?: (event: KeyboardEvent) => void;
  private onStatus?: AtlasWorldEngineMountOptions["onStatus"];
  private tileset?: Cesium3DTileset;
  private baseImageryLayer?: ImageryLayer;
  private removeTerrainFailureListener?: () => void;
  private cancelTerrainWait?: () => void;
  private terrainDiagnosticsTimer?: number;
  private terrainFailureTimes: number[] = [];
  private blankFrameCount = 0;
  private selectedRegionName?: string;
  private regionGeneration = 0;
  private generation = 0;
  private surfaceNormal = new Cartesian3();
  private surfaceToCamera = new Cartesian3();

  async mount({ container, regions, onStatus }: AtlasWorldEngineMountOptions) {
    const generation = ++this.generation;
    this.regions = regions;
    this.onStatus = onStatus;
    onStatus({ state: "loading", message: "Opening the Atlas world." });

    if (!webglAvailable()) {
      onStatus({
        state: "unavailable",
        message: "This browser cannot start the Cesium world.",
      });
      return;
    }

    try {
      const viewer = new Viewer(container, {
        animation: false,
        baseLayer: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        requestRenderMode: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      this.viewer = viewer;
      viewer.camera.percentageChanged = 0.001;
      viewer.scene.backgroundColor = Color.fromCssColorString("#28443a");
      viewer.scene.globe.show = true;
      viewer.scene.globe.baseColor = Color.fromCssColorString("#28443a");
      viewer.scene.globe.enableLighting = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      viewer.canvas.setAttribute("aria-label", "Interactive route globe");
      viewer.canvas.setAttribute(
        "aria-keyshortcuts",
        "ArrowLeft ArrowRight ArrowUp ArrowDown + -",
      );
      viewer.canvas.classList.add(
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-inset",
        "focus-visible:ring-[#f6f2e8]",
      );
      viewer.canvas.tabIndex = 0;
      viewer.canvas.dataset.atlasEngine = "cesium";
      viewer.canvas.dataset.heatLines = String(
        regions.reduce((count, region) => count + region.routes.length, 0),
      );
      viewer.canvas.dataset.routePalette = "cobalt";
      viewer.canvas.dataset.atlasState = "global";
      viewer.canvas.dataset.cameraState = "settled";
      viewer.canvas.dataset.terrainState = "global";
      viewer.canvas.dataset.regionRouteCount = "0";
      viewer.canvas.dataset.regionCameraRange = "";
      viewer.canvas.dataset.regionSphereRadius = "";
      viewer.canvas.dataset.regionCameraPitch = "";

      const imagery = await TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl("Assets/Textures/NaturalEarthII"),
      );
      if (generation !== this.generation) return;
      this.baseImageryLayer = viewer.imageryLayers.addImageryProvider(imagery);

      this.routeEntities = regions.flatMap((region) =>
        region.routes.flatMap((route) => {
          const points = sampleGlobalRoutePoints(route);
          if (points.length < 2) return [];
          const entity = viewer.entities.add({
            name: `${route.name} route thread`,
            polyline: {
              positions: points.map((point) =>
                Cartesian3.fromDegrees(point.lng, point.lat),
              ),
              width: 4,
              ...CESIUM_GROUND_ROUTE_OPTIONS,
              classificationType: ClassificationType.BOTH,
              material: new PolylineGlowMaterialProperty({
                color: ROUTE_COLOR.withAlpha(0.92),
                glowPower: 0.16,
              }),
            },
          });
          return [{ regionName: region.name, route, entity }];
        }),
      );

      this.installKeyboardControls(viewer);
      this.removeCameraChangedListener = viewer.camera.changed.addEventListener(() => {
        viewer.canvas.dataset.cameraHeight =
          viewer.camera.positionCartographic.height.toFixed(0);
        viewer.canvas.dataset.cameraTarget =
          viewer.camera.positionCartographic.height.toFixed(0);
      });
      this.removeRenderErrorListener = viewer.scene.renderError.addEventListener(() => {
        onStatus({
          state: "unavailable",
          message: "The Cesium world stopped rendering.",
        });
      });
      this.resetView();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (generation !== this.generation) return;
      onStatus({ state: "ready", message: "Atlas world ready." });
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn("Cesium Atlas unavailable", error);
      onStatus({
        state: "unavailable",
        message: "The Cesium world could not load.",
      });
    }
  }

  setSelectedRegion(region?: RouteRegion) {
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    const regionGeneration = ++this.regionGeneration;
    this.selectedRegionName = region?.name;
    this.routeEntities.forEach(({ regionName, entity }) => {
      if (!entity.polyline) return;
      const selected = regionName === region?.name;
      entity.polyline.width = new ConstantProperty(selected ? 6 : 4);
      entity.polyline.material = selected
        ? new PolylineGlowMaterialProperty({
            color: SELECTED_ROUTE_COLOR.withAlpha(0.98),
            glowPower: 0.2,
          })
        : new ColorMaterialProperty(ROUTE_COLOR.withAlpha(region ? 0.32 : 0.92));
    });
    if (!region) {
      this.leaveRegionalTerrain();
      viewer.canvas.dataset.cameraRegion = "";
      viewer.canvas.dataset.atlasState = "global";
      viewer.canvas.dataset.cameraState = "settled";
      viewer.canvas.dataset.terrainState = "global";
      viewer.canvas.dataset.regionRouteCount = "0";
      viewer.canvas.dataset.cameraDurationMs = "600";
      this.restoreGlobalRouteGeometry();
      this.resetView();
      this.onStatus?.({ state: "ready", message: "Atlas world ready." });
      return;
    }
    viewer.canvas.dataset.cameraRegion = region.name;
    void this.enterRegionalTerrain(region, regionGeneration);
  }

  projectRegions(): AtlasRegionProjection[] {
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return [];
    return this.regions.map((region) => {
      const position = Cartesian3.fromDegrees(region.centerLng, region.centerLat);
      const projected = SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        position,
      );
      return {
        name: region.name,
        x: projected?.x ?? 0,
        y: projected?.y ?? 0,
        visible: Boolean(
          projected &&
            Cartesian3.dot(
              Cartesian3.normalize(position, this.surfaceNormal),
              Cartesian3.normalize(
                Cartesian3.subtract(
                  viewer.camera.positionWC,
                  position,
                  this.surfaceToCamera,
                ),
                this.surfaceToCamera,
              ),
            ) > 0,
        ),
      };
    });
  }

  zoomIn() {
    this.zoomBy(0.72);
  }

  zoomOut() {
    this.zoomBy(1.35);
  }

  resetView() {
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? atlasRegionTransitionDurationSeconds(true)
      : 0.6;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        DEFAULT_VIEW.lng,
        DEFAULT_VIEW.lat,
        DEFAULT_VIEW.heightM,
      ),
      orientation: new HeadingPitchRoll(0, -CesiumMath.PI_OVER_TWO, 0),
      duration,
    });
    this.resetFrustumOffsets();
    viewer.canvas.dataset.cameraDurationMs = String(Math.round(duration * 1_000));
    viewer.canvas.dataset.cameraTarget = DEFAULT_VIEW.heightM.toFixed(0);
  }

  destroy() {
    this.generation += 1;
    this.regionGeneration += 1;
    this.leaveRegionalTerrain();
    this.removeRenderErrorListener?.();
    this.removeCameraChangedListener?.();
    if (this.viewer && this.keyDownHandler) {
      this.viewer.canvas.removeEventListener("keydown", this.keyDownHandler);
    }
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
    this.regions = [];
    this.routeEntities = [];
    this.removeRenderErrorListener = undefined;
    this.removeCameraChangedListener = undefined;
    this.keyDownHandler = undefined;
    this.onStatus = undefined;
    this.selectedRegionName = undefined;
  }

  private async enterRegionalTerrain(
    region: RouteRegion,
    regionGeneration: number,
  ) {
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    this.leaveRegionalTerrain();
    viewer.useDefaultRenderLoop = true;
    viewer.scene.globe.show = true;
    if (this.baseImageryLayer) this.baseImageryLayer.show = false;
    viewer.canvas.dataset.atlasState = "region-loading";
    viewer.canvas.dataset.cameraState = "transitioning";
    viewer.canvas.dataset.terrainState = "loading";
    viewer.canvas.dataset.regionRouteCount = String(region.routes.length);
    this.onStatus?.({
      state: "region-loading",
      regionName: region.name,
      message: `Loading ${region.name} terrain`,
    });
    try {
      this.showRegionalRouteGeometry(region);
      const routePositions = region.routes.flatMap((route) =>
        sampleRegionalRoutePoints(route).map((point) =>
          Cartesian3.fromDegrees(
            point.lng,
            point.lat,
            Number.isFinite(point.elev) ? Math.max(0, point.elev) : 0,
          ),
        ),
      );
      if (routePositions.length < 2) {
        this.reportRegionalFallback(region, regionGeneration);
        return;
      }

      const sphere = BoundingSphere.fromPoints(routePositions);
      const frustum = viewer.camera.frustum;
      const verticalFov =
        frustum instanceof PerspectiveFrustum
          ? (frustum.fovy ?? CesiumMath.toRadians(60))
          : CesiumMath.toRadians(60);
      const viewport = {
        width: Math.max(1, viewer.canvas.clientWidth),
        height: Math.max(1, viewer.canvas.clientHeight),
      };
      const frame = atlasCameraFrame(sphere.radius, viewport, verticalFov);
      this.applyFrustumOffsets(frame.horizontalOffsetRatio, frame.verticalOffsetRatio);
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const duration = atlasRegionTransitionDurationSeconds(reducedMotion);
      viewer.canvas.dataset.cameraDurationMs = String(Math.round(duration * 1_000));
      viewer.canvas.dataset.cameraTarget = frame.rangeM.toFixed(0);
      viewer.canvas.dataset.regionCameraRange = frame.rangeM.toFixed(0);
      viewer.canvas.dataset.regionSphereRadius = sphere.radius.toFixed(0);
      viewer.canvas.dataset.regionCameraPitch =
        REGIONAL_CAMERA_PITCH_RADIANS.toFixed(2);

      const cameraReady = new Promise<void>((resolve) => {
        viewer.camera.flyToBoundingSphere(sphere, {
          duration,
          offset: new HeadingPitchRange(
            0,
            REGIONAL_CAMERA_PITCH_RADIANS,
            frame.rangeM,
          ),
          complete: resolve,
          cancel: resolve,
        });
      });

      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
      if (!apiKey) {
        await cameraReady;
        this.reportRegionalFallback(region, regionGeneration);
        return;
      }

      const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`;
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
        ...GOOGLE_3D_TILES_RENDER_OPTIONS,
        enableCollision: true,
      });
      if (!this.regionIsCurrent(region, regionGeneration)) {
        tileset.destroy();
        return;
      }
      this.tileset = tileset;
      viewer.scene.primitives.add(tileset);
      this.removeTerrainFailureListener = tileset.tileFailed.addEventListener(() => {
        this.terrainFailureTimes = recordTileFailure(
          this.terrainFailureTimes,
          performance.now(),
        );
        if (this.terrainFailureTimes.length >= TILE_FAILURE_THRESHOLD) {
          this.reportRegionalFallback(region, regionGeneration);
        }
      });
      const [, terrainReady] = await Promise.all([
        cameraReady,
        this.waitForUsefulTerrain(tileset),
      ]);
      if (!this.regionIsCurrent(region, regionGeneration)) return;
      if (!terrainReady) {
        this.reportRegionalFallback(region, regionGeneration);
        return;
      }
      viewer.scene.globe.show = true;
      viewer.canvas.dataset.atlasState = "region-ready";
      viewer.canvas.dataset.cameraState = "settled";
      viewer.canvas.dataset.terrainState = "ready";
      this.onStatus?.({
        state: "region-ready",
        regionName: region.name,
        message: `${region.name} terrain ready.`,
      });
      this.startTerrainDiagnostics(region, regionGeneration);
    } catch (error) {
      if (!this.regionIsCurrent(region, regionGeneration)) return;
      console.warn("Regional terrain unavailable", error);
      this.reportRegionalFallback(region, regionGeneration);
    }
  }

  private showRegionalRouteGeometry(region: RouteRegion) {
    this.routeEntities.forEach(({ regionName, route, entity }) => {
      entity.show = regionName === region.name;
      if (!entity.polyline || regionName !== region.name) return;
      entity.polyline.positions = new ConstantProperty(
        sampleRegionalRoutePoints(route).map((point) =>
          Cartesian3.fromDegrees(point.lng, point.lat),
        ),
      );
    });
  }

  private restoreGlobalRouteGeometry() {
    this.routeEntities.forEach(({ route, entity }) => {
      entity.show = true;
      if (!entity.polyline) return;
      entity.polyline.positions = new ConstantProperty(
        sampleGlobalRoutePoints(route).map((point) =>
          Cartesian3.fromDegrees(point.lng, point.lat),
        ),
      );
    });
  }

  private waitForUsefulTerrain(tileset: Cesium3DTileset) {
    if (tileset.tilesLoaded) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let removeLoaded: (() => void) | undefined;
      let cancelWait: (() => void) | undefined;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        removeLoaded?.();
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
        if (this.cancelTerrainWait === cancelWait) this.cancelTerrainWait = undefined;
        resolve(ready);
      };
      removeLoaded = tileset.allTilesLoaded.addEventListener(() => finish(true));
      timeout = globalThis.setTimeout(
        () => finish(false),
        TERRAIN_READY_TIMEOUT_MS,
      );
      cancelWait = () => finish(false);
      this.cancelTerrainWait = cancelWait;
    });
  }

  private startTerrainDiagnostics(
    region: RouteRegion,
    regionGeneration: number,
  ) {
    this.terrainDiagnosticsTimer = window.setInterval(() => {
      if (!this.regionIsCurrent(region, regionGeneration)) return;
      const canvas = this.viewer?.canvas;
      if (!canvas) return;
      this.blankFrameCount = canvasLooksBlank(canvas)
        ? this.blankFrameCount + 1
        : 0;
      if (this.blankFrameCount >= 2) {
        this.reportRegionalFallback(region, regionGeneration);
      }
    }, TERRAIN_DIAGNOSTIC_INTERVAL_MS);
  }

  private reportRegionalFallback(
    region: RouteRegion,
    regionGeneration: number,
  ) {
    if (!this.regionIsCurrent(region, regionGeneration)) return;
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    this.regionGeneration += 1;
    this.clearRegionalTiles();
    viewer.useDefaultRenderLoop = false;
    viewer.canvas.dataset.atlasState = "region-fallback";
    viewer.canvas.dataset.cameraState = "settled";
    viewer.canvas.dataset.terrainState = "fallback";
    this.onStatus?.({
      state: "region-fallback",
      regionName: region.name,
      message: "3D terrain partially unavailable",
    });
  }

  private regionIsCurrent(region: RouteRegion, regionGeneration: number) {
    return (
      this.regionGeneration === regionGeneration &&
      this.selectedRegionName === region.name &&
      Boolean(this.viewer && !this.viewer.isDestroyed())
    );
  }

  private leaveRegionalTerrain() {
    this.clearRegionalTiles();
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.useDefaultRenderLoop = true;
    viewer.scene.globe.show = true;
    if (this.baseImageryLayer) this.baseImageryLayer.show = true;
    this.resetFrustumOffsets();
  }

  private clearRegionalTiles() {
    this.removeTerrainFailureListener?.();
    this.removeTerrainFailureListener = undefined;
    this.cancelTerrainWait?.();
    this.cancelTerrainWait = undefined;
    if (this.terrainDiagnosticsTimer !== undefined) {
      window.clearInterval(this.terrainDiagnosticsTimer);
    }
    this.terrainDiagnosticsTimer = undefined;
    const viewer = this.viewer;
    if (viewer && !viewer.isDestroyed() && this.tileset) {
      viewer.scene.primitives.remove(this.tileset);
    }
    this.tileset = undefined;
    this.terrainFailureTimes = [];
    this.blankFrameCount = 0;
  }

  private applyFrustumOffsets(horizontalRatio: number, verticalRatio: number) {
    const frustum = this.viewer?.camera.frustum;
    if (!(frustum instanceof PerspectiveFrustum)) return;
    const verticalFov = frustum.fovy ?? CesiumMath.toRadians(60);
    const aspectRatio =
      frustum.aspectRatio ??
      Math.max(1, this.viewer?.canvas.clientWidth ?? 1) /
        Math.max(1, this.viewer?.canvas.clientHeight ?? 1);
    const verticalTangent = Math.tan(verticalFov / 2);
    const horizontalTangent = verticalTangent * aspectRatio;
    frustum.xOffset = horizontalRatio * frustum.near * horizontalTangent;
    frustum.yOffset = verticalRatio * frustum.near * verticalTangent;
  }

  private resetFrustumOffsets() {
    const frustum = this.viewer?.camera.frustum;
    if (!(frustum instanceof PerspectiveFrustum)) return;
    frustum.xOffset = 0;
    frustum.yOffset = 0;
  }

  private zoomBy(factor: number) {
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    const height = viewer.camera.positionCartographic.height;
    if (factor < 1) viewer.camera.zoomIn(height * (1 - factor));
    else viewer.camera.zoomOut(height * (factor - 1));
    viewer.canvas.dataset.cameraTarget = viewer.camera.positionCartographic.height.toFixed(0);
  }

  private installKeyboardControls(viewer: Viewer) {
    this.keyDownHandler = (event) => {
      const step = CesiumMath.toRadians(6);
      if (event.key === "ArrowLeft") viewer.camera.rotateLeft(step);
      else if (event.key === "ArrowRight") viewer.camera.rotateRight(step);
      else if (event.key === "ArrowUp") viewer.camera.rotateUp(step);
      else if (event.key === "ArrowDown") viewer.camera.rotateDown(step);
      else if (event.key === "+" || event.key === "=") this.zoomIn();
      else if (event.key === "-" || event.key === "_") this.zoomOut();
      else return;
      event.preventDefault();
    };
    viewer.canvas.addEventListener("keydown", this.keyDownHandler);
  }
}

export function createAtlasWorldEngine() {
  return (
    window.__GODIESEL_ATLAS_WORLD_FACTORY__?.() ??
    new CesiumAtlasWorldEngine()
  );
}
