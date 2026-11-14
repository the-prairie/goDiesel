// The real-geometry sketch: Google's Photorealistic 3D Tiles in our own
// Cesium, drawn as the sketch by a post-process shader. Loaded lazily, only
// when the hand-over starts, so Cesium never weighs on the first load.
//
// The camera is never its own: MapLibre stays the master and this view is
// told where to stand (see sketch-camera-match), so the two never drift.
// Google's attribution is shown by Cesium (`showCreditsOnScreen`), never
// covered. Nothing derived from the tiles is kept: the in-memory cache is
// modest and `destroy` lets it all go.

import {
  Cartesian3,
  Cartesian4,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  PostProcessStage,
  Transforms,
  Viewer,
  createGooglePhotorealistic3DTileset,
  type Cesium3DTileset,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { CesiumCameraPose } from "@/labs/sketch/sketch-camera-match";
import { MAX_SEGMENTS, nearestSegments } from "@/labs/sketch/sketch-real-corridor";
import { SKETCH_REAL_SHADER } from "@/labs/sketch/sketch-real-shader";

export interface RealSketchOptions {
  container: HTMLElement;
  apiKey: string;
  /** Her routes as [lng, lat] lines, for the corridor. */
  lines: [number, number][][];
  /** How far colour reaches from her routes, in metres (0: none), and whether it fades. */
  radiusM: number;
  soft: boolean;
  paper: [number, number, number];
  ink: [number, number, number];
  /** Coarser on a phone: fewer, lighter tiles and a quicker first view. */
  maximumScreenSpaceError: number;
  onFirstView: () => void;
  onFailed: () => void;
}

export interface RealSketchView {
  setCamera(pose: CesiumCameraPose): void;
  setCorridor(radiusM: number, soft: boolean): void;
  /** Colour flooding back everywhere, 0 (sketch) to 1 (Google's own colour). */
  setFlood(value: number): void;
  stats(): { tilesetBytes: number };
  destroy(): void;
}

export type RealSketchFactory = (options: RealSketchOptions) => RealSketchView;

declare global {
  interface Window {
    /** A test stand-in for the real view (e2e), so no Google tiles are loaded. */
    __GODIESEL_SKETCH_REAL_FACTORY__?: RealSketchFactory;
  }
}

export const createRealSketchView: RealSketchFactory = (options) => {
  const { container, apiKey, lines } = options;
  let radius = options.radiusM;
  let soft = options.soft ? 1 : 0;
  let flood = 0;
  let destroyed = false;
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
    // Only draw when told: MapLibre moves, this follows.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  viewer.scene.globe.show = false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
  viewer.scene.fog.enabled = false;
  viewer.scene.screenSpaceCameraController.enableInputs = false;

  // Her routes on a local ground plane round the first route's start, in metres.
  const origin = lines[0]?.[0] ?? [0, 0];
  const local = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin[0], origin[1], 0));
  const toLocal = Matrix4.inverseTransformation(local, new Matrix4());
  const localLines = lines.map((line) =>
    line.map((point): [number, number] => {
      const p = Matrix4.multiplyByPoint(toLocal, Cartesian3.fromDegrees(point[0], point[1], 0), new Cartesian3());
      return [p.x, p.y];
    }),
  );
  const segments = Array.from({ length: MAX_SEGMENTS }, () => new Cartesian4());
  let segmentCount = 0;
  const eyeToLocal = new Matrix4();
  const updateSegments = () => {
    const centre = Matrix4.multiplyByPoint(toLocal, viewer.camera.positionWC, new Cartesian3());
    const nearest = nearestSegments(localLines, [centre.x, centre.y]);
    segmentCount = nearest.length;
    nearest.forEach(([ax, ay, bx, by], index) => Cartesian4.fromElements(ax, ay, bx, by, segments[index]));
  };
  const stage = new PostProcessStage({
    fragmentShader: SKETCH_REAL_SHADER,
    uniforms: {
      u_flood: () => flood,
      u_radius: () => radius,
      u_soft: () => soft,
      u_segmentCount: () => segmentCount,
      u_segments: () => segments,
      u_eyeToLocal: () => Matrix4.multiply(toLocal, viewer.camera.inverseViewMatrix, eyeToLocal),
      u_paper: () => new Cartesian3(...options.paper),
      u_ink: () => new Cartesian3(...options.ink),
    },
  });
  viewer.scene.postProcessStages.add(stage);

  let tileset: Cesium3DTileset | undefined;
  createGooglePhotorealistic3DTileset(
    { key: apiKey, onlyUsingWithGoogleGeocoder: true },
    {
      // Google's logo and the data attributions from the tiles, on screen.
      showCreditsOnScreen: true,
      maximumScreenSpaceError: options.maximumScreenSpaceError,
      // A modest in-memory cache for one neighbourhood; nothing is kept beyond it.
      cacheBytes: 256 * 1024 * 1024,
      maximumCacheOverflowBytes: 64 * 1024 * 1024,
    },
  )
    .then((loaded) => {
      if (destroyed) {
        loaded.destroy();
        return;
      }
      tileset = loaded;
      viewer.scene.primitives.add(loaded);
      // The first view counts as drawn once nearly every tile it asked for
      // has come and none is still being processed: the last few, far
      // towards the horizon, fill in under the fade.
      let first = true;
      let loadedTiles = 0;
      const drawn = () => {
        if (!first || destroyed) return;
        first = false;
        options.onFirstView();
      };
      loaded.tileLoad.addEventListener(() => (loadedTiles += 1));
      loaded.loadProgress.addEventListener((pending: number, processing: number) => {
        if (loadedTiles >= 24 && pending <= 6 && processing === 0) drawn();
      });
      loaded.allTilesLoaded.addEventListener(drawn);
      loaded.tileFailed.addEventListener(() => {
        if (first && !destroyed) options.onFailed();
      });
      viewer.scene.requestRender();
    })
    .catch(() => {
      if (!destroyed) options.onFailed();
    });

  return {
    setCamera(pose) {
      if (destroyed) return;
      const frustum = viewer.camera.frustum;
      if (frustum instanceof PerspectiveFrustum) frustum.fov = CesiumMath.toRadians(pose.fovDeg);
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(pose.lng, pose.lat, pose.heightM),
        orientation: { heading: CesiumMath.toRadians(pose.headingDeg), pitch: CesiumMath.toRadians(pose.pitchDeg), roll: 0 },
      });
      updateSegments();
      viewer.scene.requestRender();
    },
    setCorridor(nextRadius, nextSoft) {
      radius = nextRadius;
      soft = nextSoft ? 1 : 0;
      viewer.scene.requestRender();
    },
    setFlood(value) {
      flood = Math.min(1, Math.max(0, value));
      viewer.scene.requestRender();
    },
    stats() {
      return { tilesetBytes: tileset?.totalMemoryUsageInBytes ?? 0 };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Destroying the viewer destroys its primitives, the tileset with them,
      // and frees their GPU memory; the container is emptied by the caller.
      viewer.destroy();
      tileset = undefined;
    },
  };
};
