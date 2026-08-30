import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { atlasViewportInsets } from "@/surfaces/atlas/atlas-region-camera";
import type { RouteRegion } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/route";
import { ROUTE_THREAD_STYLE } from "@/domain/geometry/route-thread-style";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const LOAD_TIMEOUT_MS = 10_000;

export interface RegionalRouteBounds {
  west: number;
  east: number;
  south: number;
  north: number;
  centerLng: number;
  spanLng: number;
}

type RegionalRouteBoundsInput = Omit<RegionalRouteBounds, "spanLng"> & {
  spanLng?: number;
  longitudeSpan?: number;
};
type MapStatus = "loading" | "ready" | "unavailable";
type ProjectedPoint = { x: number; y: number };

export function unwrapLongitudeAroundCenter(lng: number, centerLng: number) {
  const offset = ((lng - centerLng + 180) % 360 + 360) % 360 - 180;
  return centerLng + offset;
}

function validRecordedTrace(route: RouteSummary) {
  return (
    route.replay.geometryStatus === "ready" &&
    route.trace.length >= 2 &&
    route.trace.every(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        point.lat >= -90 &&
        point.lat <= 90 &&
        point.lng >= -180 &&
        point.lng <= 180,
    )
  );
}

function unwrappedTrace(trace: RoutePoint[], centerLng: number) {
  return trace.map((point) => [
    unwrapLongitudeAroundCenter(point.lng, centerLng),
    point.lat,
  ]);
}

function validBounds(region: RouteRegion): RegionalRouteBounds | undefined {
  const bounds = (
    region as unknown as { bounds?: RegionalRouteBoundsInput | null }
  ).bounds;
  const spanLng = bounds?.spanLng ?? bounds?.longitudeSpan;
  if (
    !bounds ||
    ![
      bounds.west,
      bounds.east,
      bounds.south,
      bounds.north,
      bounds.centerLng,
      spanLng,
    ].every(Number.isFinite) ||
    bounds.south > bounds.north ||
    bounds.south < -90 ||
    bounds.north > 90 ||
    spanLng === undefined ||
    spanLng < 0 ||
    spanLng > 360
  ) {
    return undefined;
  }
  return { ...bounds, spanLng };
}

function longitudeNearestTarget(lng: number, target: number) {
  return lng + Math.round((target - lng) / 360) * 360;
}

export function regionalFitBounds(
  region: RouteRegion,
): [[number, number], [number, number]] | undefined {
  const bounds = validBounds(region);
  if (!bounds) return undefined;

  const halfSpan = bounds.spanLng / 2;
  const west = longitudeNearestTarget(
    bounds.west,
    bounds.centerLng - halfSpan,
  );
  const east = longitudeNearestTarget(
    bounds.east,
    bounds.centerLng + halfSpan,
  );

  return [
    [west, bounds.south],
    [east, bounds.north],
  ];
}

