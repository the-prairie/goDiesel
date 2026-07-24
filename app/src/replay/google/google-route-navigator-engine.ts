import type { QuestRoute } from "@/domain/routes";
import {
  densifyGoogleRoutePath,
  type GoogleRouteCameraPose,
  type GoogleRouteGroundingMode,
} from "@/replay/google-route-navigator-controller";
import { loadGoogleMaps } from "@/replay/google/google-maps-loader";

export type GoogleRouteNavigatorStatus =
  | { state: "loading"; message: string }
  | { state: "ready"; message: string }
  | { state: "unavailable"; message: string };

interface MountOptions {
  apiKey: string;
  container: HTMLElement;
  route: QuestRoute;
  groundingMode: GoogleRouteGroundingMode;
  onStatus: (status: GoogleRouteNavigatorStatus) => void;
}

export interface GoogleRouteNavigatorEngine {
  mount(options: MountOptions): Promise<void>;
  setCamera(pose: GoogleRouteCameraPose): void;
  setFollowing(following: boolean): void;
  setGrounding(mode: GoogleRouteGroundingMode): void;
  setRouteReveal(progress: number): void;
  destroy(): void;
}

class BrowserGoogleRouteNavigatorEngine implements GoogleRouteNavigatorEngine {
  private map?: google.maps.maps3d.Map3DElement;
  private routeLine?: google.maps.maps3d.Polyline3DElement;
  private routePath: Array<{ lat: number; lng: number }> = [];
  private following = true;
  private headingDeg?: number;
  private generation = 0;
  private authFailure?: () => void;

  async mount({
    apiKey,
    container,
    route,
    groundingMode,
    onStatus,
  }: MountOptions) {
    const generation = ++this.generation;
    onStatus({ state: "loading", message: "Loading Google photorealistic 3D." });
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
        center: { lat: first.lat, lng: first.lng },
        range: 115,
        tilt: 72,
        heading: 0,
        fov: 54,
        mode: MapMode.SATELLITE,
        gestureHandling: GestureHandling.GREEDY,
        defaultUIHidden: true,
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
      const routeLine = new Polyline3DElement({
        path: routePath,
        strokeColor: "#1c5bb8",
        outerColor: "#f8f5ed",
        strokeWidth: 8,
        outerWidth: 0.34,
        altitudeMode:
          groundingMode === "mesh"
            ? AltitudeMode.RELATIVE_TO_MESH
            : AltitudeMode.CLAMP_TO_GROUND,
        drawsOccludedSegments: false,
        geodesic: false,
        zIndex: 10,
      });
      map.append(routeLine);
      container.replaceChildren(map);
      this.map = map;
      this.routeLine = routeLine;
      this.routePath = routePath;
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
        : smoothMapHeading(this.headingDeg, pose.headingDeg);
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
    if (!this.routeLine || !window.google?.maps?.maps3d?.AltitudeMode) return;
    this.routeLine.altitudeMode =
      mode === "mesh"
        ? google.maps.maps3d.AltitudeMode.RELATIVE_TO_MESH
        : google.maps.maps3d.AltitudeMode.CLAMP_TO_GROUND;
  }

  setRouteReveal(progress: number) {
    if (!this.routeLine || this.routePath.length < 2) return;
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
    this.routePath = [];
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

function smoothMapHeading(current: number, target: number) {
  const delta = ((target - current + 540) % 360) - 180;
  return (current + delta * 0.14 + 360) % 360;
}

export function createGoogleRouteNavigatorEngine(): GoogleRouteNavigatorEngine {
  return new BrowserGoogleRouteNavigatorEngine();
}
