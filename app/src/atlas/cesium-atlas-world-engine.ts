import {
  buildModuleUrl,
  Cartesian3,
  Math as CesiumMath,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  HeadingPitchRoll,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  TileMapServiceImageryProvider,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  sampleGlobalRoutePoints,
  type AtlasRegionProjection,
  type AtlasWorldEngine,
  type AtlasWorldEngineMountOptions,
} from "@/components/globe/atlas-world";
import type { RouteRegion } from "@/data/route-regions";

const DEFAULT_VIEW = { lat: 24, lng: 12, heightM: 18_500_000 };
const GLOBAL_SELECTION_HEIGHT_M = DEFAULT_VIEW.heightM;
const ROUTE_COLOR = Color.fromCssColorString("#62a7ff");
const SELECTED_ROUTE_COLOR = Color.fromCssColorString("#df674b");

interface RegionRouteEntity {
  regionName: string;
  entity: Entity;
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
  private generation = 0;
  private surfaceNormal = new Cartesian3();
  private surfaceToCamera = new Cartesian3();

  async mount({ container, regions, onStatus }: AtlasWorldEngineMountOptions) {
    const generation = ++this.generation;
    this.regions = regions;
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
      viewer.scene.globe.show = true;
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

      const imagery = await TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl("Assets/Textures/NaturalEarthII"),
      );
      if (generation !== this.generation) return;
      viewer.imageryLayers.addImageryProvider(imagery);

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
              clampToGround: true,
              material: new PolylineGlowMaterialProperty({
                color: ROUTE_COLOR.withAlpha(0.92),
                glowPower: 0.16,
              }),
            },
          });
          return [{ regionName: region.name, entity }];
        }),
      );

      this.installKeyboardControls(viewer);
      this.removeCameraChangedListener = viewer.camera.changed.addEventListener(() => {
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
      viewer.canvas.dataset.cameraRegion = "";
      this.resetView();
      return;
    }
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        region.centerLng,
        region.centerLat,
        GLOBAL_SELECTION_HEIGHT_M,
      ),
      orientation: new HeadingPitchRoll(0, -CesiumMath.PI_OVER_TWO, 0),
      duration: 0.75,
    });
    viewer.canvas.dataset.cameraRegion = region.name;
    viewer.canvas.dataset.cameraTarget = GLOBAL_SELECTION_HEIGHT_M.toFixed(0);
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
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        DEFAULT_VIEW.lng,
        DEFAULT_VIEW.lat,
        DEFAULT_VIEW.heightM,
      ),
      orientation: new HeadingPitchRoll(0, -CesiumMath.PI_OVER_TWO, 0),
      duration: 0.6,
    });
    viewer.canvas.dataset.cameraTarget = DEFAULT_VIEW.heightM.toFixed(0);
  }

  destroy() {
    this.generation += 1;
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
