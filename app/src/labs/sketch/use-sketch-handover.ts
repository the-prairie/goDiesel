// The hand-over (plan S17) wired to the page: watches MapLibre's camera,
// asks whether this place and device may have the real city, loads it
// lazily, keeps its camera matched to MapLibre's, fades it in and out, and
// tears it down. The lifecycle itself is the pure reducer in
// sketch-handover-state; this hook owns the IO.

import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { coverageAt } from "@/data/photoreal-coverage";
import { matchCamera } from "@/labs/sketch/sketch-camera-match";
import { FIRST_VIEW_TIMEOUT_MS, START_TIMEOUT_MS, eligibility, initialHandoverState, reduceHandover, type HandoverEvent } from "@/labs/sketch/sketch-handover-state";
import type { SketchLook } from "@/labs/sketch/sketch-options";
import type { RealSketchFactory, RealSketchView } from "@/labs/sketch/sketch-real-view";
import { REVEAL_RADIUS_M, type ExploredRoute, type RevealMode } from "@/labs/sketch/sketch-reveal";

/** How long the real city takes to fade in or out. */
export const HANDOVER_FADE_MS = 700;

const PAPER: Record<SketchLook, [number, number, number]> = { line: [0.984, 0.984, 0.973], pencil: [0.961, 0.949, 0.918] };
const INK: Record<SketchLook, [number, number, number]> = { line: [0.114, 0.114, 0.122], pencil: [0.27, 0.267, 0.247] };

declare global {
  interface Window {
    /** Tests shorten the first-view wait. */
    __GODIESEL_SKETCH_HANDOVER_TIMEOUT_MS__?: number;
  }
}

