import {
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  ClassificationType,
  Color,
  ConstantPositionProperty,
  Entity,
  HeadingPitchRoll,
  HeadingPitchRange,
  Matrix4,
  Model,
  ModelAnimationLoop,
  PolylineGlowMaterialProperty,
  SceneTransforms,
  Transforms,
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
import { bearingDegrees, routePathPose } from "@/replay/route-path";
import type { QuestRoute } from "@/domain/routes";
import {
  advanceReplayCameraClearance,
  initialReplayCameraClearance,
  REPLAY_CAMERA_MIN_CLEARANCE_M,
  type ReplayCameraClearanceState,
  type ReplayCameraSurfaceObservation,
} from "@/replay/cesium/replay-camera-clearance";

const SURFACE_VISUAL_OFFSET_M = 3;
const SURFACE_SAMPLE_INTERVAL_MS = 250;
const MAX_STALE_SAMPLE_DISTANCE_M = 500;
const MAX_STALE_CAMERA_SAMPLE_DISTANCE_M = 150;
const MAX_CAMERA_EASING_DISTANCE_M = 500;
const TILE_FAILURE_THRESHOLD = 8;

export type CesiumReplayAvatarRendering =
  | { kind: "overlay" }
  | {
      kind: "native-glb";
      uri: string;
      reducedMotion?: boolean;
    };

export interface CesiumReplayEngineOptions {
  avatarRendering?: CesiumReplayAvatarRendering;
}

export type CesiumReplayAvatarStatus =
  | "ready"
  | "static"
  | "error"
  | "pending";

interface CameraTarget {
  lat: number;
  lng: number;
}

function distanceBetweenTargetsM(from: CameraTarget, to: CameraTarget) {
  const meanLatRadians = (((from.lat + to.lat) / 2) * Math.PI) / 180;
  const northM = (to.lat - from.lat) * 111_320;
  const eastM =
    (to.lng - from.lng) * 111_320 * Math.max(0.2, Math.cos(meanLatRadians));
  return Math.hypot(northM, eastM);
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
  private route?: QuestRoute;
  private marker?: Entity;
  private routeEntity?: Entity;
  private avatarElement?: HTMLElement;
  private removeAvatarTracking?: () => void;
  private markerPosition?: Cartesian3;
  private nativeAvatarModel?: Model;
  private removeNativeAvatarReadyListener?: () => void;
  private removeNativeAvatarErrorListener?: () => void;
  private cancelNativeAvatarReady?: () => void;
  private nativeAvatarLoadGeneration = 0;
  private avatarRendering: CesiumReplayAvatarRendering;
  private readonly nativeAvatarMatrix = new Matrix4();
  private readonly nativeAvatarHeadingPitchRoll = new HeadingPitchRoll();
  private cameraHeadingDeg?: number;
  private cameraDestination = new Cartesian3();
  private cameraInitialized = false;
  private cameraClearance?: ReplayCameraClearanceState;
  private pendingCameraSurfaceObservation?: ReplayCameraSurfaceObservation;
  private pendingCameraSurfaceTarget?: CameraTarget;
  private latestCameraTarget?: CameraTarget;
  private cameraSamplePosition?: CameraTarget;
  private lastCameraUpdateMs?: number;
  private grounding?: PlayableEarthGroundingState;
  private pendingGroundingObservation?: PlayableEarthGroundingObservation;
  private latestPose?: ReplayPose;
  private lastGroundingUpdateMs?: number;
  private lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
  private surfaceSampleInFlight = false;
  private surfaceSampleRetryTimer?: number;
  private removeTileFailureListener?: () => void;
  private cancelInitialTileWait?: () => void;
  private diagnosticsTimer?: number;
  private tileFailureTimes: number[] = [];
  private blankFrameCount = 0;
  private partial = false;
  private onStatus?: ReplayEngineMountOptions["onStatus"];
  private container?: HTMLElement;
  private generation = 0;

  constructor(
    private readonly minimumCameraClearanceM = REPLAY_CAMERA_MIN_CLEARANCE_M,
    private readonly options: CesiumReplayEngineOptions = {},
  ) {
    this.avatarRendering = options.avatarRendering ?? { kind: "overlay" };
  }

  async mount({ container, avatarElement, route, onStatus }: ReplayEngineMountOptions) {
    const generation = ++this.generation;
    this.container = container;
    this.route = route;
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
        if (this.avatarRendering.kind === "native-glb") {
          this.avatarElement.style.display = "none";
          return;
        }
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
      await this.setAvatarRendering(this.avatarRendering);
      if (generation !== this.generation) return;

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

  async setAvatarRendering(
    avatarRendering: CesiumReplayAvatarRendering,
  ): Promise<CesiumReplayAvatarStatus> {
    this.avatarRendering = avatarRendering;
    const loadGeneration = ++this.nativeAvatarLoadGeneration;
    this.clearNativeAvatarModel();

    const { container, viewer, markerPosition } = this;
    if (!container || !viewer || !markerPosition || viewer.isDestroyed()) {
      return "pending";
    }
    container.dataset.avatarRenderer = avatarRendering.kind;
    if (avatarRendering.kind === "overlay") {
      delete container.dataset.avatarAnimation;
      viewer.scene.requestRender();
      return "ready";
    }

    if (this.avatarElement) this.avatarElement.style.display = "none";
    container.dataset.avatarAnimation = "loading";
    try {
      const model = await Model.fromGltfAsync({
        url: avatarRendering.uri,
        modelMatrix: this.nativeAvatarModelMatrix(markerPosition, 0),
        scale: 1.4,
        minimumPixelSize: 48,
        maximumScale: 16,
        silhouetteColor: Color.fromCssColorString("#00f19f"),
        silhouetteSize: 1.5,
        allowPicking: false,
      });
      if (
        loadGeneration !== this.nativeAvatarLoadGeneration ||
        viewer.isDestroyed()
      ) {
        model.destroy();
        return "pending";
      }
      this.nativeAvatarModel = model;
      viewer.scene.primitives.add(model);
      if (!model.ready) {
        const ready = await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            this.removeNativeAvatarReadyListener?.();
            this.removeNativeAvatarReadyListener = undefined;
            this.removeNativeAvatarErrorListener?.();
            this.removeNativeAvatarErrorListener = undefined;
            this.cancelNativeAvatarReady = undefined;
            resolve(value);
          };
          this.removeNativeAvatarReadyListener =
            model.readyEvent.addEventListener(() => finish(true));
          this.removeNativeAvatarErrorListener =
            model.errorEvent.addEventListener(() => finish(false));
          this.cancelNativeAvatarReady = () => finish(false);
        });
        if (!ready) {
          if (loadGeneration !== this.nativeAvatarLoadGeneration) return "pending";
          container.dataset.avatarAnimation = "error";
          this.clearNativeAvatarModel();
          return "error";
        }
      }
      if (
        loadGeneration !== this.nativeAvatarLoadGeneration ||
        model.isDestroyed()
      ) {
        return "pending";
      }
      const animations = model.activeAnimations.addAll({
        loop: ModelAnimationLoop.REPEAT,
        animationTime: (duration) => {
          if (
            this.avatarRendering.kind === "native-glb" &&
            this.avatarRendering.reducedMotion
          ) {
            return 0.18;
          }
          const strideSeconds = (this.latestPose?.progressM ?? 0) / 2.8;
          return duration > 0 ? (strideSeconds % duration) / duration : 0;
        },
      });
      const status = animations.length > 0 ? "ready" : "static";
      container.dataset.avatarAnimation = status;
      viewer.scene.requestRender();
      return status;
    } catch (error) {
      if (loadGeneration !== this.nativeAvatarLoadGeneration) return "pending";
      console.warn("Replay avatar model unavailable", error);
      container.dataset.avatarAnimation = "error";
      this.clearNativeAvatarModel();
      return "error";
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
    if (this.nativeAvatarModel) {
      this.nativeAvatarModel.modelMatrix = this.nativeAvatarModelMatrix(
        this.markerPosition,
        (pose.bearingDeg * Math.PI) / 180,
      );
    }

    const cameraRangeM = pose.cameraRangeM;
    const cameraHeightM = cameraHeightAboveAvatarM(cameraRangeM);
    const routeCameraPose =
      this.route && pose.progressM >= cameraRangeM
        ? routePathPose(this.route, pose.progressM - cameraRangeM)
        : undefined;
    const fallbackHeading = (pose.bearingDeg * Math.PI) / 180;
    const cameraLat =
      routeCameraPose?.lat ??
      pose.lat - (Math.cos(fallbackHeading) * cameraRangeM) / 111_320;
    const cameraLng =
      routeCameraPose?.lng ??
      pose.lng -
        (Math.sin(fallbackHeading) * cameraRangeM) /
          (111_320 * Math.max(0.2, Math.cos((pose.lat * Math.PI) / 180)));
    const desiredHeadingDeg = routeCameraPose
      ? bearingDegrees(
          { ...routeCameraPose, d: routeCameraPose.progressM },
          { ...pose, d: pose.progressM },
        )
      : pose.bearingDeg;
    if (this.cameraHeadingDeg === undefined) {
      this.cameraHeadingDeg = desiredHeadingDeg;
    } else {
      const delta =
        ((desiredHeadingDeg - this.cameraHeadingDeg + 540) % 360) - 180;
      this.cameraHeadingDeg = (this.cameraHeadingDeg + delta * 0.08 + 360) % 360;
    }
    const heading = (this.cameraHeadingDeg * Math.PI) / 180;
    this.latestCameraTarget = { lat: cameraLat, lng: cameraLng };
    this.requestSurfaceSample(pose, cameraLat, cameraLng, now);
    if (!pose.following) {
      this.lastCameraUpdateMs = now;
      return;
    }
    const cameraElapsedSeconds =
      this.lastCameraUpdateMs === undefined ? 0 : (now - this.lastCameraUpdateMs) / 1_000;
    this.lastCameraUpdateMs = now;
    const baseCameraAltitudeM =
      Math.max(groundedHeightM, routeCameraPose?.elev ?? groundedHeightM) +
      SURFACE_VISUAL_OFFSET_M +
      cameraHeightM;
    let cameraObservation = this.pendingCameraSurfaceObservation;
    let cameraObservationTarget = this.pendingCameraSurfaceTarget;
    this.pendingCameraSurfaceObservation = undefined;
    this.pendingCameraSurfaceTarget = undefined;
    const desiredCameraCartographic = Cartographic.fromDegrees(cameraLng, cameraLat);
    const synchronousCameraSurfaceM = viewer.scene.sampleHeightSupported
      ? viewer.scene.sampleHeight(
          desiredCameraCartographic,
          [this.routeEntity, this.marker].filter(
            (entity): entity is Entity => Boolean(entity),
          ),
          2,
        )
      : undefined;
    if (
      typeof synchronousCameraSurfaceM === "number" &&
      Number.isFinite(synchronousCameraSurfaceM)
    ) {
      cameraObservation = { kind: "sample", heightM: synchronousCameraSurfaceM };
      cameraObservationTarget = { lat: cameraLat, lng: cameraLng };
    }
    if (cameraObservation?.kind === "sample" && cameraObservationTarget) {
      this.cameraSamplePosition = cameraObservationTarget;
    }
    const sampleIsLocal =
      this.cameraSamplePosition !== undefined &&
      distanceBetweenTargetsM(this.cameraSamplePosition, {
        lat: cameraLat,
        lng: cameraLng,
      }) <= MAX_STALE_CAMERA_SAMPLE_DISTANCE_M;
    if (!this.cameraSamplePosition) {
      if (this.container) {
        this.container.dataset.cameraClearanceM = "pending";
        this.container.dataset.cameraSurfaceHeightM = "pending";
      }
      return;
    }
    const renderedCameraTarget = sampleIsLocal
      ? { lat: cameraLat, lng: cameraLng }
      : this.cameraSamplePosition;
    if (!this.cameraClearance) {
      this.cameraClearance = initialReplayCameraClearance(
        Math.max(viewer.camera.positionCartographic.height, baseCameraAltitudeM),
      );
    }
    this.cameraClearance = advanceReplayCameraClearance(
      this.cameraClearance,
      baseCameraAltitudeM,
      cameraElapsedSeconds,
      cameraObservation,
      this.minimumCameraClearanceM,
    );
    const cameraAltitudeM = this.cameraClearance.altitudeM;
    const desiredDestination = Cartesian3.fromDegrees(
      renderedCameraTarget.lng,
      renderedCameraTarget.lat,
      cameraAltitudeM,
    );
    const easing = this.cameraInitialized
      ? Math.min(1, Math.max(0.04, 1 - Math.exp(-5 * cameraElapsedSeconds)))
      : 1;
    const currentCameraTarget = {
      lat: (viewer.camera.positionCartographic.latitude * 180) / Math.PI,
      lng: (viewer.camera.positionCartographic.longitude * 180) / Math.PI,
    };
    const cameraJumpDistanceM = distanceBetweenTargetsM(
      currentCameraTarget,
      renderedCameraTarget,
    );
    let destination =
      !this.cameraInitialized || cameraJumpDistanceM > MAX_CAMERA_EASING_DISTANCE_M
        ? desiredDestination
        : Cartesian3.lerp(
            viewer.camera.positionWC,
            desiredDestination,
            easing,
            this.cameraDestination,
          );
    const destinationCartographic = Cartographic.fromCartesian(destination);
    const destinationSurfaceHeightM = viewer.scene.sampleHeightSupported
      ? viewer.scene.sampleHeight(
          destinationCartographic,
          [this.routeEntity, this.marker].filter(
            (entity): entity is Entity => Boolean(entity),
          ),
          2,
        )
      : undefined;
    const minimumDestinationAltitudeM =
      typeof destinationSurfaceHeightM === "number" &&
      Number.isFinite(destinationSurfaceHeightM)
        ? destinationSurfaceHeightM + this.minimumCameraClearanceM
        : cameraAltitudeM;
    if (destinationCartographic.height < minimumDestinationAltitudeM) {
      destination = Cartesian3.fromRadians(
        destinationCartographic.longitude,
        destinationCartographic.latitude,
        minimumDestinationAltitudeM,
      );
    }
    const headingDelta =
      ((heading - viewer.camera.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const easedHeading = viewer.camera.heading + headingDelta * easing;
    const desiredPitch = -Math.atan2(
      cameraAltitudeM - groundedHeightM - SURFACE_VISUAL_OFFSET_M,
      cameraRangeM,
    );
    const easedPitch = viewer.camera.pitch + (desiredPitch - viewer.camera.pitch) * easing;
    viewer.camera.setView({
      destination,
      orientation: {
        heading: easedHeading,
        pitch: easedPitch,
        roll: 0,
      },
    });
    if (this.container) {
      const actualAltitudeM = viewer.camera.positionCartographic.height;
      const actualLatitudeDeg =
        (viewer.camera.positionCartographic.latitude * 180) / Math.PI;
      const actualLongitudeDeg =
        (viewer.camera.positionCartographic.longitude * 180) / Math.PI;
      const actualSurfaceHeightM =
        typeof destinationSurfaceHeightM === "number" &&
        Number.isFinite(destinationSurfaceHeightM)
          ? destinationSurfaceHeightM
          : undefined;
      const clearanceM =
        actualSurfaceHeightM === undefined
          ? undefined
          : actualAltitudeM - actualSurfaceHeightM;
      this.container.dataset.cameraAltitudeM = actualAltitudeM.toFixed(2);
      this.container.dataset.cameraLatitude = actualLatitudeDeg.toFixed(7);
      this.container.dataset.cameraLongitude = actualLongitudeDeg.toFixed(7);
      this.container.dataset.cameraSurfaceHeightM =
        actualSurfaceHeightM?.toFixed(2) ?? "unknown";
      this.container.dataset.cameraClearanceM =
        clearanceM?.toFixed(2) ?? "unknown";
      this.container.dataset.minimumCameraClearanceM =
        this.minimumCameraClearanceM.toFixed(2);
    }
    this.cameraInitialized = true;
  }

  private nativeAvatarModelMatrix(position: Cartesian3, heading: number) {
    this.nativeAvatarHeadingPitchRoll.heading = heading;
    this.nativeAvatarHeadingPitchRoll.pitch = 0;
    this.nativeAvatarHeadingPitchRoll.roll = 0;
    return Transforms.headingPitchRollToFixedFrame(
      position,
      this.nativeAvatarHeadingPitchRoll,
      undefined,
      undefined,
      this.nativeAvatarMatrix,
    );
  }

  private clearNativeAvatarModel() {
    this.cancelNativeAvatarReady?.();
    this.cancelNativeAvatarReady = undefined;
    this.removeNativeAvatarReadyListener?.();
    this.removeNativeAvatarReadyListener = undefined;
    this.removeNativeAvatarErrorListener?.();
    this.removeNativeAvatarErrorListener = undefined;
    if (
      this.viewer &&
      this.nativeAvatarModel &&
      !this.viewer.isDestroyed()
    ) {
      this.viewer.scene.primitives.remove(this.nativeAvatarModel);
    }
    this.nativeAvatarModel = undefined;
  }

  private requestSurfaceSample(
    pose: ReplayPose,
    cameraLat: number,
    cameraLng: number,
    now: number,
  ) {
    const scene = this.viewer?.scene;
    if (
      !scene ||
      this.surfaceSampleInFlight ||
      now - this.lastSurfaceSampleMs < SURFACE_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastSurfaceSampleMs = now;
    if (this.surfaceSampleRetryTimer !== undefined) {
      window.clearTimeout(this.surfaceSampleRetryTimer);
      this.surfaceSampleRetryTimer = undefined;
    }
    if (!scene.sampleHeightSupported) {
      this.pendingGroundingObservation = { kind: "missing" };
      this.pendingCameraSurfaceObservation = { kind: "missing" };
      return;
    }

    const requestGeneration = this.generation;
    const requestProgressM = pose.progressM;
    const requestCameraTarget = { lat: cameraLat, lng: cameraLng };
    let retryLatestPose = false;
    this.surfaceSampleInFlight = true;
    void scene
      .sampleHeightMostDetailed(
        [
          Cartographic.fromDegrees(pose.lng, pose.lat),
          Cartographic.fromDegrees(cameraLng, cameraLat),
        ],
        [this.routeEntity, this.marker].filter((entity): entity is Entity => Boolean(entity)),
        2,
      )
      .then((positions) => {
        if (requestGeneration !== this.generation) return;
        const progressSampleIsStale =
          Math.abs(
            (this.latestPose?.progressM ?? requestProgressM) - requestProgressM,
          ) > MAX_STALE_SAMPLE_DISTANCE_M;
        const cameraSampleIsStale =
          !this.latestCameraTarget ||
          distanceBetweenTargetsM(
            requestCameraTarget,
            this.latestCameraTarget,
          ) > MAX_STALE_CAMERA_SAMPLE_DISTANCE_M;
        const sampledHeightM = positions[0]?.height;
        const sampledCameraHeightM = positions[1]?.height;
        if (!progressSampleIsStale) {
          this.pendingGroundingObservation =
            typeof sampledHeightM === "number" && Number.isFinite(sampledHeightM)
              ? { kind: "sample", heightM: sampledHeightM }
              : { kind: "missing" };
        }
        this.pendingCameraSurfaceObservation =
          typeof sampledCameraHeightM === "number" &&
          Number.isFinite(sampledCameraHeightM)
            ? { kind: "sample", heightM: sampledCameraHeightM }
            : { kind: "missing" };
        this.pendingCameraSurfaceTarget = requestCameraTarget;
        retryLatestPose = progressSampleIsStale || cameraSampleIsStale;
        if (this.latestPose) this.setPose(this.latestPose);
      })
      .catch(() => {
        if (requestGeneration === this.generation) {
          this.pendingGroundingObservation = { kind: "missing" };
          this.pendingCameraSurfaceObservation = { kind: "missing" };
          this.pendingCameraSurfaceTarget = requestCameraTarget;
          retryLatestPose = true;
        }
      })
      .finally(() => {
        if (requestGeneration === this.generation) {
          this.surfaceSampleInFlight = false;
          if (retryLatestPose && this.latestPose) {
            this.setPose(this.latestPose);
            const retryDelayMs = Math.max(
              0,
              SURFACE_SAMPLE_INTERVAL_MS -
                (performance.now() - this.lastSurfaceSampleMs),
            );
            this.surfaceSampleRetryTimer = window.setTimeout(() => {
              this.surfaceSampleRetryTimer = undefined;
              if (requestGeneration === this.generation && this.latestPose) {
                this.setPose(this.latestPose);
              }
            }, retryDelayMs);
          }
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
    if (this.surfaceSampleRetryTimer !== undefined) {
      window.clearTimeout(this.surfaceSampleRetryTimer);
    }
    this.removeAvatarTracking?.();
    if (this.avatarElement) this.avatarElement.style.display = "none";
    this.nativeAvatarLoadGeneration += 1;
    this.clearNativeAvatarModel();
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
    this.route = undefined;
    this.marker = undefined;
    this.routeEntity = undefined;
    this.avatarElement = undefined;
    this.removeAvatarTracking = undefined;
    this.markerPosition = undefined;
    this.cameraHeadingDeg = undefined;
    this.cameraInitialized = false;
    this.cameraClearance = undefined;
    this.pendingCameraSurfaceObservation = undefined;
    this.pendingCameraSurfaceTarget = undefined;
    this.latestCameraTarget = undefined;
    this.cameraSamplePosition = undefined;
    this.lastCameraUpdateMs = undefined;
    this.grounding = undefined;
    this.pendingGroundingObservation = undefined;
    this.latestPose = undefined;
    this.lastGroundingUpdateMs = undefined;
    this.lastSurfaceSampleMs = Number.NEGATIVE_INFINITY;
    this.surfaceSampleInFlight = false;
    this.surfaceSampleRetryTimer = undefined;
    this.removeTileFailureListener = undefined;
    this.cancelInitialTileWait = undefined;
    this.diagnosticsTimer = undefined;
    this.tileFailureTimes = [];
    this.blankFrameCount = 0;
    this.partial = false;
    this.onStatus = undefined;
    this.container = undefined;
  }
}
