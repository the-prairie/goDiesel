import { LocateFixed, Minus, Plus } from "lucide-react";
import maplibregl, { LngLatBounds, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/ui/button";
import type { QuestRoute } from "@/domain/route";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_COLOR = "#3379df";
const ROUTE_HALO = "#fffaf2";
const ROUTE_WIDTH = 4;
const ROUTE_HALO_WIDTH = 8;

function routeFeature(route: QuestRoute) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: route.route.map((point) => [point.lng, point.lat]),
    },
  };
}

export function RouteLeafMap({ route }: { route: QuestRoute }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    route.route.length > 1 ? "loading" : "unavailable",
  );
  useEffect(() => {
    const host = hostRef.current;
    if (!host || route.route.length < 2) return;

    let active = true;
    let errorCount = 0;
    let ready = false;
    const bounds = new LngLatBounds();
    route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
    const map = new maplibregl.Map({
      container: host,
      style: STYLE_URL,
      center: [route.centerLng, route.centerLat],
      zoom: 11,
      pitch: 38,
      bearing: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(host);
    const loadTimer = window.setTimeout(() => {
      if (active && !ready) setStatus("unavailable");
    }, 8_000);

    const handleError = () => {
      errorCount += 1;
      if (active && errorCount >= 4 && !ready) setStatus("unavailable");
    };
    map.on("error", handleError);
    map.once("load", () => {
      if (!active) return;
      map.resize();
      map.addSource("leaf-route", { type: "geojson", data: routeFeature(route) });
      map.addLayer({
        id: "leaf-route-halo",
        type: "line",
        source: "leaf-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_HALO,
          "line-width": ROUTE_HALO_WIDTH,
          "line-opacity": 0.88,
        },
      });
      map.addLayer({
        id: "leaf-route-thread",
        type: "line",
        source: "leaf-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": ROUTE_WIDTH,
          "line-opacity": 0.96,
        },
      });
      const start = route.route[0];
      const finish = route.route.at(-1)!;
      map.addSource("leaf-endpoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "start" },
              geometry: { type: "Point", coordinates: [start.lng, start.lat] },
            },
            {
              type: "Feature",
              properties: { kind: "finish" },
              geometry: { type: "Point", coordinates: [finish.lng, finish.lat] },
            },
          ],
        },
      });
      map.addLayer({
        id: "leaf-route-start",
        type: "circle",
        source: "leaf-endpoints",
        filter: ["==", ["get", "kind"], "start"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#d95d45",
          "circle-stroke-color": ROUTE_HALO,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "leaf-route-finish",
        type: "circle",
        source: "leaf-endpoints",
        filter: ["==", ["get", "kind"], "finish"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#174f46",
          "circle-stroke-color": ROUTE_HALO,
          "circle-stroke-width": 2,
        },
      });
      map.fitBounds(bounds, {
        padding: { top: 88, right: 64, bottom: 88, left: 64 },
        maxZoom: 14,
        duration: 0,
      });
      map.getCanvas().setAttribute("aria-label", `${route.name} interactive route map`);
      map.once("idle", () => {
        if (!active) return;
        ready = true;
        window.clearTimeout(loadTimer);
        setStatus("ready");
      });
    });

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      resizeObserver.disconnect();
      map.off("error", handleError);
      map.remove();
      mapRef.current = undefined;
    };
  }, [route]);

  function resetView() {
    const map = mapRef.current;
    if (!map || route.route.length < 2) return;
    const bounds = new LngLatBounds();
    route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
    map.fitBounds(bounds, {
      padding: { top: 88, right: 64, bottom: 88, left: 64 },
      maxZoom: 14,
      duration: 450,
    });
  }

  return (
    <section
      aria-label="Route geography"
      data-map-status={status}
      data-geometry-points={route.route.length}
      data-route-color={ROUTE_COLOR}
      data-route-halo={ROUTE_HALO}
      data-route-width={ROUTE_WIDTH}
      data-route-halo-width={ROUTE_HALO_WIDTH}
      className="relative min-h-0 overflow-hidden bg-[#d9ddd2]"
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={`${route.name} recorded path on a real map`}
        className="h-full w-full"
      />

      {status === "loading" ? (
        <div
          role="status"
          className="absolute left-4 top-4 rounded-sm border border-line bg-surface/92 px-3 py-2 text-caption text-ink-secondary shadow-panel"
        >
          Opening route geography.
        </div>
      ) : null}
      {status === "unavailable" ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-muted/92 p-6 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-ink">
              {route.route.length > 1 ? "Map tiles unavailable" : "Recorded path unavailable"}
            </p>
            <p className="mt-2 text-control leading-6 text-ink-muted">
              {route.route.length > 1
                ? "The recorded route is intact, but source-backed map tiles could not load in this session."
                : "This route has no usable GPS geometry to place on the map."}
            </p>
          </div>
        </div>
      ) : null}

      {route.route.length > 1 ? (
        <>
          <div className="absolute right-4 top-4 z-10 flex gap-3 rounded-sm border border-line bg-surface/92 px-3 py-2 text-caption font-semibold text-ink-secondary shadow-panel backdrop-blur">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-coral" aria-hidden="true" />
              Start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-forest" aria-hidden="true" />
              Finish
            </span>
          </div>
          <div className="absolute bottom-4 left-4 z-10 flex gap-1 rounded-sm border border-line bg-surface/92 p-1 shadow-panel backdrop-blur">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Reset route map"
              onClick={resetView}
            >
              <LocateFixed aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom route map out"
              onClick={() => mapRef.current?.zoomOut()}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom route map in"
              onClick={() => mapRef.current?.zoomIn()}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
