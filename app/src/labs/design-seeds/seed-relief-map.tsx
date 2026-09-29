import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from "maplibre-gl";

import { RELIEF_PALETTE, type ReliefPalette } from "@/ui/maps/relief-style";
import { ReliefWorld, carryReliefWorld, type ReliefState } from "@/ui/maps/relief-world";
import { reliefCamera } from "@/ui/maps/relief-camera";
import { nearestProjectedDistance, recordedPointAt } from "@/domain/geometry/recorded-thread";
import { lookupAtProgress } from "@/labs/design-seeds/seed-geometry";
import { useResolvedRouteGaps } from "@/labs/design-seeds/use-resolved-route-gaps";
import type { RoutePoint, RouteSummary, RouteDiscontinuityEvidence } from "@/domain/route";

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
  gaps?: RouteDiscontinuityEvidence[];
  exploring?: boolean;
  onDragChange?: (dragging: boolean) => void;
  onTerrainState?: (state: ReliefState) => void;
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
  gaps: gapsProp,
  exploring = false,
  onDragChange,
  onTerrainState,
  palette = RELIEF_PALETTE,
  threadLabel = "recorded route",
  className,
}: SeedReliefMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const worldRef = useRef<ReliefWorld | null>(null);
  const carryRef = useRef(false);
  const [terrainState, setTerrainState] = useState<ReliefState>("loading");
  const progressRef = useRef(progress);
  progressRef.current = progress;
  // Recorded gaps for every overview line, and for the selected one when the
  // caller has not supplied its detail's (the region view draws summaries).
  const resolvedRoutes = useResolvedRouteGaps(routes);
  const selectedGapsKnown = gapsProp !== undefined || resolvedRoutes.some((route) => route.slug === selectedSlug);
  const gaps = useMemo(
    () => gapsProp ?? resolvedRoutes.find((route) => route.slug === selectedSlug)?.discontinuities ?? [],
    [gapsProp, resolvedRoutes, selectedSlug],
  );
  const gapsRef = useRef(gaps);
  gapsRef.current = gaps;
  const selectedSlugRef = useRef(selectedSlug);
  selectedSlugRef.current = selectedSlug;
  const draggingRef = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const onProgressRef = useRef(onProgress);
  const onSelectRef = useRef(onSelect);
  const onDescendedRef = useRef(onDescended);
  const onTerrainStateRef = useRef(onTerrainState);
  onTerrainStateRef.current = onTerrainState;
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

    const world = new ReliefWorld(host, {
      ...(initialBounds ? { bounds: initialBounds, fitBoundsOptions: { padding, animate: false } } : {}),
      pitch,
    }, palette);
    worldRef.current = world;
    const map = world.map;
    mapRef.current = map;
    readyRef.current = true;
    // Lab probe retained for route / camera evidence, never product state.
    // @ts-expect-error lab probe
    window.__reliefMap = map;
    const unsubscribe = world.subscribe(state => { setTerrainState(state); onTerrainStateRef.current?.(state); });
    const selectDay = (event: maplibregl.MapLayerMouseEvent) => {
      const slug = event.features?.[0]?.properties?.slug;
      if (typeof slug === "string") onSelectRef.current?.(slug);
    };
    map.on("click", "relief-history-line", selectDay);
    return () => {
      unsubscribe();
      map.off("click", "relief-history-line", selectDay);
      readyRef.current = false;
      mapRef.current = null;
      worldRef.current = null;
      if (carryRef.current && selectedSlugRef.current) carryReliefWorld(world, selectedSlugRef.current);
      else world.destroy();
    };
    // The world outlives data and camera updates. D alone may hand it to Replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  const gapsKey = JSON.stringify(gaps);
  useEffect(() => {
    // A line is drawn only once its gaps are known: never a bridge in the meantime.
    worldRef.current?.setRoutes(resolvedRoutes, selectedSlug, selectedGapsKnown ? trace : [], JSON.parse(gapsKey));
  }, [resolvedRoutes, selectedSlug, trace, gapsKey, selectedGapsKnown]);

  useEffect(() => {
    worldRef.current?.setProgress(progress === undefined ? undefined : progress * totalM);
  }, [progress, totalM]);

  useEffect(() => { worldRef.current?.explore(exploring); }, [exploring]);

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
    if (exploring) return;
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
  }, [framingKey, paddingKey, pitch, exploring]);

  // Geographic bounds alone do not frame raised terrain. Once the DEM settles,
  // place its projected trace inside the page's actual open pane. Never move the
  // camera beneath an active route drag or deliberate geographic exploration.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || terrainState !== "ready" || exploring || descend || !trace.length || draggingRef.current) return;
    let stopped = false;
    const frame = () => {
      if (stopped || draggingRef.current) return;
      const points = (focusSelected ? trace : routes.flatMap(r => r.trace)).map(p => map.project([p.lng, p.lat]));
      const pad = JSON.parse(paddingKey);
      const edge = (side: string) => typeof pad === "number" ? pad : pad[side] ?? 0;
      const width = map.getCanvas().clientWidth, height = map.getCanvas().clientHeight;
      const x = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
      const y = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
      const dx = x - (edge("left") + width - edge("right")) / 2;
      const dy = y - (edge("top") + height - edge("bottom")) / 2;
      if (Math.hypot(dx, dy) > 8) map.panBy([dx, dy], { duration: 0 });
    };
    // Wait out the existing geographic fit before correcting its projection.
    const timer = window.setTimeout(frame, 950);
    return () => { stopped = true; clearTimeout(timer); };
  }, [terrainState, framingKey, paddingKey, exploring, focusSelected, trace, routes, descend]);

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

    const at = progress === undefined ? null : recordedPointAt(trace, progress * totalM, gapsRef.current);
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
  const descendingProgress = descend?.progress;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || descendingProgress === undefined || !trace.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const camera = reliefCamera(map, trace, descendingProgress * totalM, gapsRef.current);
    if (!camera) return;
    if (worldRef.current) worldRef.current.viewBearing = camera.options.bearing;
    // A frozen physical target prevents terrain arrival from pulling the eye off
    // the held point midway through the descent. Playback uses the same solver.
    map.stop();
    map.setCenterClampedToGround(false);
    const finish = () => {
      carryRef.current = true;
      onDescendedRef.current?.();
    };
    // MapLibre 5's easeTo ignores explicit elevation. Interpolate all camera
    // terms together through jumpTo, whose elevation is part of the contract.
    const start = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), elevation: map.getCenterElevation(), padding: map.getPadding() };
    const target = camera.options;
    const end = maplibregl.LngLat.convert(target.center!);
    const turn = ((target.bearing! - start.bearing + 540) % 360) - 180;
    const begin = performance.now();
    const duration = reduced ? 0 : 1800;
    let frame = 0;
    const tick = (now: number) => {
      const t = duration ? Math.min(1, (now - begin) / duration) : 1;
      // First bring the chosen point into the open landscape. Then turn and
      // approach around it. Rotating around the old overview centre can swing
      // the selected ridge off screen even when both endpoint cameras fit.
      const settle = Math.min(1, t / 0.42);
      const approach = Math.max(0, (t - 0.42) / 0.58);
      const ease = settle * settle * (3 - 2 * settle);
      const move = approach * approach * (3 - 2 * approach);
      const mix = (a: number, b: number) => a + (b - a) * ease;
      map.jumpTo({ center: [mix(start.center.lng, end.lng), mix(start.center.lat, end.lat)],
        zoom: start.zoom + (target.zoom! - start.zoom) * move, pitch: start.pitch + (target.pitch! - start.pitch) * move,
        bearing: start.bearing + turn * move, elevation: mix(start.elevation, target.elevation!),
        padding: { top: mix(start.padding.top ?? 0, 80), right: mix(start.padding.right ?? 0, 0), bottom: mix(start.padding.bottom ?? 0, 0), left: mix(start.padding.left ?? 0, 0) },
      });
      if (t < 1) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [descendingProgress, trace, totalM]);

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
      const projected = trace.map(point => ({ ...map.project([point.lng, point.lat]), d: point.d }));
      const held = progressRef.current === undefined ? null : recordedPointAt(trace, progressRef.current * totalM, gapsRef.current);
      const anchor = held ? map.project([held.lng, held.lat]) : null;
      // Move relative to the held point's current projection. If a DEM tile
      // arrives under a held thumb, its next move must not select another ridge.
      const x = anchor && lastPointer.current ? anchor.x + clientX - lastPointer.current.x : clientX - box.left;
      const y = anchor && lastPointer.current ? anchor.y + clientY - lastPointer.current.y : clientY - box.top;
      lastPointer.current = { x: clientX, y: clientY };
      const nearest = nearestProjectedDistance(projected, x, y,
        progressRef.current === undefined ? undefined : progressRef.current * totalM, gapsRef.current);
      if (nearest.distanceM !== undefined) report(nearest.distanceM / totalM);
    },
    [trace, report, totalM],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || exploring || descendingProgress !== undefined) return;
    const inspect = (event: maplibregl.MapMouseEvent) => {
      if ((event.originalEvent.target as HTMLElement)?.closest("button, [role=slider]")) return;
      const points = trace.map(point => ({ ...map.project([point.lng, point.lat]), d: point.d }));
      const nearest = nearestProjectedDistance(points, event.point.x, event.point.y,
        progressRef.current === undefined ? undefined : progressRef.current * totalM, gapsRef.current);
      if (nearest.distanceM !== undefined && nearest.pixelDistance <= 24) report(nearest.distanceM / totalM);
    };
    map.on("click", inspect);
    return () => { map.off("click", inspect); };
  }, [trace, totalM, report, exploring, descendingProgress]);

  const onHandleDown = (event: React.PointerEvent) => {
    event.preventDefault();
    lastPointer.current = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onDragChange?.(true);
  };
  const onHandleMove = (event: React.PointerEvent) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    pointerToProgress(event.clientX, event.clientY);
  };
  const onHandleUp = (event: React.PointerEvent) => {
    if (!draggingRef.current) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    draggingRef.current = false;
    lastPointer.current = null;
    setDragging(false);
    onDragChange?.(false);
  };

  const step = (delta: number) => report((progress ?? 0) + delta);
  const at = progress !== undefined && trace.length ? recordedPointAt(trace, progress * totalM, gapsRef.current) : null;

  return (
    <div ref={hostRef} data-terrain-state={terrainState} className={`relative h-full w-full ${className ?? ""}`}>
      {terrainState !== "ready" ? (
        <p role="status" className="seed-terrain-status">
          {terrainState === "loading" ? "The land is taking shape…" : terrainState === "partial" ? "Elevation tiles are unavailable in places. The recorded route is still here." : "The map could not load. You can still inspect the climb."}
        </p>
      ) : null}
      {/*
        The overlay carries the thread. It is transparent to pointer events
        except on its own controls, so the map beneath stays clickable and the
        page keeps its scroll.
      */}
      <div className="pointer-events-none absolute inset-0 z-10">
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

        {handlePoint && !exploring ? (
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
              onLostPointerCapture={() => { draggingRef.current = false; setDragging(false); onDragChange?.(false); }}
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
