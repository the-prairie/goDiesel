import { LocateFixed, Minus, Plus } from "lucide-react";
import { Button } from "@/ui/button";
import maplibregl from "@/providers/maplibre";
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { QuestRoute } from "@/domain/route";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function FinderRouteMap({
  route,
  selectedSlug,
  lines,
}: {
  route?: QuestRoute;
  selectedSlug?: string;
  lines?: [number, number][][];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const routeRef = useRef({route, lines});
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  routeRef.current = {route, lines};

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    let errors = 0;
    const map = new maplibregl.Map({
      container: host,
      style: STYLE_URL,
      center: [20, 28],
      zoom: 1.4,
      pitch: 18,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    let previousWidth = host.clientWidth;
    let previousHeight = host.clientHeight;
    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      map.resize();
      if (width > 0 && height > 0 && (width !== previousWidth || height !== previousHeight) && map.getSource("finder-route")) {
        showRoute(map, routeRef.current.route, routeRef.current.lines, 0);
      }
      previousWidth = width;
      previousHeight = height;
    });
    resizeObserver.observe(host);
    const timer = window.setTimeout(() => {
      if (active && !map.loaded()) setStatus("unavailable");
    }, 8_000);

    map.on("error", () => {
      errors += 1;
      if (active && errors >= 4 && !map.loaded()) setStatus("unavailable");
    });
    map.once("load", () => {
      if (!active) return;
      addRouteLayers(map);
      showRoute(map, routeRef.current.route, routeRef.current.lines);
      map.once("idle", () => {
        if (!active) return;
        window.clearTimeout(timer);
        setStatus("ready");
      });
    });

    return () => {
      active = false;
      window.clearTimeout(timer);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    // Tile loading can make isStyleLoaded false after initial load. The route
    // source already exists then; dropping this update would leave a stale path.
    if (!map?.getSource("finder-route")) return;
    showRoute(map, route, lines);
  }, [route, lines]);

  return (
    <section
      aria-label="Finder route map"
      data-map-status={status}
      data-selected-route={selectedSlug}
      className="relative h-full min-h-0 overflow-hidden bg-canvas"
    >
      <div ref={hostRef} className="h-full w-full" />
      {status === "loading" ? (
        <div role="status" className="absolute inset-0 grid place-items-center bg-canvas p-6 text-caption text-ink-secondary">
          Opening planning map.
        </div>
      ) : null}
      {status === "unavailable" ? (
        <div role="status" className="absolute inset-0 grid place-items-center bg-canvas p-6 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-ink">Planning map unavailable</p>
            <p className="mt-2 text-control leading-6 text-ink-muted">
              The map could not load. You can still browse and save the routes beside it.
            </p>
          </div>
        </div>
      ) : null}
      {selectedSlug && route?.route.length === 0 ? (
        <div role="status" className="absolute bottom-4 left-4 right-4 border border-line bg-surface/94 p-3 text-control text-ink-secondary shadow-panel sm:right-auto sm:max-w-sm">
          Recorded geometry is unavailable for this candidate. Finder will not invent a path.
        </div>
      ) : null}
      {status === "ready" && (route || lines) ? (
        <div role="group" aria-label="Finder map controls" className="absolute bottom-10 right-3 grid rounded-[var(--radius-control)] border border-line bg-black/90 p-1 backdrop-blur">
          <Button type="button" variant="ghost" size="icon" aria-label="Fit route to map" onClick={() => { if (mapRef.current) showRoute(mapRef.current, route, lines); }}><LocateFixed aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Zoom planning map in" onClick={() => mapRef.current?.zoomIn()}><Plus aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Zoom planning map out" onClick={() => mapRef.current?.zoomOut()}><Minus aria-hidden="true" /></Button>
        </div>
      ) : null}
    </section>
  );
}

function addRouteLayers(map: MapLibreMap) {
  map.addSource("finder-route", {
    type: "geojson",
    data: emptyFeatureCollection(),
  });
  map.addLayer({
    id: "finder-route-halo",
    type: "line",
    source: "finder-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.92 },
  });
  map.addLayer({
    id: "finder-route-thread",
    type: "line",
    source: "finder-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#30343b", "line-width": 3, "line-opacity": 1 },
  });
}

function showRoute(map: MapLibreMap, route?: QuestRoute, lines?: [number, number][][], duration = 600) {
  const geometry = lines ?? (route ? [route.route.map(point => [point.lng, point.lat] as [number, number])] : []);
  const source = map.getSource("finder-route") as GeoJSONSource | undefined;
  if (!source) return;
  if (!geometry.some(line => line.length >= 2)) {
    source.setData(emptyFeatureCollection());
    return;
  }

  source.setData({
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiLineString",
      coordinates: geometry,
    },
  });
  const bounds = new LngLatBounds();
  geometry.flat().forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, {
    padding: { top: 40, right: 76, bottom: 48, left: 40 },
    maxZoom: 13,
    duration,
  });
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}
