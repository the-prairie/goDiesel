import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from "maplibre-gl";

import {
  DEM_SOURCE_ID,
  RELIEF_PALETTE,
  applyReliefCartography,
  applyReliefSky,
  attachRelief,
  clearReliefSky,
  type ReliefPalette,
} from "@/labs/design-seeds/seed-relief";
import { lookupAtProgress } from "@/labs/design-seeds/seed-geometry";
import type { RoutePoint, RouteSummary } from "@/domain/route";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

const SRC_HISTORY = "relief-history";
const SRC_ROUTE = "relief-route";
const SRC_ENDS = "relief-ends";

export interface ThreadPhoto {
  /** Where along the recorded distance the photograph was taken. Real data. */
  atDistanceM: number;
  title: string;
  url: string;
}

export interface SeedReliefMapProps {
  /** Every day recorded in this region. The collection is the point. */
  routes: RouteSummary[];
  selectedSlug?: string;
  /** Full trace of the selected day when the surface has it; falls back to the summary. */
  selectedTrace?: RoutePoint[];
  /** Frame the selected day, or open out to the whole region. */
  focusSelected?: boolean;
  /** 0..1 along the selected day. The thread's position. */
  progress?: number;
  onProgress?: (progress: number | undefined) => void;
  onSelect?: (slug: string) => void;
  /** Photographs at their recorded distances, when the day has any. */
  photos?: ThreadPhoto[];
  pitch?: number;
  padding?: number | maplibregl.PaddingOptions;
  /** Run the descent, then call back. Set to null when not descending. */
  descend?: { progress: number } | null;
  onDescended?: () => void;
  palette?: ReliefPalette;
  /** Label for the thread control, spoken by assistive technology. */
  threadLabel?: string;
  className?: string;
}

function boundsOf(points: RoutePoint[]): LngLatBoundsLike | null {
  if (!points.length) return null;
  let minLng = points[0].lng, maxLng = points[0].lng;
  let minLat = points[0].lat, maxLat = points[0].lat;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

const lineFeature = (points: RoutePoint[], properties: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  properties,
  geometry: {
    type: "LineString" as const,
    coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
  },
});

const pointFeature = (point: RoutePoint, properties: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  properties,
  geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] as [number, number] },
});

type AnyFeature = ReturnType<typeof lineFeature> | ReturnType<typeof pointFeature>;

const collection = (features: AnyFeature[]) => ({
  type: "FeatureCollection" as const,
  features,
});

