import type { QuestRoute } from "@/domain/routes";
import type { CinematicRendererStatus } from "@/surfaces/replay/cinematic/cesium-cinematic-renderer";
import type { CinematicFrame } from "@/surfaces/replay/cinematic/route-cinematic-director";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import { routeDistanceM } from "@/domain/geometry/route-path";
import { stabilizeRouteCamera } from "@/surfaces/replay/scene/route-camera-stabilizer";

interface MountOptions {
  container: HTMLElement;
  frame: CinematicFrame;
  onStatus: (status: CinematicRendererStatus) => void;
  route: QuestRoute;
}

export class NativeCinematicRenderer {
  private engine?: GoogleRouteNavigatorEngine;
  private renderedCamera?: GoogleRouteCameraPose;
  private lastElapsedSeconds?: number;
  private lastChapter?: string;
  private lastCut?: CinematicFrame["cut"];
  private totalDistanceM = 1;

  async mount({ container, route, frame, onStatus }: MountOptions) {
    container.dataset.cinematicState = "loading";
    const engine = createGoogleRouteNavigatorEngine();
    this.engine = engine;
    this.totalDistanceM = Math.max(1, routeDistanceM(route));
    await engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: "mesh",
      headingSmoothing: 1,
      onStatus: (status) => {
        container.dataset.cinematicState = status.state;
        onStatus(status);
      },
      routeStyle: {
        color: "#f49a70",
        mode: "filament",
        outerColor: "transparent",
        outerWidth: 0,
        width: 2,
      },
    });
    this.setFrame(frame);
  }

  setFrame(frame: CinematicFrame, force = false) {
    const desired: GoogleRouteCameraPose = {
      center: { lat: frame.target.lat, lng: frame.target.lng },
      fovDeg: focalLengthToFieldOfView(frame.lensMm),
      headingDeg: frame.headingDeg,
      progressM: frame.routeProgressM,
      rangeM: frame.rangeM,
      tiltDeg: Math.min(82, Math.max(18, 90 + frame.pitchDeg)),
    };
    const elapsedDelta =
      this.lastElapsedSeconds === undefined
        ? Number.POSITIVE_INFINITY
        : frame.elapsedSeconds - this.lastElapsedSeconds;
    const isChapterCut =
      frame.chapter !== this.lastChapter || frame.cut !== this.lastCut;
    const isSeek =
      elapsedDelta < 0 || elapsedDelta > 0.75 || !Number.isFinite(elapsedDelta);

    if (!force && !isChapterCut && !isSeek && elapsedDelta < 1 / 15) return;

    const camera =
      !this.renderedCamera || isChapterCut || isSeek
        ? desired
        : stabilizeRouteCamera(
            this.renderedCamera,
            desired,
            elapsedDelta,
            frame.cameraResponseSeconds,
          );
    this.renderedCamera = camera;
    this.lastElapsedSeconds = frame.elapsedSeconds;
    this.lastChapter = frame.chapter;
    this.lastCut = frame.cut;
    this.engine?.setCamera(camera);
    this.engine?.setCinematicRoute({
      endRatio: frame.threadEndRatio,
      focusRatio: frame.routeProgressM / this.totalDistanceM,
      motionIntensity: frame.motionIntensity,
      rangeM: frame.rangeM,
      shotKind: frame.shotKind,
      startRatio: frame.threadStartRatio,
    });
  }

  setInteractive(enabled: boolean) {
    this.engine?.setFollowing(!enabled);
  }

  destroy() {
    this.engine?.destroy();
    this.engine = undefined;
    this.renderedCamera = undefined;
    this.lastElapsedSeconds = undefined;
    this.lastChapter = undefined;
    this.lastCut = undefined;
    this.totalDistanceM = 1;
  }
}

function focalLengthToFieldOfView(focalLengthMm: number) {
  const fullFrameSensorWidthMm = 36;
  const fieldOfView =
    (2 *
      Math.atan(fullFrameSensorWidthMm / (2 * Math.max(18, focalLengthMm))) *
      180) /
    Math.PI;
  return Math.min(68, Math.max(24, fieldOfView));
}

export { stabilizeRouteCamera as stabilizeCamera } from "@/surfaces/replay/scene/route-camera-stabilizer";
