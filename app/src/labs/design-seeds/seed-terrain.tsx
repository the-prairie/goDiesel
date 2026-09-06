import { useEffect, useMemo, useRef } from "react";
import maplibregl, { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  applyJournalCartography, JOURNAL_PALETTE, type CartographyPalette,
} from "@/labs/design-seeds/seed-cartography";
import { lookupAtProgress } from "@/labs/design-seeds/seed-geometry";
import type { RouteSummary } from "@/domain/route";

/**
 * The journal plate's geographic pane.
 *
 * Sizing note: maplibre-gl.css sets `.maplibregl-map { position: relative }`
 * from an UNLAYERED stylesheet, which in Tailwind v4 outranks anything in
 * `@layer utilities` regardless of specificity. The production Atlas regional
 * fallback gives its host `absolute inset-0`, so `absolute` loses, `inset-0`
 * cannot stretch a relatively-positioned box, and the map collapses to 0px
 * (measured: container 1440x900, map 0px, canvas 1440x300). We size the host
 * with `h-full w-full` instead, which does not fight the third-party rule.
 */

export type TerrainTone = "journal" | "paper" | "sepia" | "instrument";

const STYLE_FOR_TONE: Record<TerrainTone, string> = {
  journal: "https://tiles.openfreemap.org/styles/liberty",
  paper: "https://tiles.openfreemap.org/styles/liberty",
  sepia: "https://tiles.openfreemap.org/styles/liberty",
  instrument: "https://tiles.openfreemap.org/styles/fiord",
};

/**
 * `journal` does its work in the style itself (see seed-cartography), so it
 * needs no post-hoc CSS filter. The other tones remain filter-based.
 */
const FILTER_FOR_TONE: Record<TerrainTone, string | undefined> = {
  journal: undefined,
  paper: "saturate(0.82) contrast(1.02) brightness(1.02)",
  sepia: "saturate(0.55) sepia(0.30) contrast(0.98) brightness(1.04)",
  instrument: "saturate(0.85) contrast(1.24) brightness(1.05)",
};

const LABEL_MAX_CHARS = 30;

