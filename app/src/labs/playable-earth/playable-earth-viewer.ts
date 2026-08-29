import {
  Axis,
  Cartesian3,
  Cesium3DTileset,
  Cesium3DTileStyle,
  Color,
  ColorBlendMode,
  ConstantPositionProperty,
  CustomShader,
  DirectionalLight,
  Entity,
  HeadingPitchRange,
  LightingModel,
  Math as CesiumMath,
  Matrix4,
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
import {
  worldPackCameraDurationSeconds,
  worldPackCameraFrame,
  type WorldPackCameraTimeline,
} from "@/world-packs/world-pack-cinematic";
import { WorldPackFilmRenderer } from "@/world-packs/world-pack-film-renderer";
import {
  createWorldPhysicsRuntime,
  type WorldPhysicsRuntime,
} from "@/world-packs/world-physics";
import type {
  VerifiedWorldPack,
  WorldPackLoadPhase,
} from "@/world-packs/world-pack-types";

export type PlayableEarthStatus =
  | { state: "loading"; title: string; message: string }
  | { state: "ready"; title: string; message: string }
  | { state: "unavailable"; title: string; message: string };

export interface PlayableEarthMountOptions {
  cinematicRender?: boolean;
  container: HTMLElement;
  route: QuestRoute;
  onStatus: (status: PlayableEarthStatus) => void;
  onGroundingChange?: (debug: PlayableEarthGroundingDebug) => void;
  onWorldReady?: (runtime: WorldPhysicsRuntime) => void;
}

export interface PlayableEarthGroundingDebug {
  source: "fallback" | "sampled";
  reason: "recorded" | "sampled" | "missing" | "outlier";
  offsetM?: number;
}

export interface PlayableEarthViewer {
  mount(options: PlayableEarthMountOptions): Promise<void>;
  setPose(pose: PlayableEarthPose): void;
  seekCinematic(seconds: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    __GODIESEL_PLAYABLE_EARTH_FACTORY__?: () => PlayableEarthViewer;
  }
}

const SURFACE_VISUAL_OFFSET_M = 2.2;

const WORLD_PALETTES: Record<
  string,
  { background: string; structures: string; surfaces: string; terrain: string }
> = {
  "banff-mountain": {
    background: "#a9c4cb",
    structures: "#b5b3a9",
    surfaces: "#c7a778",
    terrain: "#6e815d",
  },
  "tokyo-urban": {
    background: "#abc4c9",
    structures: "#abb2b5",
    surfaces: "#c8a174",
    terrain: "#66746c",
  },
  "ucluelet-coastal": {
    background: "#9fc2c9",
    structures: "#aeb4ae",
    surfaces: "#c3a678",
    terrain: "#4f7868",
  },
};

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

function terrainCustomShader(color: Color) {
  const low = [color.red * 0.72, color.green * 0.72, color.blue * 0.72];
  const high = [
    Math.min(1, color.red * 1.28),
    Math.min(1, color.green * 1.28),
    Math.min(1, color.blue * 1.28),
  ];
  return new CustomShader({
    lightingModel: LightingModel.PBR,
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 position = fsInput.attributes.positionMC;
        float broadRelief = 0.5 + 0.5 * sin(position.z * 0.035);
        float fineRelief = 0.5 + 0.5 * sin(position.z * 0.19);
        float northing = 0.5 + 0.5 * sin(position.y * 0.006);
        float mixAmount = clamp(0.16 + broadRelief * 0.54 + fineRelief * 0.12 + northing * 0.18, 0.0, 1.0);
        material.diffuse = mix(
          vec3(${low.map((value) => value.toFixed(6)).join(", ")}),
          vec3(${high.map((value) => value.toFixed(6)).join(", ")}),
          mixAmount
        );
        material.roughness = 0.88;
      }
    `,
  });
}

class CesiumPlayableEarthViewer implements PlayableEarthViewer {
  private viewer?: Viewer;
  private marker?: Entity;
  private ghostMarker?: Entity;
  private routeEntity?: Entity;
  private pack?: VerifiedWorldPack;
  private models: Model[] = [];
  private structureTilesets: Cesium3DTileset[] = [];
  private objectUrls: string[] = [];
  private abortController?: AbortController;
  private cameraHeadingDeg?: number;
  private cameraTimeline?: WorldPackCameraTimeline;
  private modelMatrix?: Matrix4;
  private cinematicSeekListener?: EventListener;
  private filmRenderer?: WorldPackFilmRenderer;
  private generation = 0;

  async mount({
    container,
    route,
    onStatus,
    onGroundingChange,
    onWorldReady,
    cinematicRender = false,
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
      this.cameraTimeline = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          pack.artifact(pack.runtime.assets.cameraTimeline),
        ),
      ) as WorldPackCameraTimeline;
      const physicsRuntime = createWorldPhysicsRuntime(pack);
      this.cinematicSeekListener = ((
        event: CustomEvent<{ seconds?: number }>,
      ) => {
        this.seekCinematic(Number(event.detail?.seconds ?? 0));
      }) as EventListener;
      window.addEventListener(
        "godiesel:world-pack-film-seek",
        this.cinematicSeekListener,
      );
      if (cinematicRender) {
        const canvas = document.createElement("canvas");
        canvas.setAttribute(
          "aria-label",
          "Deterministic local World Pack film",
        );
        canvas.className = "absolute inset-0 size-full";
        container.append(canvas);
        this.filmRenderer = new WorldPackFilmRenderer(
          canvas,
          route,
          physicsRuntime,
          this.cameraTimeline,
        );
        this.filmRenderer.render(0);
        onWorldReady?.(physicsRuntime);
        onGroundingChange?.({
          source: "sampled",
          reason: "sampled",
          offsetM: 0,
        });
        onStatus({
          state: "ready",
          title: "Deterministic local film ready",
          message: "The sealed World Pack camera and geometry are ready.",
        });
        return;
      }

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
      const palette =
        WORLD_PALETTES[pack.manifest.worldId] ??
        WORLD_PALETTES["banff-mountain"];
      viewer.scene.globe.show = false;
      if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
      viewer.scene.backgroundColor = Color.fromCssColorString(
        palette.background,
      );
      viewer.scene.light = new DirectionalLight({
        direction: Cartesian3.normalize(
          new Cartesian3(-0.55, -0.35, -0.76),
          new Cartesian3(),
        ),
        color: Color.fromCssColorString("#fff4d5"),
        intensity: 2.1,
      });
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
      this.modelMatrix = modelMatrix;
      const measuredTerrain = pack.runtime.assets.terrainMask !== undefined;
      viewer.canvas.dataset.cinematicDuration = String(
        worldPackCameraDurationSeconds(this.cameraTimeline),
      );
      viewer.canvas.dataset.cinematicTimeline = this.cameraTimeline.timelineId;
      await this.addModel(
        pack,
        pack.runtime.assets.terrain,
        modelMatrix,
        measuredTerrain
          ? Color.WHITE
          : Color.fromCssColorString(palette.terrain),
        measuredTerrain ? 0.04 : 0.82,
        measuredTerrain
          ? undefined
          : terrainCustomShader(Color.fromCssColorString(palette.terrain)),
      );
      await this.addModel(
        pack,
        pack.runtime.assets.traversableSurfaces,
        modelMatrix,
        Color.fromCssColorString(palette.surfaces),
        0.82,
      );
      for (const descriptor of pack.runtime.assets.structureTilesets ?? []) {
        const localUp = Cartesian3.normalize(origin, new Cartesian3());
        const translation = Cartesian3.multiplyByScalar(
          localUp,
          -descriptor.verticalAlignmentOffsetM,
          new Cartesian3(),
        );
        await this.addStructureTileset(
          pack,
          descriptor.path,
          Matrix4.fromTranslation(translation),
          palette.structures,
        );
      }
      if (generation !== this.generation) return;
      await this.waitForGeometryReady(generation);
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
            color: Color.fromCssColorString(ROUTE_THREAD_STYLE.color).withAlpha(
              0.98,
            ),
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
      this.ghostMarker = viewer.entities.add({
        name: "Recorded route ghost",
        show: false,
        position: Cartesian3.fromDegrees(
          start.longitude,
          start.latitude,
          start.elevationM + SURFACE_VISUAL_OFFSET_M,
        ),
        point: {
          pixelSize: 9,
          color: Color.fromCssColorString("#eef5ff").withAlpha(0.62),
          outlineColor: Color.fromCssColorString("#3379df").withAlpha(0.8),
          outlineWidth: 2,
          disableDepthTestDistance: 2_000,
        },
      });
      viewer.canvas.dataset.worldPackState = "ready";
      onWorldReady?.(physicsRuntime);
      onGroundingChange?.({ source: "sampled", reason: "sampled", offsetM: 0 });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (generation !== this.generation) return;
      onStatus({
        state: "ready",
        title: "Local World Pack ready",
        message:
          "Terrain, collision, route truth, and navigation are verified.",
      });
    } catch (error) {
      if (
        generation !== this.generation ||
        this.abortController?.signal.aborted
      )
        return;
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
    this.marker.show = pose.cameraMode !== "first-person";
    if (this.ghostMarker && pose.ghost) {
      this.ghostMarker.position = new ConstantPositionProperty(
        Cartesian3.fromDegrees(
          pose.ghost.lng,
          pose.ghost.lat,
          pose.ghost.elev + SURFACE_VISUAL_OFFSET_M,
        ),
      );
      this.ghostMarker.show = pose.ghost.visible;
    }
    if (this.cameraHeadingDeg === undefined) {
      this.cameraHeadingDeg = pose.cameraHeadingDeg;
    } else {
      const delta =
        ((pose.cameraHeadingDeg - this.cameraHeadingDeg + 540) % 360) - 180;
      this.cameraHeadingDeg =
        (this.cameraHeadingDeg + delta * 0.08 + 360) % 360;
    }
    viewer.canvas.dataset.cameraMode = pose.cameraMode;
    viewer.canvas.dataset.ghostVisible = String(pose.ghost?.visible ?? false);
    const heading = CesiumMath.toRadians(this.cameraHeadingDeg);
    if (pose.cameraMode === "first-person") {
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(
          pose.lng,
          pose.lat,
          pose.elev + 1.65,
        ),
        orientation: { heading, pitch: -0.08, roll: 0 },
      });
      return;
    }
    const chase = pose.cameraMode === "chase";
    const range = chase ? 26 : pose.cameraRangeM;
    const pitch = chase ? -0.24 : pose.cameraRangeM <= 240 ? -0.34 : -0.62;
    viewer.camera.lookAt(
      target,
      new HeadingPitchRange((heading + Math.PI) % (Math.PI * 2), pitch, range),
    );
  }

  seekCinematic(seconds: number) {
    if (this.filmRenderer) {
      this.filmRenderer.render(seconds);
      return;
    }
    const viewer = this.viewer;
    const timeline = this.cameraTimeline;
    const modelMatrix = this.modelMatrix;
    if (!viewer || !timeline || !modelMatrix || viewer.isDestroyed()) return;
    const frame = worldPackCameraFrame(timeline, seconds);
    const camera = Matrix4.multiplyByPoint(
      modelMatrix,
      Cartesian3.fromArray(frame.camera),
      new Cartesian3(),
    );
    const target = Matrix4.multiplyByPoint(
      modelMatrix,
      Cartesian3.fromArray(frame.target),
      new Cartesian3(),
    );
    const direction = Cartesian3.normalize(
      Cartesian3.subtract(target, camera, new Cartesian3()),
      new Cartesian3(),
    );
    const localUp = Matrix4.multiplyByPointAsVector(
      modelMatrix,
      Cartesian3.UNIT_Z,
      new Cartesian3(),
    );
    const right = Cartesian3.normalize(
      Cartesian3.cross(direction, localUp, new Cartesian3()),
      new Cartesian3(),
    );
    const up = Cartesian3.normalize(
      Cartesian3.cross(right, direction, new Cartesian3()),
      new Cartesian3(),
    );
    if (this.marker) this.marker.show = false;
    if (this.ghostMarker) this.ghostMarker.show = false;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.camera.setView({
      destination: camera,
      orientation: { direction, up },
    });
    viewer.canvas.dataset.cinematicFrame = frame.frame.toFixed(6);
    viewer.canvas.dataset.cinematicSeconds = seconds.toFixed(6);
    viewer.scene.requestRender();
  }

  private async addModel(
    pack: VerifiedWorldPack,
    logicalPath: string,
    modelMatrix: ReturnType<typeof Transforms.eastNorthUpToFixedFrame>,
    color: Color,
    colorBlendAmount: number,
    customShader?: CustomShader,
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
      colorBlendAmount,
      customShader,
      backFaceCulling: false,
    });
    this.viewer?.scene.primitives.add(model);
    this.models.push(model);
    return model;
  }

  private async addStructureTileset(
    pack: VerifiedWorldPack,
    logicalPath: string,
    modelMatrix: Matrix4,
    color: string,
  ) {
    const tileset = await Cesium3DTileset.fromUrl(
      pack.artifactUrl(logicalPath).toString(),
      {
        maximumScreenSpaceError: 2,
        preloadWhenHidden: true,
      },
    );
    tileset.modelMatrix = modelMatrix;
    tileset.style = new Cesium3DTileStyle({ color: `color('${color}')` });
    this.viewer?.scene.primitives.add(tileset);
    this.structureTilesets.push(tileset);
    return tileset;
  }

  private async waitForGeometryReady(generation: number) {
    for (let frame = 0; frame < 600; frame += 1) {
      if (generation !== this.generation) return;
      if (
        this.models.every((model) => model.ready) &&
        this.structureTilesets.every((tileset) => tileset.tilesLoaded)
      ) {
        return;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    throw new Error("Local World Pack geometry did not become render-ready.");
  }

  private destroyResources() {
    this.filmRenderer?.destroy();
    if (this.cinematicSeekListener) {
      window.removeEventListener(
        "godiesel:world-pack-film-seek",
        this.cinematicSeekListener,
      );
    }
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
    this.marker = undefined;
    this.ghostMarker = undefined;
    this.routeEntity = undefined;
    this.pack = undefined;
    this.models = [];
    this.structureTilesets = [];
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.cameraHeadingDeg = undefined;
    this.cameraTimeline = undefined;
    this.modelMatrix = undefined;
    this.cinematicSeekListener = undefined;
    this.filmRenderer = undefined;
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
