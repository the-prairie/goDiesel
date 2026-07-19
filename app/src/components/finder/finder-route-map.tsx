import maplibregl, {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { QuestRoute } from "@/domain/routes";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function FinderRouteMap({
  route,
  selectedSlug,
}: {
  route?: QuestRoute;
  selectedSlug?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const routeRef = useRef(route);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  routeRef.current = route;

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
    const resizeObserver = new ResizeObserver(() => map.resize());
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
      showRoute(map, routeRef.current);
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
    if (!map?.isStyleLoaded()) return;
    showRoute(map, route);
  }, [route]);

  return (
    <section
      aria-label="Finder route map"
      data-map-status={status}
      data-selected-route={selectedSlug}
      className="relative min-h-0 overflow-hidden bg-[#d9ddd2]"
    >
      <div ref={hostRef} className="h-full w-full" />
      {status === "loading" ? (
        <div role="status" className="absolute left-4 top-4 border border-line bg-surface/94 px-3 py-2 text-caption text-ink-secondary shadow-panel">
          Opening planning map.
        </div>
      ) : null}
      {status === "unavailable" ? (
        <div role="status" className="absolute inset-0 grid place-items-center bg-surface-muted/94 p-6 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-ink">Planning map unavailable</p>
            <p className="mt-2 text-control leading-6 text-ink-muted">
              Candidate records remain available, but source-backed map tiles could not load in this session.
            </p>
          </div>
        </div>
      ) : null}
      {selectedSlug && route?.route.length === 0 ? (
        <div role="status" className="absolute bottom-4 left-4 right-4 border border-line bg-surface/94 p-3 text-control text-ink-secondary shadow-panel sm:right-auto sm:max-w-sm">
          Recorded geometry is unavailable for this candidate. Finder will not invent a path.
        </div>
      ) : null}
      {!selectedSlug && status === "ready" ? (
        <div className="absolute bottom-4 left-4 max-w-sm border-l-2 border-l-route bg-surface/94 p-4 shadow-panel">
          <p className="font-editorial text-xl font-semibold text-ink">Choose the day first.</p>
          <p className="mt-1 text-control leading-6 text-ink-secondary">
            Source-backed candidate geometry will appear here after a search.
          </p>
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
    paint: { "line-color": "#f6f2e8", "line-width": 10, "line-opacity": 0.92 },
  });
  map.addLayer({
    id: "finder-route-thread",
    type: "line",
    source: "finder-route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#315fb4", "line-width": 5, "line-opacity": 1 },
  });
}

function showRoute(map: MapLibreMap, route?: QuestRoute) {
  const source = map.getSource("finder-route") as GeoJSONSource | undefined;
  if (!source) return;
  if (!route || route.route.length < 2) {
    source.setData(emptyFeatureCollection());
    return;
  }

  source.setData({
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: route.route.map((point) => [point.lng, point.lat]),
    },
  });
  const bounds = new LngLatBounds();
  route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
  map.fitBounds(bounds, {
    padding: { top: 72, right: 56, bottom: 72, left: 56 },
    maxZoom: 13,
    duration: 600,
  });
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}