function clampLabel(title: string) {
  if (title.length <= LABEL_MAX_CHARS) return title;
  const cut = title.slice(0, LABEL_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One anchor point per route, for labelling at any zoom. */
function labelCollection(routes: RouteSummary[], selectedSlug?: string) {
  return {
    type: "FeatureCollection" as const,
    features: routes
      .filter((route) => route.trace.length > 1)
      .map((route) => {
        const mid = route.trace[Math.floor(route.trace.length / 2)];
        return {
          type: "Feature" as const,
          properties: {
            slug: route.slug,
            selected: route.slug === selectedSlug ? 1 : 0,
            title: clampLabel(
              route.activityName.trim() || route.subtitle.trim() || route.name,
            ),
          },
          geometry: { type: "Point" as const, coordinates: [mid.lng, mid.lat] },
        };
      }),
  };
}

function featureCollection(routes: RouteSummary[], selectedSlug?: string) {
  return {
    type: "FeatureCollection" as const,
    features: routes
      .filter((route) => route.trace.length > 1)
      .map((route) => ({
        type: "Feature" as const,
        properties: {
          slug: route.slug,
          selected: route.slug === selectedSlug ? 1 : 0,
          title: route.activityName.trim() || route.subtitle.trim() || route.name,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: route.trace.map((point) => [point.lng, point.lat]),
        },
      })),
  };
}

/** Start and finish of the selected route, so the line has a direction. */
function endpointCollection(route: RouteSummary | undefined) {
  if (!route || route.trace.length < 2) {
    return { type: "FeatureCollection" as const, features: [] };
  }
  const first = route.trace[0];
  const last = route.trace[route.trace.length - 1];
  return {
    type: "FeatureCollection" as const,
    features: [
      { role: "start", point: first },
      { role: "finish", point: last },
    ].map(({ role, point }) => ({
      type: "Feature" as const,
      properties: { role },
      geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
    })),
  };
}

function boundsOf(routes: RouteSummary[]) {
  const points = routes.flatMap((route) => route.trace);
  if (!points.length) return null;
  let minLng = points[0].lng, maxLng = points[0].lng;
  let minLat = points[0].lat, maxLat = points[0].lat;
  for (const point of points) {
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
  }
  return new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
}

export interface SeedTerrainProps {
  routes: RouteSummary[];
  selectedSlug?: string;
  tone: TerrainTone;
  focusSelected?: boolean;
  labelTraces?: boolean;
  onSelect?: (slug: string) => void;
  padding?: number | maplibregl.PaddingOptions;
  attributionPosition?: "bottom-right" | "top-right" | "top-left" | "bottom-left";
  /**
   * Position along the selected route to mark, 0..1 of recorded distance.
   * Undefined removes the marker. This is the shared axis between the
   * elevation profile and the plate.
   */
  markerProgress?: number;
  /** Themed colours. MapLibre cannot read CSS variables, so they arrive here. */
  cartography?: CartographyPalette;
  /** Extra breathing room beyond the fitted bounds, so coastline stays in frame. */
  contextZoomOut?: number;
  /**
   * Signature continuity: open the camera on this framing, then ease once to
   * `padding`. The Atlas plate and the story use the same bounds for the same
   * route, so handing the Atlas framing in here means the recorded line does
   * not jump or redraw when you enter the day - it simply opens up.
   * Ignored under reduced motion, which starts at the destination framing.
   */
  openFrom?: number | maplibregl.PaddingOptions;
  className?: string;
}

export function SeedTerrain({
  routes,
  selectedSlug,
  tone,
  focusSelected = false,
  labelTraces = false,
  onSelect,
  padding = 72,
  attributionPosition = "bottom-right",
  markerProgress,
  contextZoomOut = 0,
  openFrom,
  cartography = JOURNAL_PALETTE,
  className,
}: SeedTerrainProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const readyRef = useRef(false);
  const frameRef = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const selectedRoute = useMemo(
    () => routes.find((route) => route.slug === selectedSlug),
    [routes, selectedSlug],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /*
     * Construct with the route's bounds already applied.
     *
     * Measured on a cold Atlas load: MapLibre painted its default camera first,
     * giving one blank frame at ~700ms and then ~0.9s of tiles at the wrong
     * place with the recorded route nowhere on screen, before the load handler
     * framed it. Handing `bounds` to the constructor means the first painted
     * frame is already the right place, so there is no default-world window.
     */
    const initialTarget = focusSelected && selectedRoute ? [selectedRoute] : routes;
    const initialBounds = boundsOf(initialTarget.length ? initialTarget : routes);

    const map = new maplibregl.Map({
      container: host,
      style: STYLE_FOR_TONE[tone],
      ...(initialBounds
        ? { bounds: initialBounds, fitBoundsOptions: { padding, animate: false } }
        : {}),
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      trackResize: true,
      /*
       * This workspace exists to be reviewed from rendered output, and MapLibre
       * defaults to preserveDrawingBuffer: false. Screenshots then read a
       * partially cleared WebGL buffer: on the day's 900x848 plate the upper
       * 240px came out transparent in every capture while
       * queryRenderedFeatures confirmed the route casing and landcover were
       * actually drawn there. Keeping the buffer costs some memory and fill
       * rate, and is a lab-only concession so captures match the screen.
       */
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    readyRef.current = false;

    // Attribution is required and must stay legible, so it is placed
    // explicitly rather than left under a gradient scrim.
    //
    // MapLibre's `_updateCompact` re-adds `maplibregl-compact-show` on every
    // resize and data update, so collapsing it in JS will not stick. Measured
    // at 390px it rendered 276x31 and covered the coastline at Loutro. Rather
    // than fight the control or hide required credit, it stays fully visible as
    // a single quiet line (see index.css) and the camera reserves room for it.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), attributionPosition);

    /*
     * Draw the route as soon as the STYLE is parsed, not when every tile has
     * finished. Measured on a cold Atlas load: the basemap painted the right
     * place at ~880ms but the recorded line did not appear until ~2850ms,
     * because sources and layers were added on `load`, which waits for tiles.
     * That left ~2s of "the place, without my route on it".
     *
     * The guard here must NOT be `isStyleLoaded()`. Despite the name it is not
     * "the style spec is parsed" - MapLibre's Style.loaded() also requires
     * every source cache to be loaded, so it stays false until tiles arrive.
     * Instrumented on a cold Atlas load: `styledata` fired at 785ms with
     * isStyleLoaded() === false, and it first returned true at 1765ms, 5ms
     * before `load`. Guarding on it silently reinstated the exact tile wait
     * this listener exists to avoid, costing ~1.0s of "my place without my
     * line on it". `styledata` is only emitted after Style._load, which is the
     * earliest point addSource/addLayer are legal, so the flag is the guard.
     */
    /*
     * `styledata` is not a one-shot event: MapLibre emits it again for every
     * style mutation, including the cartography recolouring below and each
     * `setData` on our own sources, and it would emit it again for a whole new
     * style if one were ever set. So the guard cannot be "have I run before" -
     * it has to be "are the layers actually present right now".
     *
     * Keying on the source makes the layer work idempotent (a repeated event
     * is a no-op instead of an "Source seed-routes already exists" throw) and
     * self-healing (a style replacement drops our layers with it, and the next
     * `styledata` puts them back rather than leaving the route invisible).
     * The one-time work - interaction handlers, canvas attributes - is guarded
     * separately, because those outlive a style swap and must not stack up.
     */
    let bound = false;

    /* Once per map, not once per style. */
    const bindOnce = () => {
      if (bound) return;
      bound = true;

      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("role");

      for (const layer of ["seed-routes-history", "seed-routes-selected"]) {
        map.on("click", layer, (event) => {
          const slug = event.features?.[0]?.properties?.slug;
          if (typeof slug === "string") onSelectRef.current?.(slug);
        });
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }
    };

    /* Called only from `styledata` and `load`, both of which are emitted after
       the style is loaded, so addSource/addLayer are legal here. */
    const initialise = () => {
      if (map.getSource("seed-routes")) {
        if (!bound) bindOnce();
        return;
      }
      if (tone === "journal") applyJournalCartography(map, cartography);

      map.addSource("seed-routes", {
        type: "geojson",
        data: featureCollection(routes, selectedSlug),
      });
      map.addSource("seed-endpoints", {
        type: "geojson",
        data: endpointCollection(selectedRoute),
      });

      // Everything she has run here, quiet and cobalt. No markers.
      map.addLayer({
        id: "seed-routes-history",
        type: "line",
        source: "seed-routes",
        filter: ["==", ["get", "selected"], 0],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": cartography.routeHistory,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 13, 2.4],
          "line-opacity": 0.42,
        },
      });

      // The selected route, in three coordinated passes: a soft paper bloom to
      // lift it off the landform, a paper casing to keep it legible over
      // roads and coastline, then the coral line itself.
      map.addLayer({
        id: "seed-routes-selected-bloom",
        type: "line",
        source: "seed-routes",
        filter: ["==", ["get", "selected"], 1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": cartography.routeCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 9, 13, 16],
          "line-blur": 5,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "seed-routes-selected-casing",
        type: "line",
        source: "seed-routes",
        filter: ["==", ["get", "selected"], 1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": cartography.routeCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5.5, 13, 9],
          "line-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "seed-routes-selected",
        type: "line",
        source: "seed-routes",
        filter: ["==", ["get", "selected"], 1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": cartography.route,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.4, 13, 4.2],
        },
      });

      // Start and finish: a filled cap and a ringed cap, so the line has a story.
      map.addLayer({
        id: "seed-endpoints",
        type: "circle",
        source: "seed-endpoints",
        paint: {
          "circle-radius": ["case", ["==", ["get", "role"], "start"], 4.5, 5.5],
          "circle-color": ["case", ["==", ["get", "role"], "start"], cartography.route, cartography.routeCasing],
          "circle-stroke-color": ["case", ["==", ["get", "role"], "start"], cartography.routeCasing, cartography.route],
          "circle-stroke-width": 2,
        },
      });

      if (labelTraces) {
        map.addSource("seed-labels", {
          type: "geojson",
          data: labelCollection(routes, selectedSlug),
        });
        map.addLayer({
          id: "seed-routes-label",
          type: "symbol",
          source: "seed-labels",
          layout: {
            // The openfreemap styles only serve the "Noto Sans Regular" glyph
            // stack. Omitting text-font makes MapLibre request its default
            // Open Sans stack, which 404s and drops every label silently.
            "text-font": ["Noto Sans Regular"],
            "text-field": ["get", "title"],
            "text-size": ["case", ["==", ["get", "selected"], 1], 13, 11.5],
            "text-letter-spacing": 0.03,
            "text-max-width": 9,
            "text-allow-overlap": true,
            "text-anchor": "top",
            "text-offset": [0, 0.8],
          },
          paint: {
            "text-color": ["case", ["==", ["get", "selected"], 1], "#ffd2c2", "#e8eef4"],
            "text-halo-color": "rgba(6,10,15,0.96)",
            "text-halo-width": 2.2,
          },
        });
      }

      readyRef.current = true;
      /*
       * The canvas is a rendering, not a control.
       *
       * Left focusable it landed second in the day's tab order - ahead of the
       * elevation inspection and Replay - and MapLibre's arrow-key panning
       * would fight the profile slider, which is the accessible way to inspect
       * a position here. It is also wrong to keep focusable content inside an
       * aria-hidden container. So the canvas is taken out of the tab order and
       * hidden from assistive tech, while the attribution links stay reachable.
       */
      // Reconcile the render size with the element once the style is up, in
      // case the column settled after construction.
      map.resize();
      frame(map, true);
      bindOnce();
    };

    map.on("styledata", initialise);
    // Safety net only: if `styledata` were ever missed, `load` still draws the
    // route rather than leaving the plate empty.
    map.on("load", initialise);

    /**
     * MapLibre's own `trackResize` listens to the window, not the container.
     * These plates are sized from grid and dvh maths that can settle after the
     * map has read its height, and a container that never triggers a window
     * resize would keep a stale render size. Observing the host closes that gap.
     */
    const observer = new ResizeObserver(() => {
      map.resize();
      frameRef.current?.();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      // Drop our own listeners before the map goes, so a late `styledata`
      // during teardown cannot run `initialise` against a dying map.
      map.off("styledata", initialise);
      map.off("load", initialise);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // Style/tone changes rebuild the map; data changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tone, labelTraces, attributionPosition, cartography]);

  /**
   * Camera. Short and interruptible: `essential: false` lets a user gesture
   * cancel it, and reduced motion collapses it to an instant cut so the same
   * information arrives without movement.
   */
  function frame(map: MapLibreMap, immediate = false) {
    const target = focusSelected && selectedRoute ? [selectedRoute] : routes;
    const bounds = boundsOf(target.length ? target : routes);
    if (!bounds) return;
    const reduced = prefersReducedMotion();

    /*
     * `fitBounds`, not `cameraForBounds` + `jumpTo`.
     *
     * Measured: framing with cameraForBounds and then jumping to its
     * center/zoom left a blank band at the top of the plate exactly the height
     * of the `bottom` padding (232px padding -> first painted row 241). The
     * padding was leaking into the rendered viewport as an offset. fitBounds
     * applies padding correctly, so it is the only camera call here.
     *
     * contextZoomOut is expressed as a maxZoom ceiling so it still resolves in
     * a single move rather than a fit followed by a zoom.
     */
    const ceiling = contextZoomOut > 0
      ? (() => {
          const fitted = map.cameraForBounds(bounds, { padding });
          const zoom = fitted?.zoom;
          return typeof zoom === "number" ? Math.max(zoom - contextZoomOut, 0) : undefined;
        })()
      : undefined;

    const options = {
      padding,
      ...(ceiling === undefined ? {} : { maxZoom: ceiling }),
    };

    // First paint with a handover framing: start where the previous surface
    // left the line, then open to this surface's framing in one short move.
    if (immediate && openFrom !== undefined && !reduced) {
      map.fitBounds(bounds, { ...options, padding: openFrom, duration: 0 });
      map.fitBounds(bounds, {
        ...options,
        duration: 520,
        easing: (t) => 1 - (1 - t) ** 3,
        essential: false,
      });
      return;
    }

    if (immediate || reduced) {
      map.fitBounds(bounds, { ...options, duration: 0 });
      return;
    }
    map.fitBounds(bounds, {
      ...options,
      duration: 420,
      easing: (t) => 1 - (1 - t) ** 3,
      essential: false,
    });
  }

  // Re-framing on container resize, without re-running the opening handover.
  frameRef.current = () => {
    const map = mapRef.current;
    if (map && readyRef.current) frame(map);
  };

  // Data + framing updates without tearing the map down.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource("seed-routes");
    if (source && "setData" in source) {
      (source as maplibregl.GeoJSONSource).setData(featureCollection(routes, selectedSlug));
    }
    const endpoints = map.getSource("seed-endpoints");
    if (endpoints && "setData" in endpoints) {
      (endpoints as maplibregl.GeoJSONSource).setData(endpointCollection(selectedRoute));
    }
    const labels = map.getSource("seed-labels");
    if (labels && "setData" in labels) {
      (labels as maplibregl.GeoJSONSource).setData(labelCollection(routes, selectedSlug));
    }
    frame(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, selectedSlug, focusSelected, padding, contextZoomOut, selectedRoute]);

  // The shared position marker, driven by the elevation profile.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const trace = selectedRoute?.trace;
    if (markerProgress === undefined || !trace || trace.length < 2) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const point = lookupAtProgress(trace, markerProgress);
    if (!point) return;
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = "seed-route-marker";
      markerRef.current = new maplibregl.Marker({ element, pitchAlignment: "map" })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      return;
    }
    markerRef.current.setLngLat([point.lng, point.lat]);
  }, [markerProgress, selectedRoute]);

  return (
    <div
      // h-full w-full, not `absolute inset-0`: see the sizing note above.
      className={`h-full w-full ${className ?? ""}`}
      style={{
        // Pre-paint frames read as ground, not as a gap in the page.
        background: cartography.land,
        ...(FILTER_FOR_TONE[tone] ? { filter: FILTER_FOR_TONE[tone] } : {}),
      }}
      data-seed-terrain={tone}
      ref={hostRef}
    />
  );
}
