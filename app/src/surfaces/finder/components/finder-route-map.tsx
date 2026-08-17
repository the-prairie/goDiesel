import maplibregl, { GeoJSONSource, LngLatBounds, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { useEffect, useRef, useState } from "react";

import type { DiscoveryCandidate } from "@/domain/planning";

const STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";
const SOURCE_ID = "finder-candidates";
const ENDPOINT_SOURCE_ID = "finder-route-endpoints";
const ROUTE_LAYER = "finder-route-thread";

export function FinderRouteMap({
  candidates,
  selectedSlug,
  committedSlug,
  previewedSlug,
  showEmptyPrompt,
  onSelect,
  onPreview,
}: {
  candidates: DiscoveryCandidate[];
  selectedSlug?: string;
  committedSlug?: string;
  previewedSlug?: string;
  showEmptyPrompt: boolean;
  onSelect: (slug: string) => void;
  onPreview: (slug?: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const candidatesRef = useRef(candidates);
  const selectedSlugRef = useRef(selectedSlug);
  const previewedSlugRef = useRef(previewedSlug);
  const callbacksRef = useRef({ onSelect, onPreview });
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  candidatesRef.current = candidates;
  selectedSlugRef.current = selectedSlug;
  previewedSlugRef.current = previewedSlug;
  callbacksRef.current = { onSelect, onPreview };

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
      pitch: 38,
      bearing: -8,
      maxPitch: 65,
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
      showCandidates(
        map,
        candidatesRef.current,
        selectedSlugRef.current,
        previewedSlugRef.current,
        true,
      );
      map.on("mouseenter", ROUTE_LAYER, (event) => {
        map.getCanvas().style.cursor = "pointer";
        const slug = event.features?.[0]?.properties?.slug as string | undefined;
        callbacksRef.current.onPreview(slug);
      });
      map.on("mouseleave", ROUTE_LAYER, () => {
        map.getCanvas().style.cursor = "";
        callbacksRef.current.onPreview(undefined);
      });
      map.on("click", ROUTE_LAYER, (event) => {
        const slug = event.features?.[0]?.properties?.slug as string | undefined;
        if (slug) callbacksRef.current.onSelect(slug);
      });
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
    showCandidates(map, candidates, selectedSlug, previewedSlug, true);
  }, [candidates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    showCandidates(map, candidates, selectedSlug, previewedSlug, false);
  }, [candidates, previewedSlug, selectedSlug]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !committedSlug) return;
    fitCandidates(map, candidates.filter((candidate) => candidate.sourceRouteSlug === committedSlug));
  }, [candidates, committedSlug]);

  return (
    <section
      aria-label="Finder route map"
      data-map-status={status}
      data-selected-route={selectedSlug ?? ""}
      data-previewed-route={previewedSlug ?? ""}
      data-route-count={candidates.length}
      data-map-style="fiord"
      className="absolute inset-0 overflow-hidden bg-[#102b33]"
    >
      <div ref={hostRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,18,28,0.38),transparent_34%,rgba(5,18,28,0.16)_62%,rgba(4,15,24,0.46))]" />
      {status === "loading" ? (
        <div role="status" className="absolute right-4 top-4 border border-white/60 bg-surface/90 px-3 py-2 text-caption text-ink-secondary shadow-panel backdrop-blur">Opening regional map.</div>
      ) : null}
      {status === "unavailable" ? (
        <div role="status" className="absolute inset-0 grid place-items-center bg-surface-muted/94 p-6 text-center">
          <div className="max-w-sm"><p className="font-semibold text-ink">Planning map unavailable</p><p className="mt-2 text-control leading-6 text-ink-muted">Candidate records remain available, but source-backed map tiles could not load in this session.</p></div>
        </div>
      ) : null}
      {showEmptyPrompt && !candidates.length && status === "ready" ? (
        <div className="absolute left-4 top-28 max-w-xs bg-[#07151c]/88 p-4 text-white shadow-panel backdrop-blur-md md:left-[26rem] md:top-[5.75rem]">
          <p className="font-editorial text-xl font-semibold text-white">Choose the shape of the day.</p>
          <p className="mt-1 text-control leading-6 text-white/68">Recorded candidate routes will gather here after a search.</p>
        </div>
      ) : null}
    </section>
  );
}

