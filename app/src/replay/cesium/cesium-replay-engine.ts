import {
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  ClassificationType,
  Color,
  ConstantPositionProperty,
  Entity,
  HeadingPitchRange,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import {
  advancePlayableEarthGrounding,
  initialPlayableEarthGrounding,
  type PlayableEarthGroundingObservation,
  type PlayableEarthGroundingState,
} from "@/replay/playable-earth-controller";
import type {
  ReplayEngine,
  ReplayEngineMountOptions,
} from "@/replay/replay-engine";
import type { ReplayPose } from "@/replay/replay-controller";
import { recordTileFailure, rgbaPixelsLookBlank } from "@/replay/replay-health";

const SURFACE_VISUAL_OFFSET_M = 3;
const SURFACE_SAMPLE_INTERVAL_MS = 1_200;
const MAX_STALE_SAMPLE_DISTANCE_M = 500;
const TILE_FAILURE_THRESHOLD = 8;

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

function cameraHeightAboveAvatarM(cameraRangeM: number) {
  if (cameraRangeM <= 240) {
    return 35 + ((cameraRangeM - 120) / 120) * 75;
  }
  return 110 + ((cameraRangeM - 240) / 1_160) * 1_190;
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export class CesiumReplayEngine implements ReplayEngine {
  private viewer?: Viewer;
  private marker?: Entity;
  private routeEntity?: Entity;
  private avatarElement?: HTMLElement;
  private removeAvatarTracking?: () => void;
  private markerPosition?: Cartesian3;
  private cameraHeadingDeg?: number;
  private cameraDestination = new Cartesian3();
  private cameraInitialized = false;
  private lastCameraUpdateMs?: number;
  private grounding?: PlayableEarthGroundingState;
  private pendingGroundingObservation?: PlayableEarthGroundingObservation;
  private latestPose?: ReplayPose;
  private lastGroundingUpdateMs?: number;
  private lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
  private surfaceSampleInFlight = false;
  private removeTileFailureListener?: () => void;
  private cancelInitialTileWait?: () => void;
  private diagnosticsTimer?: number;
  private tileFailureTimes: number[] = [];
  private blankFrameCount = 0;
  private partial = false;
  private onStatus?: ReplayEngineMountOptions["onStatus"];
  private generation = 0;

  async mount({ container, avatarElement, route, onStatus }: ReplayEngineMountOptions) {
    const generation = ++this.generation;
    this.onStatus = onStatus;
    onStatus({
      state: "loading",
      title: "Building your route world",
      message: "Loading the bundled Earth engine and photorealistic tiles.",
    });

    if (route.route.length < 2) {
      onStatus({
        state: "unavailable",
        title: "Route geometry unavailable",
        message: "This completed route does not contain enough points to replay.",
      });
      return;
    }
    if (!webglAvailable()) {
      onStatus({
        state: "unavailable",
        title: "WebGL unavailable",
        message: "This browser cannot start the photorealistic replay.",
      });
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      onStatus({
        state: "unavailable",
        title: "Map tiles unavailable",
        message: "A Google Map Tiles browser key is required for Earth Replay.",
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
        shouldAnimate: true,
        requestRenderMode: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
      this.viewer = viewer;
      this.avatarElement = avatarElement;
      viewer.scene.globe.show = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

      const tilesetUrl = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`;
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl, {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 24,
        dynamicScreenSpaceError: true,
        skipLevelOfDetail: true,
        enableCollision: true,
      });
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);
      this.removeTileFailureListener = tileset.tileFailed.addEventListener(() => {
        this.tileFailureTimes = recordTileFailure(
          this.tileFailureTimes,
          performance.now(),
        );
        if (this.tileFailureTimes.length >= TILE_FAILURE_THRESHOLD) {
          this.reportPartial(
            "Several photorealistic tiles failed to load. Replay can continue with gaps.",
          );
        }
      });

      const routeEntity = viewer.entities.add({
        name: `${route.name} route thread`,
        polyline: {
          positions: route.route.map((point) =>
            Cartesian3.fromDegrees(point.lng, point.lat),
          ),
          width: 12,
          clampToGround: true,
          classificationType: ClassificationType.CESIUM_3D_TILE,
          material: new PolylineGlowMaterialProperty({
            color: Color.fromCssColorString("#00f19f").withAlpha(0.98),
            glowPower: 0.18,
          }),
          depthFailMaterial: Color.fromCssColorString("#00f19f").withAlpha(0.94),
        },
      });
      this.routeEntity = routeEntity;
      const start = route.route[0];
      this.markerPosition = Cartesian3.fromDegrees(
        start.lng,
        start.lat,
        start.elev + SURFACE_VISUAL_OFFSET_M,
      );
      this.marker = viewer.entities.add({
        name: "Selected replay avatar",
        position: this.markerPosition,
        point: {
          pixelSize: 1,
          color: Color.TRANSPARENT,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.removeAvatarTracking = viewer.scene.preRender.addEventListener(() => {
        if (!this.avatarElement || !this.markerPosition) return;
        const screen = SceneTransforms.worldToWindowCoordinates(
          viewer.scene,
          this.markerPosition,
        );
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
          this.avatarElement.style.display = "none";
          return;
        }
        this.avatarElement.style.display = "block";
        this.avatarElement.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -74%)`;
      });

      await viewer.zoomTo(routeEntity, new HeadingPitchRange(0, -0.72, 0));
      if (generation !== this.generation) return;
      const initialTiles = await this.waitForInitialTiles(tileset);
      if (generation !== this.generation) return;
      if (!this.partial) {
        onStatus({
          state: "ready",
          title: "Earth Replay ready",
          message:
            initialTiles === "loaded"
              ? "The route thread and avatar are ready to move."
              : "The route is ready while finer tile detail continues loading.",
        });
      }
      this.startRenderDiagnostics(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      console.warn("Earth Replay unavailable", error);
      this.destroy();
      onStatus({
        state: "unavailable",
        title: "Photorealistic world unavailable",
        message: "Google 3D tiles could not load for this route.",
      });
    }
  }

  private waitForInitialTiles(tileset: Cesium3DTileset) {
    if (tileset.tilesLoaded) return Promise.resolve<"loaded">("loaded");
    return new Promise<"loaded" | "timeout" | "cancelled">((resolve) => {
      let settled = false;
      let removeLoaded: (() => void) | undefined;
      let timeout: number | undefined;
      const finish = (result: "loaded" | "timeout" | "cancelled") => {
        if (settled) return;
        settled = true;
        removeLoaded?.();
        if (timeout !== undefined) window.clearTimeout(timeout);
        if (this.cancelInitialTileWait === cancel) {
          this.cancelInitialTileWait = undefined;
        }
        resolve(result);
      };
      const cancel = () => finish("cancelled");
      removeLoaded = tileset.allTilesLoaded.addEventListener(() => finish("loaded"));
      timeout = window.setTimeout(() => finish("timeout"), 8_000);
      this.cancelInitialTileWait = cancel;
    });
  }

  private startRenderDiagnostics(generation: number) {
    this.diagnosticsTimer = window.setInterval(() => {
      if (generation !== this.generation || this.partial) return;
      const canvas = this.viewer?.canvas;
      if (!canvas || canvas.width < 2 || canvas.height < 2) return;
      this.blankFrameCount = canvasLooksBlank(canvas) ? this.blankFrameCount + 1 : 0;
      if (this.blankFrameCount >= 2) {
        this.reportPartial(
          "The 3D scene is not rendering fully. Replay can continue in Atlas instead.",
        );
      }
    }, 8_000);
  }

  private reportPartial(message: string) {
    if (this.partial) return;
    this.partial = true;
    this.onStatus?.({
      state: "partial",
      title: "3D tiles partially unavailable",
      message,
    });
  }

  setPose(pose: ReplayPose) {
    const viewer = this.viewer;
    if (!viewer || !this.marker || viewer.isDestroyed()) return;
    const now = performance.now();
    this.latestPose = pose;
    if (!this.grounding) {
      this.grounding = initialPlayableEarthGrounding(pose.elev);
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
    const groundedHeightM = this.grounding.displayedHeightM;
    this.markerPosition = Cartesian3.fromDegrees(
      pose.lng,
      pose.lat,
      groundedHeightM + SURFACE_VISUAL_OFFSET_M,
    );
    this.marker.position = new ConstantPositionProperty(this.markerPosition);

    if (this.cameraHeadingDeg === undefined) {
      this.cameraHeadingDeg = pose.bearingDeg;
    } else {
      const delta = ((pose.bearingDeg - this.cameraHeadingDeg + 540) % 360) - 180;
      this.cameraHeadingDeg = (this.cameraHeadingDeg + delta * 0.08 + 360) % 360;
    }
    this.requestSurfaceSample(pose, now);
    if (!pose.following) {
      this.lastCameraUpdateMs = now;
      return;
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
    const desiredDestination = Cartesian3.fromDegrees(
      cameraLng,
      cameraLat,
      groundedHeightM + SURFACE_VISUAL_OFFSET_M + cameraHeightM,
    );
    const cameraElapsedSeconds =
      this.lastCameraUpdateMs === undefined ? 0 : (now - this.lastCameraUpdateMs) / 1_000;
    this.lastCameraUpdateMs = now;
    const easing = this.cameraInitialized
      ? Math.min(1, Math.max(0.04, 1 - Math.exp(-5 * cameraElapsedSeconds)))
      : 1;
    const destination = Cartesian3.lerp(
      viewer.camera.positionWC,
      desiredDestination,
      easing,
      this.cameraDestination,
    );
    const headingDelta =
      ((heading - viewer.camera.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const easedHeading = viewer.camera.heading + headingDelta * easing;
    const desiredPitch = -Math.atan2(cameraHeightM, cameraRangeM);
    const easedPitch = viewer.camera.pitch + (desiredPitch - viewer.camera.pitch) * easing;
    viewer.camera.setView({
      destination,
      orientation: {
        heading: easedHeading,
        pitch: easedPitch,
        roll: 0,
      },
    });
    this.cameraInitialized = true;
  }

  private requestSurfaceSample(pose: ReplayPose, now: number) {
    const scene = this.viewer?.scene;
    if (
      !scene ||
      this.surfaceSampleInFlight ||
      now - this.lastSurfaceSampleMs < SURFACE_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastSurfaceSampleMs = now;
    if (!scene.sampleHeightSupported) {
      this.pendingGroundingObservation = { kind: "missing" };
      return;
    }

    const requestGeneration = this.generation;
    const requestProgressM = pose.progressM;
    this.surfaceSampleInFlight = true;
    void scene
      .sampleHeightMostDetailed(
        [Cartographic.fromDegrees(pose.lng, pose.lat)],
        [this.routeEntity, this.marker].filter((entity): entity is Entity => Boolean(entity)),
        2,
      )
      .then((positions) => {
        if (requestGeneration !== this.generation) return;
        if (
          Math.abs((this.latestPose?.progressM ?? requestProgressM) - requestProgressM) >
          MAX_STALE_SAMPLE_DISTANCE_M
        ) {
          return;
        }
        const sampledHeightM = positions[0]?.height;
        this.pendingGroundingObservation =
          typeof sampledHeightM === "number" && Number.isFinite(sampledHeightM)
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

  destroy() {
    this.generation += 1;
    this.cancelInitialTileWait?.();
    this.removeTileFailureListener?.();
    if (this.diagnosticsTimer !== undefined) {
      window.clearInterval(this.diagnosticsTimer);
    }
    this.removeAvatarTracking?.();
    if (this.avatarElement) this.avatarElement.style.display = "none";
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
    this.marker = undefined;
    this.routeEntity = undefined;
    this.avatarElement = undefined;
    this.removeAvatarTracking = undefined;
    this.markerPosition = undefined;
    this.cameraHeadingDeg = undefined;
    this.cameraInitialized = false;
    this.lastCameraUpdateMs = undefined;
    this.grounding = undefined;
    this.pendingGroundingObservation = undefined;
    this.latestPose = undefined;
    this.lastGroundingUpdateMs = undefined;
    this.lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
    this.surfaceSampleInFlight = false;
    this.removeTileFailureListener = undefined;
    this.cancelInitialTileWait = undefined;
    this.diagnosticsTimer = undefined;
    this.tileFailureTimes = [];
    this.blankFrameCount = 0;
    this.partial = false;
    this.onStatus = undefined;
  }
}
