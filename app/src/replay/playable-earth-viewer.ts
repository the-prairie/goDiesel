import type { QuestRoute } from "@/domain/routes";
import type { PlayableEarthPose } from "@/replay/playable-earth-controller";

export type PlayableEarthStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export interface PlayableEarthMountOptions {
  container: HTMLElement;
  route: QuestRoute;
  onStatus: (status: PlayableEarthStatus) => void;
}

export interface PlayableEarthViewer {
  mount(options: PlayableEarthMountOptions): Promise<void>;
  setPose(pose: PlayableEarthPose): void;
  destroy(): void;
}

type CesiumGlobal = Record<string, any>;

declare global {
  interface Window {
    Cesium?: CesiumGlobal;
    __GODIESEL_PLAYABLE_EARTH_FACTORY__?: () => PlayableEarthViewer;
  }
}

const CESIUM_VERSION = "1.120";
const AVATAR_VISUAL_OFFSET_M = 120;
const CAMERA_HEIGHT_M = 720;
const CAMERA_TRAILING_M = 720;
let cesiumPromise: Promise<CesiumGlobal | undefined> | undefined;

function loadCesium() {
  if (window.Cesium?.Viewer) return Promise.resolve(window.Cesium);
  if (cesiumPromise) return cesiumPromise;

  cesiumPromise = new Promise((resolve) => {
    const cssId = "goDieselCesiumCss";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css`;
      document.head.appendChild(link);
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-godiesel-cesium="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Cesium), { once: true });
      existing.addEventListener("error", () => resolve(undefined), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.godieselCesium = "true";
    script.src = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Cesium.js`;
    script.async = true;
    script.onload = () => resolve(window.Cesium?.Viewer ? window.Cesium : undefined);
    script.onerror = () => resolve(undefined);
    document.head.appendChild(script);
    window.setTimeout(
      () => resolve(window.Cesium?.Viewer ? window.Cesium : undefined),
      15_000,
    );
  });

  return cesiumPromise;
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class CesiumPlayableEarthViewer implements PlayableEarthViewer {
  private viewer?: any;
  private marker?: any;
  private cameraHeadingDeg?: number;
  private generation = 0;

  async mount({ container, route, onStatus }: PlayableEarthMountOptions) {
    const generation = ++this.generation;
    onStatus({
      state: "loading",
      title: "Building your route world",
      message: "Loading Cesium and photorealistic 3D tiles.",
    });

    if (route.route.length < 2) {
      onStatus({
        state: "unavailable",
        title: "Route geometry unavailable",
        message: "This route does not contain enough points for the lab.",
      });
      return;
    }
    if (!webglAvailable()) {
      onStatus({
        state: "unavailable",
        title: "WebGL unavailable",
        message: "This browser cannot start the playable 3D world.",
      });
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      onStatus({
        state: "unavailable",
        title: "Map tiles unavailable",
        message: "A Google Map Tiles browser key is required for this lab.",
      });
      return;
    }

    const Cesium = await loadCesium();
    if (generation !== this.generation) return;
    if (!Cesium?.Viewer) {
      onStatus({
        state: "unavailable",
        title: "Cesium unavailable",
        message: "The 3D engine could not load in this browser session.",
      });
      return;
    }

    try {
      Cesium.Ion.defaultAccessToken = "";
      const viewer = new Cesium.Viewer(container, {
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
        shouldAnimate: true,
        requestRenderMode: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
      this.viewer = viewer;
      viewer.scene.globe.show = false;
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

      const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`;
      const tilesetOptions = {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 24,
        dynamicScreenSpaceError: true,
        skipLevelOfDetail: true,
      };
      const tileset = Cesium.Cesium3DTileset.fromUrl
        ? await Cesium.Cesium3DTileset.fromUrl(tilesetUrl, tilesetOptions)
        : new Cesium.Cesium3DTileset({ url: tilesetUrl, ...tilesetOptions });
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);

      const positions = route.route.map((point) =>
        Cesium.Cartesian3.fromDegrees(
          point.lng,
          point.lat,
          (Number(point.elev) || 0) + AVATAR_VISUAL_OFFSET_M,
        ),
      );
      const routeEntity = viewer.entities.add({
        name: `${route.name} route thread`,
        polyline: {
          positions,
          width: 9,
          arcType: Cesium.ArcType.NONE,
          clampToGround: false,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString("#00f19f").withAlpha(0.98),
            glowPower: 0.18,
          }),
          depthFailMaterial: Cesium.Color.fromCssColorString("#00f19f").withAlpha(
            0.94,
          ),
        },
      });
      this.marker = viewer.entities.add({
        name: "Current route position",
        position: positions[0],
        point: {
          pixelSize: 16,
          color: Cesium.Color.fromCssColorString("#00f19f"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 4,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      await viewer.zoomTo(routeEntity, new Cesium.HeadingPitchRange(0, -0.72, 0));
      if (generation !== this.generation) return;

      onStatus({
        state: "ready",
        title: "Playable Earth ready",
        message: "Route thread and starting position are visible.",
      });
    } catch (error) {
      console.warn("Playable Earth Lab unavailable", error);
      if (generation !== this.generation) return;
      this.destroy();
      onStatus({
        state: "unavailable",
        title: "Photorealistic world unavailable",
        message: "Google 3D tiles could not load for this route.",
      });
    }
  }

  setPose(pose: PlayableEarthPose) {
    const Cesium = window.Cesium;
    if (!Cesium || !this.viewer || !this.marker || this.viewer.isDestroyed?.()) return;
    const markerPosition = Cesium.Cartesian3.fromDegrees(
      pose.lng,
      pose.lat,
      pose.elev + AVATAR_VISUAL_OFFSET_M,
    );
    this.marker.position = markerPosition;

    if (this.cameraHeadingDeg === undefined) {
      this.cameraHeadingDeg = pose.cameraHeadingDeg;
    } else {
      const delta =
        ((pose.cameraHeadingDeg - this.cameraHeadingDeg + 540) % 360) - 180;
      this.cameraHeadingDeg = (this.cameraHeadingDeg + delta * 0.08 + 360) % 360;
    }
    const heading = (this.cameraHeadingDeg * Math.PI) / 180;
    const cameraLat =
      pose.lat - (Math.cos(heading) * CAMERA_TRAILING_M) / 111_320;
    const cameraLng =
      pose.lng -
      (Math.sin(heading) * CAMERA_TRAILING_M) /
        (111_320 * Math.max(0.2, Math.cos((pose.lat * Math.PI) / 180)));
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        cameraLng,
        cameraLat,
        pose.elev + CAMERA_HEIGHT_M,
      ),
      orientation: {
        heading,
        pitch: -0.66,
        roll: 0,
      },
    });
  }

  destroy() {
    this.generation += 1;
    if (this.viewer && !this.viewer.isDestroyed?.()) this.viewer.destroy();
    this.viewer = undefined;
    this.marker = undefined;
    this.cameraHeadingDeg = undefined;
  }
}

export function createPlayableEarthViewer() {
  return window.__GODIESEL_PLAYABLE_EARTH_FACTORY__?.() ?? new CesiumPlayableEarthViewer();
}
