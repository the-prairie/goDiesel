import {
  CallbackProperty,
  Cartesian3,
  Cesium3DTileset,
  ClassificationType,
  Color,
  HeadingPitchRange,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  PostProcessStage,
  PostProcessStageLibrary,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import type { QuestRoute } from "@/domain/routes";
import type { CinematicFrame } from "@/replay/cinematic/route-cinematic-director";
import {
  GOOGLE_3D_TILES_RENDER_OPTIONS,
} from "@/replay/cesium/cesium-render-quality";
import { routeDistanceM, routePathPose } from "@/replay/route-path";

export type CinematicRendererStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; message: string }
  | { state: "partial"; message: string }
  | { state: "unavailable"; message: string };

interface MountOptions {
  container: HTMLElement;
  frame: CinematicFrame;
  onStatus: (status: CinematicRendererStatus) => void;
  route: QuestRoute;
}

const GRADE_SHADER = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform float vignette;

void main() {
  vec4 source = texture(colorTexture, v_textureCoordinates);
  vec3 color = source.rgb * exposure;
  color = (color - 0.5) * contrast + 0.5;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, saturation);
  vec2 centered = v_textureCoordinates - vec2(0.5);
  float edge = smoothstep(0.22, 0.72, dot(centered, centered) * 1.8);
  color *= 1.0 - edge * vignette;
  out_FragColor = vec4(color, source.a);
}
`;

function routeSegmentPositions(
  route: QuestRoute,
  startRatio: number,
  endRatio: number,
) {
  const totalM = routeDistanceM(route);
  const startM = totalM * startRatio;
  const endM = totalM * endRatio;
  const points = route.route.filter(
    (point) => point.d >= startM && point.d <= endM,
  );
  const start = routePathPose(route, startM);
  const end = routePathPose(route, endM);
  return [
    Cartesian3.fromDegrees(start.lng, start.lat, start.elev + 1.5),
    ...points.map((point) =>
      Cartesian3.fromDegrees(point.lng, point.lat, point.elev + 1.5),
    ),
    Cartesian3.fromDegrees(end.lng, end.lat, end.elev + 1.5),
  ];
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export class CesiumCinematicRenderer {
  private viewer?: Viewer;
  private route?: QuestRoute;
  private frame?: CinematicFrame;
  private grade?: PostProcessStage;
  private depthOfField?: ReturnType<
    typeof PostProcessStageLibrary.createDepthOfFieldStage
  >;
  private generation = 0;

  async mount({ container, route, frame, onStatus }: MountOptions) {
    const generation = ++this.generation;
    this.route = route;
    this.frame = frame;
    container.dataset.cinematicState = "loading";
    onStatus({
      state: "loading",
      message: "Scouting the recorded landscape and staging the first shot.",
    });

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey || route.route.length < 2 || !webglAvailable()) {
      container.dataset.cinematicState = "unavailable";
      onStatus({
        state: "unavailable",
        message: apiKey
          ? "This route cannot be staged in the 3D renderer."
          : "A Google Map Tiles browser key is required.",
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
      viewer.scene.globe.show = false;
      viewer.scene.highDynamicRange = viewer.scene.highDynamicRangeSupported;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      viewer.scene.fog.enabled = true;

      const tileset = await Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`,
        {
          showCreditsOnScreen: true,
          ...GOOGLE_3D_TILES_RENDER_OPTIONS,
          maximumScreenSpaceError: 10,
          enableCollision: true,
        },
      );
      if (generation !== this.generation) {
        viewer.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);

      const positions = new CallbackProperty(
        () =>
          this.route && this.frame
            ? routeSegmentPositions(
                this.route,
                this.frame.threadStartRatio,
                this.frame.threadEndRatio,
              )
            : [],
        false,
      );
      viewer.entities.add({
        name: `${route.name} route aura`,
        polyline: {
          positions,
          width: 15,
          clampToGround: true,
          classificationType: ClassificationType.CESIUM_3D_TILE,
          material: new PolylineGlowMaterialProperty({
            color: Color.fromCssColorString("#f8f4ea").withAlpha(0.54),
            glowPower: 0.24,
          }),
        },
      });
      viewer.entities.add({
        name: `${route.name} route thread`,
        polyline: {
          positions,
          width: 6,
          clampToGround: true,
          classificationType: ClassificationType.CESIUM_3D_TILE,
          material: new PolylineGlowMaterialProperty({
            color: Color.fromCssColorString("#f16c4b").withAlpha(0.98),
            glowPower: 0.16,
          }),
        },
      });

      this.grade = viewer.scene.postProcessStages.add(
        new PostProcessStage({
          name: "goDiesel cinematic grade",
          fragmentShader: GRADE_SHADER,
          uniforms: {
            exposure: () => this.frame?.look.exposure ?? 1,
            contrast: () => this.frame?.look.contrast ?? 1,
            saturation: () => this.frame?.look.saturation ?? 1,
            vignette: () => this.frame?.look.vignette ?? 0,
          },
        }),
      ) as PostProcessStage;
      if (PostProcessStageLibrary.isDepthOfFieldSupported(viewer.scene)) {
        const depthOfField = viewer.scene.postProcessStages.add(
          PostProcessStageLibrary.createDepthOfFieldStage(),
        ) as ReturnType<typeof PostProcessStageLibrary.createDepthOfFieldStage>;
        depthOfField.enabled = false;
        this.depthOfField = depthOfField;
      }

      this.setFrame(frame);
      await Promise.race([
        new Promise<void>((resolve) => {
          if (tileset.tilesLoaded) resolve();
          const remove = tileset.allTilesLoaded.addEventListener(() => {
            remove();
            resolve();
          });
        }),
        new Promise<void>((resolve) => window.setTimeout(resolve, 8_000)),
      ]);
      if (generation !== this.generation) return;
      container.dataset.cinematicState = "ready";
      onStatus({
        state: "ready",
        message: "The real route world is staged.",
      });
    } catch (error) {
      console.warn("Cinematic director unavailable", error);
      if (generation !== this.generation) return;
      container.dataset.cinematicState = "unavailable";
      onStatus({
        state: "unavailable",
        message: "Photorealistic tiles could not stage this route.",
      });
      this.destroy();
    }
  }

  setFrame(frame: CinematicFrame) {
    this.frame = frame;
    const viewer = this.viewer;
    if (!viewer) return;

    const destination = Cartesian3.fromDegrees(
      frame.target.lng,
      frame.target.lat,
      frame.target.elev + Math.max(4, frame.rangeM * 0.015),
    );
    viewer.camera.lookAt(
      destination,
      new HeadingPitchRange(
        CesiumMath.toRadians(frame.headingDeg),
        CesiumMath.toRadians(frame.pitchDeg),
        frame.rangeM,
      ),
    );
    viewer.scene.fog.density = 0.00012 + frame.look.fog * 0.0004;
    viewer.scene.postProcessStages.bloom.enabled = frame.look.bloom > 0.1;
    const bloomUniforms = viewer.scene.postProcessStages.bloom.uniforms;
    bloomUniforms.glowOnly = false;
    bloomUniforms.contrast = 110 + frame.look.bloom * 35;
    bloomUniforms.brightness = -0.22;
    bloomUniforms.delta = 0.8;
    bloomUniforms.sigma = 2.8;
    bloomUniforms.stepSize = 1.2;
    if (this.depthOfField) {
      this.depthOfField.enabled = frame.look.depthOfField > 0.08;
      this.depthOfField.uniforms.focalDistance = Math.max(30, frame.rangeM * 0.68);
      this.depthOfField.uniforms.delta = 1;
      this.depthOfField.uniforms.sigma = 2;
      this.depthOfField.uniforms.stepSize =
        1.1 + frame.look.depthOfField * 1.8;
    }
    viewer.scene.requestRender();
  }

  setInteractive(enabled: boolean) {
    const controller = this.viewer?.scene.screenSpaceCameraController;
    if (!controller) return;
    controller.enableInputs = enabled;
  }

  destroy() {
    this.generation += 1;
    const viewer = this.viewer;
    this.viewer = undefined;
    this.route = undefined;
    this.frame = undefined;
    this.grade = undefined;
    this.depthOfField = undefined;
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
  }
}