export function regionalRouteFitBounds(
  route: RouteSummary,
  centerLng: number,
): [[number, number], [number, number]] | undefined {
  if (!validRecordedTrace(route)) return undefined;
  const coordinates = unwrappedTrace(route.trace, centerLng);
  const longitudes = coordinates.map(([lng]) => lng);
  const latitudes = coordinates.map(([, lat]) => lat);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

export function regionalRouteCollection(region: RouteRegion) {
  const bounds = validBounds(region);
  const routes = bounds ? region.routes.filter(validRecordedTrace) : [];

  return {
    type: "FeatureCollection" as const,
    features: routes.map((route) => ({
      type: "Feature" as const,
      properties: { slug: route.slug, name: route.name },
      geometry: {
        type: "LineString" as const,
        coordinates: unwrappedTrace(route.trace, bounds!.centerLng),
      },
    })),
  };
}

export function projectedRegionalRoutePaths(
  routes: ReturnType<typeof regionalRouteCollection>,
  project: (coordinate: [number, number]) => ProjectedPoint,
) {
  return routes.features.map((feature) =>
    feature.geometry.coordinates
      .map((coordinate, index) => {
        const point = project(coordinate as [number, number]);
        return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      })
      .join(" "),
  );
}

export function regionalMapPadding(width: number, height: number) {
  return atlasViewportInsets(Math.max(1, width), Math.max(1, height));
}

function fitRegionalRoutes(
  map: MapLibreMap,
  host: HTMLDivElement,
  bounds: [[number, number], [number, number]],
) {
  map.fitBounds(bounds, {
    padding: regionalMapPadding(host.clientWidth, host.clientHeight),
    maxZoom: 14,
    duration: 0,
  });
  const center = map.getCenter();
  host.dataset.mapCenter = `${center.lng.toFixed(5)},${center.lat.toFixed(5)}`;
  host.dataset.mapZoom = map.getZoom().toFixed(2);
}

interface AtlasRegionalFallbackProps {
  region: RouteRegion;
  selectedRoute?: RouteSummary;
  previewedRoute?: RouteSummary;
  framedRoute?: RouteSummary;
  onSelectRoute?: (route: RouteSummary) => void;
  onReady?: () => void;
  routeDisplayMode?: "standard" | "density" | "terrain";
}

export function AtlasRegionalFallback({
  region,
  selectedRoute,
  previewedRoute,
  framedRoute,
  onSelectRoute,
  onReady,
  routeDisplayMode = "standard",
}: AtlasRegionalFallbackProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const onSelectRouteRef = useRef(onSelectRoute);
  const onReadyRef = useRef(onReady);
  const lastFramedRouteSlugRef = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [routePaths, setRoutePaths] = useState<string[]>([]);
  const routes = useMemo(() => regionalRouteCollection(region), [region]);
  const bounds = useMemo(() => regionalFitBounds(region), [region]);
  onSelectRouteRef.current = onSelectRoute;
  onReadyRef.current = onReady;
  const activeRoute = previewedRoute ?? selectedRoute;

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("regional-route-thread")) return;
    const selectedSlug = activeRoute?.slug ?? "";
    map.setPaintProperty("regional-route-thread", "line-color", [
      "case",
      ["==", ["get", "slug"], selectedSlug],
      previewedRoute ? "#63d6cf" : ROUTE_THREAD_STYLE.marker,
      ROUTE_THREAD_STYLE.color,
    ]);
    map.setPaintProperty("regional-route-thread", "line-width", [
      "case",
      ["==", ["get", "slug"], selectedSlug],
      7,
      routeDisplayMode === "density" ? 5 : routeDisplayMode === "terrain" ? 2 : 3,
    ]);
    map.setPaintProperty("regional-route-thread", "line-opacity", [
      "case",
      ["==", ["get", "slug"], selectedSlug],
      1,
      previewedRoute ? 0.12 : selectedSlug ? 0.52 : routeDisplayMode === "terrain" ? 0.24 : 0.9,
    ]);
  }, [activeRoute?.slug, previewedRoute, routeDisplayMode]);

  useEffect(() => {
    const map = mapRef.current;
    const host = hostRef.current;
    const regionBounds = validBounds(region);
    if (status !== "ready" || !map || !host || !regionBounds) return;
    const routeBounds = framedRoute
      ? regionalRouteFitBounds(framedRoute, regionBounds.centerLng)
      : undefined;
    if (!routeBounds && !lastFramedRouteSlugRef.current) return;
    map.fitBounds(routeBounds ?? bounds!, {
      padding: regionalMapPadding(host.clientWidth, host.clientHeight),
      maxZoom: 15,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 650,
    });
    host.dataset.cameraRoute = framedRoute?.slug ?? "";
    lastFramedRouteSlugRef.current = framedRoute?.slug;
  }, [bounds, framedRoute, region, status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !bounds || routes.features.length === 0) {
      setStatus("unavailable");
      return;
    }

    let active = true;
    let ready = false;
    let errorCount = 0;
    let loadTimer: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let map: MapLibreMap;
    setStatus("loading");
    setRoutePaths([]);

    try {
      map = new maplibregl.Map({
        container: host,
        style: STYLE_URL,
        center: [validBounds(region)!.centerLng, (bounds[0][1] + bounds[1][1]) / 2],
        zoom: 8,
        pitch: 0,
        bearing: 0,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
    } catch {
      host.replaceChildren();
      setStatus("unavailable");
      return;
    }

    const markUnavailable = () => {
      if (active && !ready) setStatus("unavailable");
    };
    const handleError = () => {
      errorCount += 1;
      if (errorCount >= 4) markUnavailable();
    };
    const updateRouteOverlay = () => {
      setRoutePaths(
        projectedRegionalRoutePaths(routes, (coordinate) =>
          map.project(coordinate),
        ),
      );
    };
    const handleResize = () => {
      map.resize();
      fitRegionalRoutes(map, host, bounds);
      updateRouteOverlay();
      map.once("idle", () => {
        if (active) host.dataset.mapRendered = "true";
      });
      map.triggerRepaint();
    };
    const handleLoad = () => {
      if (!active) return;
      map.addSource("regional-routes", { type: "geojson", data: routes });
      map.addLayer({
        id: "regional-route-halo",
        type: "line",
        source: "regional-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_THREAD_STYLE.halo,
          "line-width": routeDisplayMode === "density" ? 18 : 9,
          "line-opacity": routeDisplayMode === "terrain" ? 0.12 : routeDisplayMode === "density" ? 0.42 : 0.88,
        },
      });
      map.addLayer({
        id: "regional-route-thread",
        type: "line",
        source: "regional-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "slug"], activeRoute?.slug ?? ""],
            previewedRoute ? "#63d6cf" : ROUTE_THREAD_STYLE.marker,
            ROUTE_THREAD_STYLE.color,
          ],
          "line-width": [
            "case",
            ["==", ["get", "slug"], activeRoute?.slug ?? ""],
            7,
            routeDisplayMode === "density" ? 5 : routeDisplayMode === "terrain" ? 2 : 3,
          ],
          "line-opacity": [
            "case",
            ["==", ["get", "slug"], activeRoute?.slug ?? ""],
            1,
            previewedRoute ? 0.12 : activeRoute ? 0.52 : routeDisplayMode === "terrain" ? 0.24 : 0.9,
          ],
        },
      });
      map.addLayer({
        id: "regional-route-hit-target",
        type: "line",
        source: "regional-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#000000",
          "line-width": 18,
          "line-opacity": 0.01,
        },
      });
      map.on("click", "regional-route-hit-target", (event) => {
        const slug = event.features?.[0]?.properties?.slug;
        const route = region.routes.find((candidate) => candidate.slug === slug);
        if (route) onSelectRouteRef.current?.(route);
      });
      map.on("mouseenter", "regional-route-hit-target", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "regional-route-hit-target", () => {
        map.getCanvas().style.cursor = "";
      });
      map.resize();
      fitRegionalRoutes(map, host, bounds);
      updateRouteOverlay();
      map.getCanvas().setAttribute(
        "aria-label",
        `${region.name} recorded routes on a regional map`,
      );
      ready = true;
      if (loadTimer !== undefined) window.clearTimeout(loadTimer);
      setStatus("ready");
      onReadyRef.current?.();
    };

    map.on("error", handleError);
    map.on("moveend", updateRouteOverlay);
    map.once("load", handleLoad);
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    loadTimer = window.setTimeout(markUnavailable, LOAD_TIMEOUT_MS);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(host);
    }

    return () => {
      active = false;
      if (loadTimer !== undefined) window.clearTimeout(loadTimer);
      resizeObserver?.disconnect();
      map.off("error", handleError);
      map.off("load", handleLoad);
      map.off("moveend", updateRouteOverlay);
      map.remove();
      if (mapRef.current === map) mapRef.current = undefined;
      host.replaceChildren();
    };
  }, [bounds, region, routeDisplayMode, routes]);

  const statusCopy =
    status === "loading"
      ? `Loading ${region.name} map.`
      : status === "ready"
        ? "3D terrain partially unavailable."
        : "Regional map unavailable.";

  return (
    <div
      data-atlas-engine="maplibre-regional-fallback"
      data-map-status={status}
      data-region-route-count={routes.features.length}
      data-previewed-route={previewedRoute?.slug ?? ""}
      data-selected-route={selectedRoute?.slug ?? ""}
      className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#d9ddd2]"
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={`${region.name} regional route map`}
        className="absolute inset-0"
      />
      <svg
        aria-hidden="true"
        data-regional-route-overlay="true"
        className="pointer-events-none absolute inset-0 z-[1] size-full"
      >
        {routePaths.map((path, index) => {
          const slug = routes.features[index]?.properties.slug;
          const active = slug === activeRoute?.slug;
          return (
          <g key={`${region.name}-${slug ?? index}`}>
            <path
              d={path}
              data-route-hit-target={slug}
              fill="none"
              stroke="transparent"
              strokeWidth="18"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-auto cursor-pointer"
              onClick={() => {
                const route = region.routes.find((candidate) => candidate.slug === slug);
                if (route) onSelectRouteRef.current?.(route);
              }}
            />
            <path
              d={path}
              fill="none"
              stroke={ROUTE_THREAD_STYLE.halo}
              strokeWidth={routeDisplayMode === "density" ? "18" : "9"}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={active ? "1" : previewedRoute ? "0.12" : selectedRoute ? "0.45" : routeDisplayMode === "terrain" ? "0.12" : routeDisplayMode === "density" ? "0.42" : "0.88"}
            />
            <path
              d={path}
              fill="none"
              stroke={active ? (previewedRoute ? "#63d6cf" : ROUTE_THREAD_STYLE.marker) : ROUTE_THREAD_STYLE.color}
              strokeWidth={active ? "7" : "3"}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          );
        })}
      </svg>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute bottom-20 left-4 z-10 border border-white/25 bg-[#071019]/88 px-3 py-2 text-xs text-white shadow-lg"
      >
        {statusCopy}
      </div>
    </div>
  );
}
