import type { QuestRoute } from "@/domain/routes";
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
} from "@/surfaces/replay/playback/route-navigator-controller";
import { loadGoogleMaps } from "@/providers/google-maps-loader";
import { routeDistanceM } from "@/replay/route-path";

export type GoogleRouteNavigatorStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; message: string }
  | { state: "unavailable"; message: string };

interface MountOptions {
  apiKey: string;
  container: HTMLElement;
  route: QuestRoute;
  groundingMode: GoogleRouteGroundingMode;
  initialCamera?: GoogleRouteCameraPose;
  onStatus: (status: GoogleRouteNavigatorStatus) => void;
  routeStyle?: {
    color: string;
    mode?: "filament" | "hidden" | "solid";
    outerColor: string;
    outerWidth: number;
    width: number;
  };
  headingSmoothing?: number;
}

export interface GoogleRouteNavigatorEngine {
  mount(options: MountOptions): Promise<void>;
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

const GOOGLE_SCENE_READY_TIMEOUT_MS = 30_000;

function waitForGoogleSceneReady(map: google.maps.maps3d.Map3DElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google photorealistic 3D did not finish loading."));
    }, GOOGLE_SCENE_READY_TIMEOUT_MS);
    const onSteady = (event: Event) => {
      if (!(event as google.maps.maps3d.SteadyChangeEvent).isSteady) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Google photorealistic 3D could not render this scene."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      map.removeEventListener("gmp-steadychange", onSteady);
      map.removeEventListener("gmp-error", onError);
    };
    map.addEventListener("gmp-steadychange", onSteady);
    map.addEventListener("gmp-error", onError, { once: true });
  });
}

class BrowserGoogleRouteNavigatorEngine implements GoogleRouteNavigatorEngine {
  private map?: google.maps.maps3d.Map3DElement;
  private routeLine?: google.maps.maps3d.Polyline3DElement;
  private filamentLayers: FilamentLayer[] = [];
  private routePath: Array<{ lat: number; lng: number }> = [];
  private routeDistanceM = 1;
  private routeWidth = 8;
  private following = true;
  private headingDeg?: number;
  private headingSmoothing = 0.14;
  private generation = 0;
  private authFailure?: () => void;

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
    const generation = ++this.generation;
    onStatus({ state: "loading", message: "Loading Google photorealistic 3D." });
    this.headingSmoothing = headingSmoothing ?? 0.14;
    if (!apiKey) {
      onStatus({
        state: "unavailable",
        message: "A Google Maps JavaScript API browser key is required.",
      });
      return;
    }
    if (route.route.length < 2) {
      onStatus({ state: "unavailable", message: "Recorded route geometry is unavailable." });
      return;
    }

    try {
      this.authFailure = () => {
        onStatus({
          state: "unavailable",
          message:
            "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
        });
      };
      window.addEventListener(
        "godiesel:google-maps-auth-failure",
        this.authFailure,
      );
      await loadGoogleMaps(apiKey);
      const {
        AltitudeMode,
        GestureHandling,
        Map3DElement,
        MapMode,
        Polyline3DElement,
      } = (await google.maps.importLibrary("maps3d")) as google.maps.Maps3DLibrary;
      if (generation !== this.generation) return;

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
        onStatus({
          state: "unavailable",
          message:
            "This browser could not start Google photorealistic 3D. Try a hardware-accelerated Chrome window.",
        });
      });

      const routePath = densifyGoogleRoutePath(route);
      const altitudeMode =
        groundingMode === "mesh"
          ? AltitudeMode.RELATIVE_TO_MESH
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
        });
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
      this.routeDistanceM = Math.max(1, routeDistanceM(route));
      this.routeWidth = routeStyle?.width ?? 8;
      await waitForGoogleSceneReady(map);
      if (generation !== this.generation) return;
      onStatus({ state: "ready", message: "Native Google 3D route world ready." });
    } catch (error) {
      if (generation !== this.generation) return;
      onStatus({
        state: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Google 3D Maps could not start.",
      });
    }
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
    this.following = following;
  }

  setGrounding(mode: GoogleRouteGroundingMode) {
    if (!window.google?.maps?.maps3d?.AltitudeMode) return;
    const altitudeMode =
      mode === "mesh"
        ? google.maps.maps3d.AltitudeMode.RELATIVE_TO_MESH
        : google.maps.maps3d.AltitudeMode.CLAMP_TO_GROUND;
    if (this.routeLine) this.routeLine.altitudeMode = altitudeMode;
    this.filamentLayers.forEach(({ element }) => {
      element.altitudeMode = altitudeMode;
    });
  }

  setCinematicRoute(treatment: CinematicRouteTreatment) {
    if (this.filamentLayers.length === 0 || this.routePath.length < 2) return;
    const styles = buildCinematicThreadStyles(
      treatment,
      this.routeDistanceM,
    );
    for (const layer of this.filamentLayers) {
      const style = styles.find(({ role }) => role === layer.role);
      if (!style || style.endRatio <= style.startRatio) {
        setLineVisibility(layer.element, false);
        continue;
      }
      if (
        Math.abs(layer.startRatio - style.startRatio) > 0.0001 ||
        Math.abs(layer.endRatio - style.endRatio) > 0.0001
      ) {
        layer.element.path = slicePathByRatio(
          this.routePath,
          style.startRatio,
          style.endRatio,
        ).map((point) => ({
          ...point,
          altitude: FILAMENT_CLEARANCE_M[layer.role],
        }));
        layer.startRatio = style.startRatio;
        layer.endRatio = style.endRatio;
      }
      layer.element.strokeColor = style.color;
      layer.element.strokeWidth = style.width;
      layer.element.outerColor = style.outerColor;
      layer.element.outerWidth = style.outerWidth;
      setLineVisibility(layer.element, style.opacity > 0.01);
      layer.element.style.opacity = String(style.opacity);
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
    this.generation += 1;
    this.map?.remove();
    this.map = undefined;
    this.routeLine = undefined;
    this.filamentLayers = [];
    this.routePath = [];
    this.routeDistanceM = 1;
    this.headingDeg = undefined;
    if (this.authFailure) {
      window.removeEventListener(
        "godiesel:google-maps-auth-failure",
        this.authFailure,
      );
      this.authFailure = undefined;
    }
  }
}

function createFilamentLayers({
  Polyline3DElement,
  altitudeMode,
  map,
  routePath,
}: {
  Polyline3DElement: typeof google.maps.maps3d.Polyline3DElement;
  altitudeMode: google.maps.maps3d.AltitudeMode;
  map: google.maps.maps3d.Map3DElement;
  routePath: Array<{ lat: number; lng: number }>;
}) {
  const roles: FilamentLayer["role"][] = [
    "guide",
    "future",
    "thread",
    "glint",
  ];
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
