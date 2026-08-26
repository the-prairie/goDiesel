import {
  Axis,
  Cartesian3,
  Color,
  ColorBlendMode,
  ConstantPositionProperty,
  Entity,
  HeadingPitchRange,
  Math as CesiumMath,
  Model,
  PolylineGlowMaterialProperty,
  Transforms,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { QuestRoute } from "@/domain/route";
import { ROUTE_THREAD_STYLE } from "@/domain/geometry/route-thread-style";
import type { PlayableEarthPose } from "@/labs/playable-earth/playable-earth-controller";
import { loadWorldPackForRoute } from "@/world-packs/world-pack-loader";
import type {
  VerifiedWorldPack,
  WorldPackLoadPhase,
} from "@/world-packs/world-pack-types";

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
  source: "fallback" | "sampled";
  reason: "recorded" | "sampled" | "missing" | "outlier";
  offsetM?: number;
}

export interface PlayableEarthViewer {
  mount(options: PlayableEarthMountOptions): Promise<void>;
  setPose(pose: PlayableEarthPose): void;
  destroy(): void;
}

declare global {
  interface Window {
    __GODIESEL_PLAYABLE_EARTH_FACTORY__?: () => PlayableEarthViewer;
  }
}

const SURFACE_VISUAL_OFFSET_M = 2.2;

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function loadingMessage(phase: WorldPackLoadPhase): string {
  switch (phase) {
    case "index":
      return "Finding the sealed local world.";
    case "manifest":
      return "Checking the World Pack identity.";
    case "integrity":
      return "Verifying every required local artifact.";
    case "physical-neighbourhood":
      return "Preparing terrain, collision, and route navigation.";
    case "ready":
      return "Opening the verified local world.";
  }
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

class CesiumPlayableEarthViewer implements PlayableEarthViewer {
  private viewer?: Viewer;
  private marker?: Entity;
  private routeEntity?: Entity;
  private pack?: VerifiedWorldPack;
  private models: Model[] = [];
  private objectUrls: string[] = [];
  private abortController?: AbortController;
  private cameraHeadingDeg?: number;
  private generation = 0;

  async mount({
    container,
    route,
    onStatus,
    onGroundingChange,
  }: PlayableEarthMountOptions) {
    const generation = ++this.generation;
    this.abortController = new AbortController();
    onStatus({
      state: "loading",
      title: "Opening your route world",
      message: "Finding the sealed local World Pack.",
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

    try {
      const pack = await loadWorldPackForRoute(route.slug, {
        signal: this.abortController.signal,
        onPhase: (phase) => {
          if (generation !== this.generation || phase === "ready") return;
          onStatus({
            state: "loading",
            title: "Opening your route world",
            message: loadingMessage(phase),
          });
        },
      });
      if (generation !== this.generation) return;
      this.pack = pack;

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
        shouldAnimate: false,
        requestRenderMode: false,
        contextOptions: { webgl: { preserveDrawingBuffer: true } },
      });
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      this.viewer = viewer;
      viewer.scene.globe.show = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
      viewer.scene.backgroundColor = Color.fromCssColorString("#17231f");
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.canvas.setAttribute("aria-label", "Verified local World Pack");
      viewer.canvas.dataset.worldPackState = "loading";
      viewer.canvas.dataset.worldPackId = pack.manifest.packId;
      viewer.canvas.dataset.worldId = pack.manifest.worldId;
      viewer.canvas.dataset.networkRequired = "false";
      viewer.canvas.dataset.physicalNeighbourhood = "verified";

      const origin = Cartesian3.fromDegrees(
        pack.runtime.origin.longitude,
        pack.runtime.origin.latitude,
        pack.runtime.origin.elevationM,
      );
      const modelMatrix = Transforms.eastNorthUpToFixedFrame(origin);
      await this.addModel(
        pack,
        pack.runtime.assets.terrain,
        modelMatrix,
        Color.fromCssColorString("#62735c"),
      );
      await this.addModel(
        pack,
        pack.runtime.assets.traversableSurfaces,
        modelMatrix,
        Color.fromCssColorString("#b9ad82"),
      );
      if (generation !== this.generation) return;
      await this.waitForModelsReady(generation);
      if (generation !== this.generation) return;

      const positions = pack.canonicalRoute.coordinates.map((point) =>
        Cartesian3.fromDegrees(
          point.longitude,
          point.latitude,
          point.elevationM + SURFACE_VISUAL_OFFSET_M,
        ),
      );
      this.routeEntity = viewer.entities.add({
        name: `${route.name} route thread`,
        polyline: {
          positions,
          width: 7,
          material: new PolylineGlowMaterialProperty({
            color: Color.fromCssColorString(ROUTE_THREAD_STYLE.color).withAlpha(0.98),
            glowPower: 0.16,
          }),
        },
      });
      const start = pack.canonicalRoute.coordinates[0];
      this.marker = viewer.entities.add({
        name: "Current route position",
        position: Cartesian3.fromDegrees(
          start.longitude,
          start.latitude,
          start.elevationM + SURFACE_VISUAL_OFFSET_M,
        ),
        point: {
          pixelSize: 10,
          color: Color.fromCssColorString("#f7f3e8"),
          outlineColor: Color.fromCssColorString(ROUTE_THREAD_STYLE.color),
          outlineWidth: 3,
          disableDepthTestDistance: 2_000,
        },
      });
      viewer.canvas.dataset.worldPackState = "ready";
      onGroundingChange?.({ source: "sampled", reason: "sampled", offsetM: 0 });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (generation !== this.generation) return;
      onStatus({
        state: "ready",
        title: "Local World Pack ready",
        message: "Terrain, collision, route truth, and navigation are verified.",
      });
    } catch (error) {
      if (generation !== this.generation || this.abortController?.signal.aborted) return;
      console.warn("Playable Earth World Pack unavailable", error);
      this.destroyResources();
      onStatus({
        state: "unavailable",
        title: "Local World Pack unavailable",
        message:
          error instanceof Error
            ? error.message
            : "The local world could not be opened.",
      });
    }
  }

  setPose(pose: PlayableEarthPose) {
    const viewer = this.viewer;
    if (!viewer || !this.marker || viewer.isDestroyed()) return;
    const target = Cartesian3.fromDegrees(
      pose.lng,
      pose.lat,
      pose.elev + SURFACE_VISUAL_OFFSET_M,
    );
    this.marker.position = new ConstantPositionProperty(target);
    if (this.cameraHeadingDeg === undefined) {
      this.cameraHeadingDeg = pose.cameraHeadingDeg;
    } else {
      const delta =
        ((pose.cameraHeadingDeg - this.cameraHeadingDeg + 540) % 360) - 180;
      this.cameraHeadingDeg =
        (this.cameraHeadingDeg + delta * 0.08 + 360) % 360;
    }
    const pitch = pose.cameraRangeM <= 240 ? -0.34 : -0.62;
    viewer.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(this.cameraHeadingDeg),
        pitch,
        pose.cameraRangeM,
      ),
    );
  }

  private async addModel(
    pack: VerifiedWorldPack,
    logicalPath: string,
    modelMatrix: ReturnType<typeof Transforms.eastNorthUpToFixedFrame>,
    color: Color,
  ) {
    const url = URL.createObjectURL(
      new Blob([ownedBuffer(pack.artifact(logicalPath))], {
        type: "model/gltf-binary",
      }),
    );
    this.objectUrls.push(url);
    const model = await Model.fromGltfAsync({
      url,
      modelMatrix,
      upAxis: Axis.Z,
      forwardAxis: Axis.X,
      allowPicking: false,
      asynchronous: false,
      color,
      colorBlendMode: ColorBlendMode.MIX,
      colorBlendAmount: 0.75,
      backFaceCulling: false,
    });
    this.viewer?.scene.primitives.add(model);
    this.models.push(model);
    return model;
  }

  private async waitForModelsReady(generation: number) {
    for (let frame = 0; frame < 120; frame += 1) {
      if (generation !== this.generation) return;
      if (this.models.every((model) => model.ready)) return;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("Local World Pack models did not become render-ready.");
  }

  private destroyResources() {
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
    this.marker = undefined;
    this.routeEntity = undefined;
    this.pack = undefined;
    this.models = [];
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.cameraHeadingDeg = undefined;
  }

  destroy() {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = undefined;
    this.destroyResources();
  }
}

export function createPlayableEarthViewer() {
  return (
    window.__GODIESEL_PLAYABLE_EARTH_FACTORY__?.() ??
    new CesiumPlayableEarthViewer()
  );
}
