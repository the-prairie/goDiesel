import { attachRoutePositionMarker } from "./route-position-marker";
import {
  buildCinematicThreadStyles,
  slicePathByRatio,
  type CinematicFilamentRole,
  type CinematicRouteTreatment,
} from "@/surfaces/replay/cinematic/cinematic-route-filament";
import {
  densifyGoogleRoutePath,
  type GoogleRouteCameraPose,
  type GoogleRouteGroundingMode,
  type GoogleRouteGeometry,
} from "@/surfaces/replay/playback/route-navigator-controller";
import { ProviderError, providerFailureMessage } from "@/providers/provider-error";
import { loadGoogleMaps } from "@/providers/google-maps-loader";

import {
  initialGoogleRendererState,
  reduceGoogleRenderer,
  type GoogleRendererEvent,
  type GoogleRouteNavigatorStatus,
} from "@/surfaces/replay/renderers/google-renderer-state";

export type { GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-renderer-state";

interface MountOptions {
  apiKey: string;
  container: HTMLElement;
  route: GoogleRouteGeometry;
  groundingMode: GoogleRouteGroundingMode;
  initialCamera?: GoogleRouteCameraPose;
  onStatus: (status: GoogleRouteNavigatorStatus) => void;
  routeStyle?: {
    color: string;
    mode?: "filament" | "hidden" | "solid";
    palette?: "neutral" | "immersive";
    outerColor: string;
    outerWidth: number;
    width: number;
  };
  headingSmoothing?: number;
}

export interface GoogleRouteNavigatorEngine {
  mount(options: MountOptions): Promise<void>;
  readCamera(): Omit<GoogleRouteCameraPose, "progressM"> | undefined;
  setCamera(pose: GoogleRouteCameraPose): void;
  setFollowing(following: boolean): void;
  setGrounding(mode: GoogleRouteGroundingMode): void;
  setCinematicRoute(treatment: CinematicRouteTreatment): void;
  setRouteReveal(progress: number): void;
  destroy(): void;
}

declare global {
  interface Window {
    __GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?: () => GoogleRouteNavigatorEngine;
  }
}

interface FilamentLayer {
  element: google.maps.maps3d.Polyline3DElement;
  endRatio: number;
  role: CinematicFilamentRole;
  startRatio: number;
}

const FILAMENT_CLEARANCE_M: Record<CinematicFilamentRole, number> = {
  guide: 0.1,
  future: 0.14,
  thread: 0.2,
  glint: 0.24,
};

const INTERACTIVE_PALETTES = {
  neutral: {
    colors: { guide: "#a7b5bc", future: "#a7b5bc", thread: "#f5f5f5", glint: "#ffffff" },
    widths: { guide: 2, future: 2, thread: 3.5, glint: 4.5 },
    clearanceM: FILAMENT_CLEARANCE_M,
    outerColor: "#182126",
    outerWidth: 0.22,
  },
  immersive: {
    colors: { guide: "#f5f1e4", future: "#f5f1e4", thread: "rgba(210, 198, 167, 0.72)", glint: "#fffdf5" },
    widths: { guide: 2, future: 2.75, thread: 2, glint: 4 },
    clearanceM: { guide: 1.25, future: 1.25, thread: 1.25, glint: 1.25 },
    outerColor: "rgba(20, 27, 29, 0.65)",
    outerWidth: 0.18,
  },
} as const;

type InteractivePalette = keyof typeof INTERACTIVE_PALETTES;

const GOOGLE_SCENE_READY_TIMEOUT_MS = 30_000;

function waitForGoogleSceneReady(map: google.maps.maps3d.Map3DElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new ProviderError("Google photorealistic 3D did not finish loading."));
    }, GOOGLE_SCENE_READY_TIMEOUT_MS);
    const onSteady = (event: Event) => {
      if (!(event as google.maps.maps3d.SteadyChangeEvent).isSteady) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new ProviderError("Google photorealistic 3D could not render this scene."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Google scene disposed.", "AbortError"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      map.removeEventListener("gmp-steadychange", onSteady);
      map.removeEventListener("gmp-error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    map.addEventListener("gmp-steadychange", onSteady);
    map.addEventListener("gmp-error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class BrowserGoogleRouteNavigatorEngine implements GoogleRouteNavigatorEngine {
  private map?: google.maps.maps3d.Map3DElement;
  private routeLine?: google.maps.maps3d.Polyline3DElement;
  private disposeMarker?: () => void;
  private positionMarker?: google.maps.maps3d.MarkerElement;
  private filamentLayers: FilamentLayer[] = [];
  private routePath: Array<{ lat: number; lng: number; d: number }> = [];
  private palette?: InteractivePalette;
  private routeDistanceM = 1;
  private routeWidth = 8;
  private following = true;
  private headingDeg?: number;
  private headingSmoothing = 0.14;
  private lifecycle = initialGoogleRendererState();
  private mountController?: AbortController;

  async mount({
    apiKey,
    container,
    route,
    groundingMode,
    initialCamera,
    onStatus,
    routeStyle,
    headingSmoothing,
  }: MountOptions) {
    this.destroy();
    const { operationId } = this.transition({ type: "mountStarted" }, onStatus);
    this.headingSmoothing = headingSmoothing ?? 0.14;
    this.palette = routeStyle?.palette;
    if (!apiKey) {
      this.transition({ type: "inputsRejected", operationId, reason: "key" }, onStatus);
      return;
    }
    if (route.route.length < 2) {
      this.transition({ type: "inputsRejected", operationId, reason: "geometry" }, onStatus);
      return;
    }

    try {
      const controller = new AbortController();
      this.mountController = controller;
      const authFailure = () => {
        this.transition({ type: "authenticationRejected", operationId }, onStatus);
      };
      window.addEventListener(
        "godiesel:google-maps-auth-failure",
        authFailure,
        { signal: controller.signal },
      );
      await loadGoogleMaps(apiKey);
      const {
        AltitudeMode,
        GestureHandling,
        Map3DElement,
        MapMode,
        MarkerElement,
        Polyline3DElement,
      } = (await google.maps.importLibrary("maps3d")) as google.maps.Maps3DLibrary;
      this.transition({ type: "apiLoaded", operationId }, onStatus);
      if (operationId !== this.lifecycle.operationId || this.lifecycle.phase !== "loadingScene") return;

      const first = route.route[0];
      const map = new Map3DElement({
        center: initialCamera?.center ?? { lat: first.lat, lng: first.lng },
        range: initialCamera?.rangeM ?? 115,
        tilt: initialCamera?.tiltDeg ?? 72,
        heading: initialCamera?.headingDeg ?? 0,
        fov: initialCamera?.fovDeg ?? 54,
        mode: MapMode.SATELLITE,
        gestureHandling: GestureHandling.GREEDY,
        defaultUIHidden: true,
        maxTilt: 78,
        description: `Interactive 3D navigation along ${route.name}`,
      });
      map.style.width = "100%";
      map.style.height = "100%";
      map.dataset.testid = "google-route-map";
      map.addEventListener("gmp-error", () => {
        this.transition({ type: "sceneErrored", operationId }, onStatus);
      }, { signal: controller.signal });

      const routePath = densifyGoogleRoutePath(route);
      const altitudeMode =
        groundingMode === "mesh"
          ? AltitudeMode.RELATIVE_TO_MESH
          : this.palette === "immersive"
            ? AltitudeMode.RELATIVE_TO_GROUND
            : AltitudeMode.CLAMP_TO_GROUND;
      let routeLine: google.maps.maps3d.Polyline3DElement | undefined;
      if (routeStyle?.mode === "hidden") {
        routeLine = undefined;
      } else if (routeStyle?.mode === "filament") {
        this.filamentLayers = createFilamentLayers({
          Polyline3DElement,
          altitudeMode,
          map,
          routePath,
          roles: routeStyle.palette === "immersive"
            ? ["future", "thread", "glint"]
            : ["guide", "future", "thread", "glint"],
        });
        if (routeStyle.palette === "immersive") {
          const marker = new MarkerElement({
            position: { lat: first.lat, lng: first.lng, altitude: 1.6 },
            altitudeMode,
            anchorTop: "-50%",
            title: "Current route position",
          });
          this.disposeMarker = attachRoutePositionMarker(marker);
          marker.style.pointerEvents = "none";
          marker.dataset.testid = "replay-position-marker";
          map.append(marker);
          this.positionMarker = marker;
        }
      } else {
        routeLine = new Polyline3DElement({
          path: routePath,
          strokeColor: routeStyle?.color ?? "#1c5bb8",
          outerColor: routeStyle?.outerColor ?? "#f8f5ed",
          strokeWidth: routeStyle?.width ?? 8,
          outerWidth: routeStyle?.outerWidth ?? 0.34,
          altitudeMode,
          drawsOccludedSegments: false,
          geodesic: false,
          zIndex: 10,
        });
        map.append(routeLine);
      }
      container.replaceChildren(map);
      this.map = map;
      this.routeLine = routeLine;
      this.routePath = routePath;
      this.routeDistanceM = Math.max(1, route.distanceKm * 1_000, route.route.at(-1)?.d ?? 0);
      this.routeWidth = routeStyle?.width ?? 8;
      await waitForGoogleSceneReady(map, controller.signal);
      this.transition({ type: "sceneReady", operationId }, onStatus);
    } catch (error) {
      if (operationId !== this.lifecycle.operationId) return;
      this.transition({
        type: "operationFailed", operationId,
        message: providerFailureMessage(
          error,
          "Google photorealistic 3D could not start in this browser.",
        ),
      }, onStatus);
    }
  }

  private transition(event: GoogleRendererEvent, onStatus?: MountOptions["onStatus"]) {
    const previousStatus = this.lifecycle.status;
    this.lifecycle = reduceGoogleRenderer(this.lifecycle, event);
    if (this.lifecycle.status && this.lifecycle.status !== previousStatus) {
      onStatus?.(this.lifecycle.status);
    }
    return this.lifecycle;
  }

  readCamera(): Omit<GoogleRouteCameraPose, "progressM"> | undefined {
    const map = this.map;
    const center = map?.center;
    if (!map || !center) return undefined;
    return {
      center: { lat: center.lat, lng: center.lng, altitude: center.altitude },
      headingDeg: map.heading ?? 0,
      rangeM: map.range ?? 0,
      tiltDeg: map.tilt ?? 0,
      fovDeg: map.fov ?? 54,
    };
  }

  setCamera(pose: GoogleRouteCameraPose) {
    if (!this.map || !this.following) return;
    this.headingDeg =
      this.headingDeg === undefined
        ? pose.headingDeg
        : smoothMapHeading(
            this.headingDeg,
            pose.headingDeg,
            this.headingSmoothing,
          );
    this.map.center = pose.center;
    this.map.heading = this.headingDeg;
    this.map.range = pose.rangeM;
    this.map.tilt = pose.tiltDeg;
    this.map.fov = pose.fovDeg;
  }

  setFollowing(following: boolean) {
    if (following && !this.following) this.headingDeg = this.map?.heading ?? undefined;
    this.following = following;
  }

  setGrounding(mode: GoogleRouteGroundingMode) {
    if (!window.google?.maps?.maps3d?.AltitudeMode) return;
    const altitudeMode =
      mode === "mesh"
        ? google.maps.maps3d.AltitudeMode.RELATIVE_TO_MESH
        : this.palette === "immersive"
          ? google.maps.maps3d.AltitudeMode.RELATIVE_TO_GROUND
          : google.maps.maps3d.AltitudeMode.CLAMP_TO_GROUND;
    if (this.routeLine) this.routeLine.altitudeMode = altitudeMode;
    if (this.positionMarker) this.positionMarker.altitudeMode = altitudeMode;
    this.filamentLayers.forEach(({ element }) => {
      element.altitudeMode = altitudeMode;
    });
  }

  setCinematicRoute(treatment: CinematicRouteTreatment) {
    if (this.filamentLayers.length === 0 || this.routePath.length < 2) return;
    const firstDistanceM = this.routePath[0].d;
    const recordedDistanceM = this.routePath.at(-1)!.d - firstDistanceM;
    const pathRatio = (ratio: number) => recordedDistanceM > 0
      ? Math.min(1, Math.max(0, (ratio * this.routeDistanceM - firstDistanceM) / recordedDistanceM))
      : ratio;
    const visibleTreatment = this.palette === "immersive" ? {
      ...treatment,
      startRatio: pathRatio(treatment.startRatio),
      focusRatio: pathRatio(treatment.focusRatio),
      endRatio: pathRatio(treatment.endRatio),
    } : treatment;
    if (this.positionMarker) {
      const position = slicePathByRatio(this.routePath, visibleTreatment.focusRatio, visibleTreatment.focusRatio)[0];
      this.positionMarker.position = { ...position, altitude: 1.6 };
    }
    const styles = buildCinematicThreadStyles(
      visibleTreatment,
      this.routeDistanceM,
    );
    const palette = this.palette ? INTERACTIVE_PALETTES[this.palette] : undefined;
    for (const layer of this.filamentLayers) {
      const style = styles.find(({ role }) => role === layer.role);
      if (style && this.palette === "immersive" && layer.role === "glint") {
        style.startRatio = Math.max(visibleTreatment.startRatio, visibleTreatment.focusRatio - 24 / Math.max(1, recordedDistanceM));
        style.endRatio = visibleTreatment.focusRatio;
      }
      if (!style || style.endRatio <= style.startRatio) {
        setLineVisibility(layer.element, false);
        continue;
      }
      if (
        (this.palette === "immersive" && layer.role === "glint" && layer.endRatio !== style.endRatio) ||
        Math.abs(layer.startRatio - style.startRatio) > 0.0001 ||
        Math.abs(layer.endRatio - style.endRatio) > 0.0001
      ) {
        layer.element.path = slicePathByRatio(
          this.routePath,
          style.startRatio,
          style.endRatio,
        ).map((point) => ({
          ...point,
          altitude: palette?.clearanceM[layer.role] ?? FILAMENT_CLEARANCE_M[layer.role],
        }));
        layer.startRatio = style.startRatio;
        layer.endRatio = style.endRatio;
      }
      layer.element.strokeColor = palette?.colors[layer.role] ?? style.color;
      layer.element.strokeWidth = palette?.widths[layer.role] ?? style.width;
      layer.element.outerColor = palette?.outerColor ?? style.outerColor;
      layer.element.outerWidth = palette?.outerWidth ?? style.outerWidth;
      const opacity = this.palette === "immersive"
        ? 1
        : style.opacity;
      setLineVisibility(layer.element, opacity > 0.01);
      layer.element.style.opacity = String(opacity);
    }
  }

  setRouteReveal(progress: number) {
    if (!this.routeLine || this.routePath.length < 2) return;
    if (progress <= 0) {
      this.routeLine.dataset.routeVisible = "false";
      this.routeLine.style.display = "none";
      this.routeLine.path = this.routePath.slice(0, 2);
      return;
    }
    this.routeLine.dataset.routeVisible = "true";
    this.routeLine.style.display = "";
    this.routeLine.strokeWidth = this.routeWidth;
    const bounded = Math.min(1, Math.max(0.01, progress));
    const visibleCount = Math.max(
      2,
      Math.ceil((this.routePath.length - 1) * bounded) + 1,
    );
    this.routeLine.path = this.routePath.slice(0, visibleCount);
  }

  destroy() {
    this.transition({ type: "destroyed" });
    this.mountController?.abort();
    this.mountController = undefined;
    this.map?.remove();
    this.map = undefined;
    this.routeLine = undefined;
    this.disposeMarker?.();
    this.disposeMarker = undefined;
    this.positionMarker = undefined;
    this.filamentLayers = [];
    this.routePath = [];
    this.routeDistanceM = 1;
    this.headingDeg = undefined;
  }
}

function createFilamentLayers({
  Polyline3DElement,
  altitudeMode,
  map,
  routePath,
  roles,
}: {
  Polyline3DElement: typeof google.maps.maps3d.Polyline3DElement;
  altitudeMode: google.maps.maps3d.AltitudeMode;
  map: google.maps.maps3d.Map3DElement;
  routePath: Array<{ lat: number; lng: number }>;
  roles: CinematicFilamentRole[];
}) {
  return roles.map((role, index) => {
    const element = new Polyline3DElement({
      path: routePath.slice(0, 2),
      strokeColor: "rgba(255, 255, 255, 0)",
      strokeWidth: 1,
      outerWidth: 0,
      altitudeMode,
      drawsOccludedSegments: false,
      geodesic: false,
      zIndex: 10 + index,
    });
    element.dataset.threadLayer = role;
    element.dataset.routeVisible = "false";
    element.style.display = "none";
    map.append(element);
    return { element, endRatio: -1, role, startRatio: -1 };
  });
}

function setLineVisibility(
  element: google.maps.maps3d.Polyline3DElement,
  visible: boolean,
) {
  element.dataset.routeVisible = String(visible);
  element.style.display = visible ? "" : "none";
}

function smoothMapHeading(current: number, target: number, amount: number) {
  const delta = ((target - current + 540) % 360) - 180;
  return (current + delta * amount + 360) % 360;
}

export function createGoogleRouteNavigatorEngine(): GoogleRouteNavigatorEngine {
  return (
    window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?.() ??
    new BrowserGoogleRouteNavigatorEngine()
  );
}