/** Nearest recorded vertex to a map point, as a fraction of recorded distance. */
function progressAtLngLat(trace: RoutePoint[], lng: number, lat: number) {
  if (trace.length < 2) return 0;
  let best = 0;
  let bestGap = Infinity;
  // Scale longitude by latitude so the comparison is not stretched near the poles.
  const scale = Math.cos((lat * Math.PI) / 180) || 1;
  for (let i = 0; i < trace.length; i += 1) {
    const dx = (trace[i].lng - lng) * scale;
    const dy = trace[i].lat - lat;
    const gap = dx * dx + dy * dy;
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  const total = trace[trace.length - 1].d ?? 0;
  return total > 0 ? (trace[best].d ?? 0) / total : best / (trace.length - 1);
}

/**
 * The geography, modelled.
 *
 * One persistent map for a whole visit: changing day flies the camera instead
 * of tearing down a renderer, which is what lets a region read as one place
 * seen many times rather than as a series of unrelated plates.
 *
 * The thread - the recorded line, its handle, and the photographs pinned along
 * it - is drawn as DOM over the canvas rather than as MapLibre markers, so the
 * handle can be a real focusable `role="slider"` with a 48px target and the
 * photographs can be real buttons.
 */
export function SeedReliefMap({
  routes,
  selectedSlug,
  selectedTrace,
  focusSelected = true,
  progress,
  onProgress,
  onSelect,
  photos = [],
  pitch = 0,
  padding = 64,
  descend = null,
  onDescended,
  palette = RELIEF_PALETTE,
  threadLabel = "recorded route",
  className,
}: SeedReliefMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  const onSelectRef = useRef(onSelect);
  const onDescendedRef = useRef(onDescended);
  onProgressRef.current = onProgress;
  onSelectRef.current = onSelect;
  onDescendedRef.current = onDescended;

  const selected = useMemo(
    () => routes.find((route) => route.slug === selectedSlug),
    [routes, selectedSlug],
  );
  const trace = useMemo(
    () => (selectedTrace?.length ? selectedTrace : (selected?.trace ?? [])),
    [selectedTrace, selected],
  );
  const totalM = trace.length ? (trace[trace.length - 1].d ?? 0) : 0;

  /** Screen positions for the overlay, recomputed whenever the camera moves. */
  const [handlePoint, setHandlePoint] = useState<{ x: number; y: number } | null>(null);
  const [photoPoints, setPhotoPoints] = useState<{ x: number; y: number; photo: ThreadPhoto }[]>([]);
  const [dragging, setDragging] = useState(false);

  /* ------------------------------ The renderer ----------------------------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initialBounds = boundsOf(
      focusSelected && trace.length ? trace : routes.flatMap((r) => r.trace),
    );

    const map = new maplibregl.Map({
      container: host,
      style: STYLE,
      ...(initialBounds
        ? { bounds: initialBounds, fitBoundsOptions: { padding, animate: false } }
        : {}),
      /*
       * Pitched from construction, not eased into afterwards.
       *
       * Applying the pitch after load re-tiled the terrain a second time and
       * pushed the first frame of the recorded route from ~900ms to ~1.7s. The
       * first painted frame is now already the right camera.
       */
      pitch,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      /*
       * The thread is the gesture on this surface. Left at MapLibre's defaults
       * a drag that begins on the map pans the map instead - measured on the
       * baseline at 390x844, a flick starting on the map scrolled the page 0px
       * where the same flick on the prose scrolled 658px. Here the reader drags
       * the recorded line, and the page keeps its scroll.
       */
      dragPan: false,
      scrollZoom: false,
      touchZoomRotate: false,
      doubleClickZoom: false,
      keyboard: false,
      maxPitch: 70,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    const build = () => {
      if (map.getSource(SRC_ROUTE)) return;
      applyReliefCartography(map, palette);
      attachRelief(map, palette);

      map.addSource(SRC_HISTORY, { type: "geojson", data: collection([]) });
      /* lineMetrics lets the travelled length be a gradient stop rather than a
         second geometry re-sent on every pointer move. */
      map.addSource(SRC_ROUTE, { type: "geojson", lineMetrics: true, data: collection([]) });
      map.addSource(SRC_ENDS, { type: "geojson", data: collection([]) });

      /*
       * The rest of the visit. Drawn with its own casing: at 1.1px in a
       * translucent grey the other seven Crete days were invisible on hillshaded
       * ground, which defeated the whole point of showing the collection.
       */
      map.addLayer({
        id: "relief-history-casing",
        type: "line",
        source: SRC_HISTORY,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.routeCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 13, 7],
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "relief-history-line",
        type: "line",
        source: SRC_HISTORY,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.routeHistory,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.9, 13, 3.4],
        },
      });
      map.addLayer({
        id: "relief-route-casing",
        type: "line",
        source: SRC_ROUTE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": palette.routeCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 5.5, 13, 9],
          "line-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "relief-route-line",
        type: "line",
        source: SRC_ROUTE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.4, 13, 5],
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            palette.route,
            1,
            palette.route,
          ],
        },
      });
      map.addLayer({
        id: "relief-ends",
        type: "circle",
        source: SRC_ENDS,
        paint: {
          "circle-radius": 5,
          "circle-color": palette.routeCasing,
          "circle-stroke-width": 2,
          "circle-stroke-color": palette.route,
        },
      });

      const canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("role");

      readyRef.current = true;
      map.resize();
      // @ts-expect-error lab probe: lets a capture script read the live camera.
      window.__reliefMap = map;
      /* A click on another day's line selects it: the collection is navigable. */
      map.on("click", "relief-history-line", (event) => {
        const slug = event.features?.[0]?.properties?.slug;
        if (typeof slug === "string") onSelectRef.current?.(slug);
      });
      map.on("mouseenter", "relief-history-line", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "relief-history-line", () => {
        map.getCanvas().style.cursor = "";
      });
    };

    map.on("styledata", build);
    map.on("load", build);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);

    return () => {
      observer.disconnect();
      map.off("styledata", build);
      map.off("load", build);
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
    // The renderer outlives day changes on purpose; data and camera update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  /* -------------------------------- The data ------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const push = () => {
      if (!readyRef.current) return;
      const history = map.getSource(SRC_HISTORY) as maplibregl.GeoJSONSource | undefined;
      const route = map.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource | undefined;
      const ends = map.getSource(SRC_ENDS) as maplibregl.GeoJSONSource | undefined;
      history?.setData(
        collection(
          routes
            .filter((r) => r.slug !== selectedSlug && r.trace.length > 1)
            .map((r) => lineFeature(r.trace, { slug: r.slug })),
        ),
      );
      route?.setData(collection(trace.length > 1 ? [lineFeature(trace)] : []));
      ends?.setData(
        collection(
          trace.length > 1
            ? [
                pointFeature(trace[0], { role: "start" }),
                pointFeature(trace[trace.length - 1], { role: "finish" }),
              ]
            : [],
        ),
      );
    };
    push();
    map.on("styledata", push);
    return () => {
      map.off("styledata", push);
    };
  }, [routes, selectedSlug, trace]);

  /* ----------------------------- Travelled length -------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("relief-route-line")) return;
    const at = progress ?? -1;
    if (at < 0) {
      map.setPaintProperty("relief-route-line", "line-gradient", [
        "interpolate", ["linear"], ["line-progress"],
        0, palette.route, 1, palette.route,
      ]);
      return;
    }
    const stop = Math.min(0.999, Math.max(0.001, at));
    map.setPaintProperty("relief-route-line", "line-gradient", [
      "interpolate", ["linear"], ["line-progress"],
      0, palette.routeTravelled,
      stop, palette.routeTravelled,
      Math.min(1, stop + 0.001), palette.route,
      1, palette.route,
    ]);
  }, [progress, palette]);

  /* --------------------------------- Camera -------------------------------- */
  /*
   * Padding and framing arrive as fresh object and array literals on every
   * render. Depending on them directly restarted the ease on each one, which
   * cancelled the pitch before it arrived and left the camera flat.
   */
  const framing = useMemo(
    () => boundsOf(focusSelected && trace.length ? trace : routes.flatMap((r) => r.trace)),
    [focusSelected, trace, routes],
  );
  const framingKey = framing ? JSON.stringify(framing) : "";
  const paddingKey = JSON.stringify(padding);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !framingKey) return;
    const target = JSON.parse(framingKey) as LngLatBoundsLike;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const settle = () => {
      const camera = map.cameraForBounds(target, { padding: JSON.parse(paddingKey) });
      if (!camera) return;
      /*
       * Fly, do not cut. Moving from one day to the next across the same
       * landform is what makes a region read as one place; a jump makes it read
       * as a slideshow.
       */
      map.easeTo({
        center: camera.center,
        zoom: camera.zoom,
        bearing: 0,
        pitch,
        duration: reduced ? 0 : 900,
        essential: true,
      });
    };
    if (readyRef.current) settle();
    /* `idle` on a terrain map can be seconds away; the style is enough. */
    else map.once("styledata", settle);
  }, [framingKey, paddingKey, pitch]);

  /*
   * Terrain only when the camera is pitched, and never before the route has
   * painted.
   *
   * Measured on a cold day: layers and route geometry were in at 916ms, the
   * same as the flat baseline, but the recorded line did not appear until
   * ~1.7s - because a line draped on terrain waits for the DEM tiles under it,
   * and 21 elevation tiles were still arriving. Draping it after the first idle
   * keeps the route-first guarantee: the line lands on the right camera at
   * ~900ms, then the ground rises to meet it.
   */
  const terrainSeeded = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!readyRef.current || !map.getSource(DEM_SOURCE_ID)) return;
      if (pitch > 4) {
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1.35 });
        applyReliefSky(map);
      } else {
        map.setTerrain(null);
        clearReliefSky(map);
      }
    };
    if (terrainSeeded.current) {
      apply();
      map.on("styledata", apply);
      return () => {
        map.off("styledata", apply);
      };
    }
    /* Nothing may drape until the line has painted, including a styledata
       handler - binding it early was why the first attempt changed nothing. */
    const seed = () => {
      terrainSeeded.current = true;
      apply();
      map.on("styledata", apply);
    };
    map.once("idle", seed);
    return () => {
      map.off("idle", seed);
      map.off("styledata", apply);
    };
  }, [pitch]);

  /* ------------------------ Overlay screen positions ----------------------- */
  /*
   * Reprojected on every rendered frame, so the thread stays welded to the
   * ground while the camera moves. Every setter compares first and returns the
   * previous value when nothing moved: without that, handing React a fresh
   * array on each of MapLibre's render events is an update loop, which is
   * exactly what the first run of this surface did - 2,150 "maximum update
   * depth exceeded" errors on the region, where there is no handle and the
   * empty array was newly allocated every frame.
   */
  const reproject = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const at = progress === undefined ? null : lookupAtProgress(trace, progress);
    const next = at
      ? (() => {
          const p = map.project([at.lng, at.lat]);
          return { x: Math.round(p.x), y: Math.round(p.y) };
        })()
      : null;
    setHandlePoint((prev) => {
      if (prev === next) return prev;
      if (!prev || !next) return next;
      return prev.x === next.x && prev.y === next.y ? prev : next;
    });

    const nextPhotos =
      !photos.length || !totalM
        ? []
        : photos.flatMap((photo) => {
            const point = lookupAtProgress(trace, Math.min(1, photo.atDistanceM / totalM));
            if (!point) return [];
            const p = map.project([point.lng, point.lat]);
            return [{ x: Math.round(p.x), y: Math.round(p.y), photo }];
          });
    setPhotoPoints((prev) => {
      if (prev.length === 0 && nextPhotos.length === 0) return prev;
      if (prev.length !== nextPhotos.length) return nextPhotos;
      const same = prev.every(
        (item, i) =>
          item.x === nextPhotos[i].x &&
          item.y === nextPhotos[i].y &&
          item.photo.url === nextPhotos[i].photo.url,
      );
      return same ? prev : nextPhotos;
    });
  }, [progress, trace, photos, totalM]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    reproject();
    map.on("move", reproject);
    map.on("render", reproject);
    return () => {
      map.off("move", reproject);
      map.off("render", reproject);
    };
  }, [reproject]);

  /* -------------------------------- Descent -------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !descend || !trace.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = lookupAtProgress(trace, descend.progress);
    if (reduced || !at) {
      onDescendedRef.current?.();
      return;
    }
    /*
     * Look along the line, not straight down at it.
     *
     * The first descent zoomed to ~15 and kept the camera's bearing, which
     * arrived nose-down on a patch of ground past the DEM's z15 detail - flat,
     * pale, and nowhere. Turning to the direction of travel and stopping at
     * z13.8 arrives standing on the route looking the way she was going, which
     * is the whole claim of the transition.
     */
    const ahead = lookupAtProgress(trace, Math.min(1, descend.progress + 0.03));
    const bearing =
      ahead && (ahead.lng !== at.lng || ahead.lat !== at.lat)
        ? (Math.atan2(
            (ahead.lng - at.lng) * Math.cos((at.lat * Math.PI) / 180),
            ahead.lat - at.lat,
          ) *
            180) /
          Math.PI
        : map.getBearing();
    map.easeTo({
      center: [at.lng, at.lat],
      zoom: Math.min(Math.max(map.getZoom() + 1.2, 13.4), 13.8),
      pitch: 70,
      bearing,
      duration: 1250,
      essential: true,
    });
    const timer = window.setTimeout(() => onDescendedRef.current?.(), 1300);
    return () => window.clearTimeout(timer);
  }, [descend, trace]);

  /* ------------------------------- The thread ------------------------------ */
  const report = useCallback(
    (next: number | undefined) => {
      onProgressRef.current?.(
        next === undefined ? undefined : Math.min(1, Math.max(0, next)),
      );
    },
    [],
  );

  const pointerToProgress = useCallback(
    (clientX: number, clientY: number) => {
      const map = mapRef.current;
      const host = hostRef.current;
      if (!map || !host || trace.length < 2) return;
      const box = host.getBoundingClientRect();
      const lngLat = map.unproject([clientX - box.left, clientY - box.top]);
      report(progressAtLngLat(trace, lngLat.lng, lngLat.lat));
    },
    [trace, report],
  );

  const onHandleDown = (event: React.PointerEvent) => {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const onHandleMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    pointerToProgress(event.clientX, event.clientY);
  };
  const onHandleUp = (event: React.PointerEvent) => {
    if (!dragging) return;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  const step = (delta: number) => report((progress ?? 0) + delta);
  const at = progress !== undefined && trace.length ? lookupAtProgress(trace, progress) : null;

  return (
    <div ref={hostRef} className={`relative h-full w-full ${className ?? ""}`}>
      {/*
        The overlay carries the thread. It is transparent to pointer events
        except on its own controls, so the map beneath stays clickable and the
        page keeps its scroll.
      */}
      <div className="pointer-events-none absolute inset-0">
        {photoPoints.map(({ x, y, photo }) => (
          <button
            key={photo.url}
            type="button"
            className="seed-thread-photo pointer-events-auto absolute"
            style={{ left: x, top: y }}
            aria-label={`${photo.title}. Taken ${(photo.atDistanceM / 1000).toFixed(1)} kilometres in. Inspect here.`}
            onClick={() => totalM && report(photo.atDistanceM / totalM)}
          >
            <span aria-hidden="true" />
          </button>
        ))}

        {handlePoint ? (
          <div
            className="seed-thread-handle pointer-events-auto absolute"
            style={{ left: handlePoint.x, top: handlePoint.y }}
            data-dragging={dragging ? "true" : "false"}
          >
            <div
              role="slider"
              tabIndex={0}
              aria-label={`${threadLabel}: hold and drag along the recorded line`}
              aria-valuemin={0}
              aria-valuemax={Math.round(totalM)}
              aria-valuenow={Math.round((progress ?? 0) * totalM)}
              aria-valuetext={
                at
                  ? `${(at.d / 1000).toFixed(1)} kilometres, ${Math.round(at.elev)} metres altitude`
                  : "not inspected"
              }
              className="seed-thread-grab seed-focus"
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              onKeyDown={(event) => {
                const fine = event.shiftKey ? 0.002 : 0.02;
                if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); step(fine); }
                else if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); step(-fine); }
                else if (event.key === "Home") { event.preventDefault(); report(0); }
                else if (event.key === "End") { event.preventDefault(); report(1); }
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
