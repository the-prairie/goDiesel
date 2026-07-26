import maplibregl, {
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  ReplayEngine,
  ReplayEngineMountOptions,
} from "@/replay/replay-engine";
import type { ReplayPose } from "@/replay/replay-controller";

const STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";

function routeFeature(route: ReplayEngineMountOptions["route"]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: route.route.map((point) => [point.lng, point.lat]),
    },
  };
}

function zoomForRange(cameraRangeM: number) {
  if (cameraRangeM <= 120) return 17;
  if (cameraRangeM <= 240) return 16;
  if (cameraRangeM <= 720) return 14.5;
  return 13.5;
}

export class MapLibreAtlasReplayEngine implements ReplayEngine {
  private map?: MapLibreMap;
  private host?: HTMLDivElement;
  private avatarElement?: HTMLElement;
  private latestPose?: ReplayPose;
  private ready = false;
  private loadTimer?: number;
  private errorCount = 0;
  private generation = 0;

  async mount({
    container,
    avatarElement,
    route,
    onStatus,
  }: ReplayEngineMountOptions) {
    const generation = ++this.generation;
    onStatus({
      state: "loading",
      title: "Opening Atlas replay",
      message: "Loading the route map and replay thread.",
    });
    if (route.route.length < 2) {
      onStatus({
        state: "unavailable",
        title: "Route geometry unavailable",
        message: "This route does not contain enough points for Atlas replay.",
      });
      return;
    }

    this.avatarElement = avatarElement;
    const host = document.createElement("div");
    host.className = "h-full w-full";
    container.replaceChildren(host);
    this.host = host;
    const start = route.route[0];
    const map = new maplibregl.Map({
      container: host,
      style: STYLE_URL,
      center: [start.lng, start.lat],
      zoom: 13,
      pitch: 52,
      bearing: 0,
      attributionControl: { compact: true },
    });
    this.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.on("render", this.syncAvatar);
    const handleError = () => {
      if (generation !== this.generation) return;
      this.errorCount += 1;
      if (!this.ready && this.errorCount >= 4) {
        onStatus({
          state: "unavailable",
          title: "Atlas replay unavailable",
          message: "The fallback map could not load in this browser session.",
        });
      }
    };
    map.on("error", handleError);
    this.loadTimer = window.setTimeout(() => {
      if (generation === this.generation && !this.ready) {
        onStatus({
          state: "unavailable",
          title: "Atlas replay timed out",
          message: "The fallback map did not become ready in time.",
        });
      }
    }, 15_000);

    map.once("load", () => {
      if (generation !== this.generation || this.map !== map) return;
      if (this.loadTimer !== undefined) window.clearTimeout(this.loadTimer);
      map.resize();
      map.addSource("replay-route", {
        type: "geojson",
        data: routeFeature(route),
      });
      map.addLayer({
        id: "replay-route-shadow",
        type: "line",
        source: "replay-route",
        paint: {
          "line-color": "#1f3355",
          "line-width": 11,
          "line-opacity": 0.82,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "replay-route-thread",
        type: "line",
        source: "replay-route",
        paint: {
          "line-color": "#33507a",
          "line-width": 5,
          "line-opacity": 1,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      const bounds = new LngLatBounds();
      route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
      map.fitBounds(bounds, {
        padding: { top: 170, right: 80, bottom: 150, left: 80 },
        maxZoom: 15,
        duration: 0,
      });
      this.ready = true;
      this.syncAvatar();
      onStatus({
        state: "ready",
        title: "Atlas replay ready",
        message: "The fallback route thread and avatar are ready to move.",
      });
    });
  }

  setPose(pose: ReplayPose) {
    this.latestPose = pose;
    const map = this.map;
    if (!map || !this.ready) return;
    this.syncAvatar();
    if (!pose.following) return;
    map.jumpTo({
      center: [pose.lng, pose.lat],
      bearing: pose.bearingDeg,
      zoom: zoomForRange(pose.cameraRangeM),
      pitch: 52,
    });
  }

  private syncAvatar = () => {
    const map = this.map;
    const avatarElement = this.avatarElement;
    const pose = this.latestPose;
    if (!map || !avatarElement || !pose) return;
    const point = map.project([pose.lng, pose.lat]);
    avatarElement.style.display = "block";
    avatarElement.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -74%)`;
  };

  destroy() {
    this.generation += 1;
    if (this.loadTimer !== undefined) window.clearTimeout(this.loadTimer);
    if (this.avatarElement) this.avatarElement.style.display = "none";
    this.map?.off("render", this.syncAvatar);
    this.map?.remove();
    this.host?.remove();
    this.map = undefined;
    this.host = undefined;
    this.avatarElement = undefined;
    this.latestPose = undefined;
    this.ready = false;
    this.loadTimer = undefined;
    this.errorCount = 0;
  }
}
