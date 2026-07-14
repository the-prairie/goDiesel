import type { QuestRoute } from "@/domain/routes";
import {
  advancePlayableEarthGrounding,
  initialPlayableEarthGrounding,
  type PlayableEarthGroundingObservation,
  type PlayableEarthGroundingReason,
  type PlayableEarthGroundingSource,
  type PlayableEarthGroundingState,
  type PlayableEarthPose,
} from "@/replay/playable-earth-controller";

export type PlayableEarthStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export interface PlayableEarthMountOptions {
  container: HTMLElement;
  route: QuestRoute;
  onStatus: (status: PlayableEarthStatus) => void;
  onGroundingChange?: (debug: PlayableEarthGroundingDebug) => void;
}

export interface PlayableEarthGroundingDebug {
  source: PlayableEarthGroundingSource;
  reason: PlayableEarthGroundingReason;
  offsetM?: number;
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
const SURFACE_VISUAL_OFFSET_M = 3;
const SURFACE_SAMPLE_INTERVAL_MS = 1_200;
const MAX_STALE_SAMPLE_DISTANCE_M = 500;
let cesiumPromise: Promise<CesiumGlobal | undefined> | undefined;

function cameraHeightAboveAvatarM(cameraRangeM: number) {
  if (cameraRangeM <= 240) {
    return 35 + ((cameraRangeM - 120) / 120) * 75;
  }
  return 110 + ((cameraRangeM - 240) / 1_160) * 1_190;
}

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
  private routeEntity?: any;
  private cameraHeadingDeg?: number;
  private grounding?: PlayableEarthGroundingState;
  private pendingGroundingObservation?: PlayableEarthGroundingObservation;
  private latestPose?: PlayableEarthPose;
  private lastGroundingUpdateMs?: number;
  private lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
  private surfaceSampleInFlight = false;
  private onGroundingChange?: (debug: PlayableEarthGroundingDebug) => void;
  private generation = 0;

  async mount({
    container,
    route,
    onStatus,
    onGroundingChange,
  }: PlayableEarthMountOptions) {
    const generation = ++this.generation;
    this.onGroundingChange = onGroundingChange;
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
      tileset.enableCollision = true;
      viewer.scene.primitives.add(tileset);

      const positions = route.route.map((point) =>
        Cesium.Cartesian3.fromDegrees(point.lng, point.lat),
      );
      const routeEntity = viewer.entities.add({
        name: `${route.name} route thread`,
        polyline: {
          positions,
          width: 9,
          clampToGround: true,
          classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: Cesium.Color.fromCssColorString("#00f19f").withAlpha(0.98),
            glowPower: 0.18,
          }),
          depthFailMaterial: Cesium.Color.fromCssColorString("#00f19f").withAlpha(
            0.94,
          ),
        },
      });
      this.routeEntity = routeEntity;
      const start = route.route[0];
      this.marker = viewer.entities.add({
        name: "Current route position",
        position: Cesium.Cartesian3.fromDegrees(
          start.lng,
          start.lat,
          start.elev + SURFACE_VISUAL_OFFSET_M,
        ),
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
    const now = performance.now();
    this.latestPose = pose;
    if (!this.grounding) {
      this.grounding = initialPlayableEarthGrounding(pose.elev);
      this.notifyGroundingChange();
    }
    const elapsedSeconds =
      this.lastGroundingUpdateMs === undefined
        ? 0
        : (now - this.lastGroundingUpdateMs) / 1_000;
    this.lastGroundingUpdateMs = now;
    const observation = this.pendingGroundingObservation;
    this.pendingGroundingObservation = undefined;
    this.grounding = advancePlayableEarthGrounding(
      this.grounding,
      pose.elev,
      elapsedSeconds,
      observation,
    );
    if (observation) this.notifyGroundingChange();
    const groundedHeightM = this.grounding.displayedHeightM;
    const markerPosition = Cesium.Cartesian3.fromDegrees(
      pose.lng,
      pose.lat,
      groundedHeightM + SURFACE_VISUAL_OFFSET_M,
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
    const cameraRangeM = pose.cameraRangeM;
    const cameraHeightM = cameraHeightAboveAvatarM(cameraRangeM);
    const cameraLat =
      pose.lat - (Math.cos(heading) * cameraRangeM) / 111_320;
    const cameraLng =
      pose.lng -
      (Math.sin(heading) * cameraRangeM) /
        (111_320 * Math.max(0.2, Math.cos((pose.lat * Math.PI) / 180)));
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        cameraLng,
        cameraLat,
        groundedHeightM + SURFACE_VISUAL_OFFSET_M + cameraHeightM,
      ),
      orientation: {
        heading,
        pitch: -Math.atan2(cameraHeightM, cameraRangeM),
        roll: 0,
      },
    });
    this.requestSurfaceSample(pose, now);
  }

  private requestSurfaceSample(pose: PlayableEarthPose, now: number) {
    const Cesium = window.Cesium;
    const scene = this.viewer?.scene;
    if (
      !Cesium?.Cartographic ||
      !scene ||
      this.surfaceSampleInFlight ||
      now - this.lastSurfaceSampleMs < SURFACE_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastSurfaceSampleMs = now;
    if (!scene.sampleHeightSupported || !scene.sampleHeightMostDetailed) {
      this.pendingGroundingObservation = { kind: "missing" };
      return;
    }

    const requestGeneration = this.generation;
    const requestProgressM = pose.progressM;
    const cartographic = Cesium.Cartographic.fromDegrees(pose.lng, pose.lat);
    this.surfaceSampleInFlight = true;
    void scene
      .sampleHeightMostDetailed(
        [cartographic],
        [this.routeEntity, this.marker].filter(Boolean),
        2,
      )
      .then((positions: Array<{ height?: number } | undefined>) => {
        if (requestGeneration !== this.generation) return;
        if (
          Math.abs((this.latestPose?.progressM ?? requestProgressM) - requestProgressM) >
          MAX_STALE_SAMPLE_DISTANCE_M
        ) {
          return;
        }
        const sampledHeightM = positions[0]?.height;
        this.pendingGroundingObservation =
          sampledHeightM !== undefined && Number.isFinite(sampledHeightM)
            ? { kind: "sample", heightM: sampledHeightM }
            : { kind: "missing" };
      })
      .catch(() => {
        if (requestGeneration === this.generation) {
          this.pendingGroundingObservation = { kind: "missing" };
        }
      })
      .finally(() => {
        if (requestGeneration === this.generation) {
          this.surfaceSampleInFlight = false;
        }
      });
  }

  private notifyGroundingChange() {
    if (!this.grounding) return;
    this.onGroundingChange?.({
      source: this.grounding.source,
      reason: this.grounding.reason,
      offsetM: this.grounding.stableOffsetM,
    });
  }

  destroy() {
    this.generation += 1;
    if (this.viewer && !this.viewer.isDestroyed?.()) this.viewer.destroy();
    this.viewer = undefined;
    this.marker = undefined;
    this.routeEntity = undefined;
    this.cameraHeadingDeg = undefined;
    this.grounding = undefined;
    this.pendingGroundingObservation = undefined;
    this.latestPose = undefined;
    this.lastGroundingUpdateMs = undefined;
    this.lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
    this.surfaceSampleInFlight = false;
    this.onGroundingChange = undefined;
  }
}

export function createPlayableEarthViewer() {
  return window.__GODIESEL_PLAYABLE_EARTH_FACTORY__?.() ?? new CesiumPlayableEarthViewer();
}
