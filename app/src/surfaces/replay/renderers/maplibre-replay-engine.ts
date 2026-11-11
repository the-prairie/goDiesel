import maplibregl from "@/providers/maplibre";
import {
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { ROUTE_THREAD_STYLE } from "@/domain/geometry/route-thread-style";
import type {
  ReplayEngine,
  ReplayEngineMountOptions,
} from "@/surfaces/replay/renderer-port";
import type { ReplayPose } from "@/surfaces/replay/playback/replay-controller";

import {
  initialMapLibreReplayState,
  mapLibreFollowsPose,
  mapLibreReplayStatus,
  mapLibreRunIsCurrent,
  reduceMapLibreReplay,
  type MapLibreReplayEvent,
} from "./maplibre-replay-state";

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
  private lifecycle = initialMapLibreReplayState();
  private loadTimer?: number;

  async mount({
    container,
    route,
    onStatus,
  }: ReplayEngineMountOptions) {
    const { operationId } = this.transition({ type: "mapStarted" }, onStatus);
    if (route.route.length < 2) {
      this.transition({ type: "inputsRejected", operationId }, onStatus);
      return;
    }

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
    map.on("error", () => {
      this.transition({ type: "mapError", operationId }, onStatus);
    });
    this.loadTimer = window.setTimeout(() => {
      this.transition({ type: "deadlineReached", operationId }, onStatus);
    }, 15_000);

    map.once("load", () => {
      if (!mapLibreRunIsCurrent(this.lifecycle, operationId) || this.map !== map)
        return;
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
          "line-color": ROUTE_THREAD_STYLE.halo,
          "line-width": 11,
          "line-opacity": 0.9,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "replay-route-thread",
        type: "line",
        source: "replay-route",
        paint: {
          "line-color": ROUTE_THREAD_STYLE.color,
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
      this.transition({ type: "mapLoaded", operationId }, onStatus);
    });
  }

  /** Every status this engine publishes comes from the reducer state. */
  private transition(
    event: MapLibreReplayEvent,
    onStatus?: ReplayEngineMountOptions["onStatus"],
  ) {
    const previous = this.lifecycle;
    this.lifecycle = reduceMapLibreReplay(previous, event);
    if (this.lifecycle.statusRevision !== previous.statusRevision) {
      const status = mapLibreReplayStatus(this.lifecycle);
      if (status) onStatus?.(status);
    }
    return this.lifecycle;
  }

  setPose(pose: ReplayPose) {
    const map = this.map;
    if (!map || !mapLibreFollowsPose(this.lifecycle)) return;
    if (!pose.following) return;
    map.jumpTo({
      center: [pose.lng, pose.lat],
      bearing: pose.bearingDeg,
      zoom: zoomForRange(pose.cameraRangeM),
      pitch: 52,
    });
  }

  destroy() {
    if (this.loadTimer !== undefined) window.clearTimeout(this.loadTimer);
    this.map?.remove();
    this.host?.remove();
    this.map = undefined;
    this.host = undefined;
    this.transition({ type: "disposed" });
    this.loadTimer = undefined;
  }
}