function addRouteLayers(map: MapLibreMap) {
  map.addSource(SOURCE_ID, {
    type: "geojson",
    lineMetrics: true,
    data: featureCollection([]),
  });
  map.addSource(ENDPOINT_SOURCE_ID, {
    type: "geojson",
    data: pointFeatureCollection([]),
  });
  map.addLayer({
    id: "finder-route-halo",
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["boolean", ["get", "active"], false], "#ff8065", "#63d6cf"],
      "line-width": ["case", ["boolean", ["get", "active"], false], 18, 9],
      "line-blur": ["case", ["boolean", ["get", "active"], false], 8, 5],
      "line-opacity": ["case", ["boolean", ["get", "active"], false], 0.42, 0.22],
    },
  });
  map.addLayer({
    id: "finder-route-casing",
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#07151c",
      "line-width": ["case", ["boolean", ["get", "active"], false], 9, 6],
      "line-opacity": ["case", ["boolean", ["get", "dimmed"], false], 0.42, 0.78],
    },
  });
  map.addLayer({
    id: ROUTE_LAYER,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["boolean", ["get", "active"], false], "#ff8065", "#63d6cf"],
      "line-width": ["case", ["boolean", ["get", "active"], false], 5, 3],
      "line-opacity": ["case", ["boolean", ["get", "dimmed"], false], 0.34, 1],
    },
  });
  map.addLayer({
    id: "finder-route-endpoints",
    type: "circle",
    source: ENDPOINT_SOURCE_ID,
    paint: {
      "circle-color": ["match", ["get", "kind"], "finish", "#ff8065", "#63d6cf"],
      "circle-radius": ["match", ["get", "kind"], "finish", 7, 5],
      "circle-stroke-color": "#fffaf2",
      "circle-stroke-width": 3,
    },
  });
}

function showCandidates(map: MapLibreMap, candidates: DiscoveryCandidate[], selectedSlug?: string, previewedSlug?: string, fit = false) {
  const activeSlug = previewedSlug ?? selectedSlug;
  const features: Array<Feature<LineString, { slug: string; active: boolean; dimmed: boolean }>> = candidates
    .filter((candidate) => candidate.route.trace.length >= 2)
    .map((candidate) => ({
      type: "Feature" as const,
      properties: {
        slug: candidate.sourceRouteSlug,
        active: candidate.sourceRouteSlug === activeSlug,
        dimmed: Boolean(activeSlug && candidate.sourceRouteSlug !== activeSlug),
      },
      geometry: { type: "LineString" as const, coordinates: candidate.route.trace.map((point) => [point.lng, point.lat]) },
    }));
  (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(featureCollection(features));
  const activeCandidate = candidates.find((candidate) => candidate.sourceRouteSlug === activeSlug);
  const activeTrace = activeCandidate?.route.trace ?? [];
  const endpointFeatures: Array<Feature<Point, { kind: "start" | "finish" }>> = activeTrace.length >= 2
    ? [
        {
          type: "Feature",
          properties: { kind: "start" },
          geometry: { type: "Point", coordinates: [activeTrace[0].lng, activeTrace[0].lat] },
        },
        {
          type: "Feature",
          properties: { kind: "finish" },
          geometry: {
            type: "Point",
            coordinates: [activeTrace.at(-1)!.lng, activeTrace.at(-1)!.lat],
          },
        },
      ]
    : [];
  (map.getSource(ENDPOINT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(
    pointFeatureCollection(endpointFeatures),
  );
  if (fit) {
    if (candidates.length) fitCandidates(map, candidates);
    else resetCandidateViewport(map);
  }
}

function resetCandidateViewport(map: MapLibreMap) {
  map.easeTo({
    bearing: -8,
    center: [20, 28],
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
    pitch: 38,
    zoom: 1.55,
  });
}

function fitCandidates(map: MapLibreMap, candidates: DiscoveryCandidate[]) {
  const points = candidates.flatMap((candidate) => candidate.route.trace);
  if (points.length < 2) return;
  const bounds = new LngLatBounds();
  points.forEach((point) => bounds.extend([point.lng, point.lat]));
  map.fitBounds(bounds, {
    padding: window.innerWidth < 768
      ? { top: 128, right: 36, bottom: 310, left: 36 }
      : { top: 72, right: 96, bottom: 286, left: 430 },
    maxZoom: 13.6,
    pitch: 46,
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
  });
}

function featureCollection(features: Array<Feature<LineString>>): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features };
}

function pointFeatureCollection(features: Array<Feature<Point>>): FeatureCollection<Point> {
  return { type: "FeatureCollection", features };
}
