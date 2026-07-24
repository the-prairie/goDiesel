import type { QuestRoute } from "@/domain/routes";
import type { CinematicRendererStatus } from "@/replay/cinematic/cesium-cinematic-renderer";
import type { CinematicFrame } from "@/replay/cinematic/route-cinematic-director";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
} from "@/replay/google/google-route-navigator-engine";
import type { GoogleRouteCameraPose } from "@/replay/google-route-navigator-controller";

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

  async mount({ container, route, frame, onStatus }: MountOptions) {
    container.dataset.cinematicState = "loading";
    const engine = createGoogleRouteNavigatorEngine();
    this.engine = engine;
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
        color: "#f16c4b",
        outerColor: "#f8f4ea",
        outerWidth: 0.42,
        width: 7,
      },
    });
    this.setFrame(frame);
  }

  setFrame(frame: CinematicFrame) {
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

    if (!isChapterCut && !isSeek && elapsedDelta < 1 / 15) return;

    const camera =
      !this.renderedCamera || isChapterCut || isSeek
        ? desired
        : stabilizeCamera(this.renderedCamera, desired, elapsedDelta);
    this.renderedCamera = camera;
    this.lastElapsedSeconds = frame.elapsedSeconds;
    this.lastChapter = frame.chapter;
    this.lastCut = frame.cut;
    this.engine?.setCamera(camera);
    this.engine?.setRouteReveal(frame.threadEndRatio);
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

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function interpolateHeading(start: number, end: number, amount: number) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * amount + 360) % 360;
}

export function stabilizeCamera(
  current: GoogleRouteCameraPose,
  desired: GoogleRouteCameraPose,
  elapsedSeconds: number,
): GoogleRouteCameraPose {
  const amount = 1 - Math.exp(-Math.max(0, elapsedSeconds) / 0.2);
  return {
    center: {
      lat: interpolate(current.center.lat, desired.center.lat, amount),
      lng: interpolate(current.center.lng, desired.center.lng, amount),
    },
    fovDeg: interpolate(current.fovDeg, desired.fovDeg, amount),
    headingDeg: interpolateHeading(
      current.headingDeg,
      desired.headingDeg,
      amount,
    ),
    progressM: interpolate(current.progressM, desired.progressM, amount),
    rangeM: interpolate(current.rangeM, desired.rangeM, amount),
    tiltDeg: interpolate(current.tiltDeg, desired.tiltDeg, amount),
  };
}