function capabilities() {
  let webgl2 = false;
  try {
    webgl2 = Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    webgl2 = false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return { webgl2, deviceMemoryGb: nav.deviceMemory, saveData: Boolean(nav.connection?.saveData) };
}

async function loadFactory(): Promise<RealSketchFactory> {
  if (window.__GODIESEL_SKETCH_REAL_FACTORY__) return window.__GODIESEL_SKETCH_REAL_FACTORY__;
  return (await import("@/labs/sketch/sketch-real-view")).createRealSketchView;
}

export function useSketchHandover({
  mapRef,
  layerRef,
  mapReady,
  enabled,
  paused,
  explored,
  reveal,
  look,
  reducedMotion,
}: {
  mapRef: RefObject<MapLibreMap | null>;
  /** Where the real city is drawn: over the map, under the page's keys. */
  layerRef: RefObject<HTMLDivElement | null>;
  mapReady: boolean;
  /** The lab switch (`real=1`): off, the drawn city is the world at every zoom. */
  enabled: boolean;
  /** While a 3D world is open the camera belongs to the jump: no hand-over then. */
  paused: boolean;
  explored: readonly ExploredRoute[];
  reveal: RevealMode;
  look: SketchLook;
  reducedMotion: boolean;
}) {
  const [state, dispatch] = useReducer(reduceHandover, undefined, initialHandoverState);
  const viewRef = useRef<RealSketchView | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const capable = useRef<ReturnType<typeof capabilities> | null>(null);
  const send = useCallback((event: HandoverEvent) => dispatch(event), []);

  /** The real city stands where MapLibre's camera stands. */
  const follow = useCallback(() => {
    const map = mapRef.current;
    const view = viewRef.current;
    if (!map || !view) return;
    const center = map.getCenter();
    const city = coverageAt(center.lng, center.lat);
    const canvas = map.getCanvas();
    view.setCamera(
      matchCamera({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        groundEllipsoidM: city?.groundEllipsoidM ?? 0,
      }),
    );
  }, [mapRef]);

  // Watch the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !enabled) return;
    capable.current ??= capabilities();
    const check = () => {
      if (pausedRef.current) return;
      const center = map.getCenter();
      const city = coverageAt(center.lng, center.lat);
      send({ type: "zoomChanged", zoom: map.getZoom(), eligible: eligibility({ city: city?.city ?? null, ...capable.current! }), nowMs: performance.now() });
    };
    const onMove = () => follow();
    map.on("zoom", check);
    map.on("moveend", check);
    map.on("move", onMove);
    check();
    return () => {
      map.off("zoom", check);
      map.off("moveend", check);
      map.off("move", onMove);
    };
  }, [enabled, follow, mapReady, mapRef, send]);

  // Load the real city.
  const loadId = "loadId" in state ? state.loadId : 0;
  useEffect(() => {
    if (state.phase !== "loading") return;
    const id = state.loadId;
    let active = true;
    // The library may take its time (an unbundled dev server); only a tileset
    // that never starts at all gives up here. The first view has its own clock.
    const timeout = window.setTimeout(() => send({ type: "startTimedOut", loadId: id }), START_TIMEOUT_MS);
    void loadFactory()
      .then((factory) => {
        const container = layerRef.current;
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || (window.__GODIESEL_SKETCH_REAL_FACTORY__ ? "test" : "");
        if (!active || !container) return;
        if (!apiKey) {
          send({ type: "failed", loadId: id });
          return;
        }
        viewRef.current = factory({
          container,
          apiKey,
          lines: explored.map((route) => route.line),
          radiusM: REVEAL_RADIUS_M[reveal],
          soft: reveal === "wash",
          paper: PAPER[look],
          ink: INK[look],
          // A sketch needs less detail than a photograph: coarser tiles come
          // sooner and weigh less (measured: 16 missed the 8 s first view at 1440).
          maximumScreenSpaceError: 24,
          onTilesStarted: () => send({ type: "tilesStarted", loadId: id, nowMs: performance.now() }),
          onFirstView: () => send({ type: "firstViewDrawn", loadId: id }),
          onFailed: () => send({ type: "failed", loadId: id }),
        });
        follow();
      })
      .catch(() => {
        if (active) send({ type: "failed", loadId: id });
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
    // A load is started once per load id; options reach the view through the effects below.
  }, [loadId, state.phase === "loading"]);

  // The first view's clock runs from the tiles' arrival (S17: tiles, not library).
  const tilesStarted = state.phase === "loading" && state.tilesStartedMs !== undefined;
  useEffect(() => {
    if (!tilesStarted) return;
    const id = loadId;
    const timer = window.setTimeout(() => send({ type: "timedOut", loadId: id }), window.__GODIESEL_SKETCH_HANDOVER_TIMEOUT_MS__ ?? FIRST_VIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loadId, send, tilesStarted]);

  // Fades end on a clock, not on a CSS event a hidden tab may never send.
  useEffect(() => {
    if (state.phase !== "fadingIn" && state.phase !== "fadingOut") return;
    const id = state.loadId;
    const timer = window.setTimeout(() => send({ type: "fadeFinished", loadId: id }), reducedMotion ? 0 : HANDOVER_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, send, state]);

  // Tear down: back on the drawn city, nothing of the real one stays.
  useEffect(() => {
    if (state.phase !== "drawn" && state.phase !== "declined") return;
    const view = viewRef.current;
    if (!view) return;
    viewRef.current = null;
    view.destroy();
    layerRef.current?.replaceChildren();
  }, [layerRef, state.phase]);
  useEffect(
    () => () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    },
    [],
  );

  useEffect(() => {
    viewRef.current?.setCorridor(REVEAL_RADIUS_M[reveal], reveal === "wash");
  }, [reveal]);

  /** The colour flood for the jump: from the current flood to `to`, over `ms`. Resolves when done. */
  const flood = useCallback(
    (from: number, to: number, ms: number) =>
      new Promise<void>((resolve) => {
        const view = viewRef.current;
        if (!view) return resolve();
        if (reducedMotion || ms <= 0) {
          view.setFlood(to);
          return resolve();
        }
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / ms);
          const eased = t * t * (3 - 2 * t);
          view.setFlood(from + (to - from) * eased);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [reducedMotion],
  );

  // When each phase began, for measuring (time to first view).
  const phaseTimes = useRef<{ phase: string; atMs: number }[]>([]);
  useEffect(() => {
    phaseTimes.current = [...phaseTimes.current.slice(-19), { phase: state.phase, atMs: performance.now() }];
  }, [state.phase]);

  return { state, phaseTimes: () => phaseTimes.current, real: state.phase === "real" || state.phase === "fadingIn", view: () => viewRef.current, flood };
}
