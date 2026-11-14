import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { GeoJSONSource, Map as MapLibreMap, VectorTileSource } from "maplibre-gl";

import { APP_PATHS, decodedRouteSlug, sketchRealmPath, sketchWorldPath } from "@/app/route-paths";
import { loadRouteDetail } from "@/data/route-repository";
import { routes } from "@/data/routes";
import { CROSSFADE_MS, WIPE_STEP_MS } from "@/labs/overland/model/dither-wipe";
import { buildOverlandEntries } from "@/labs/overland/model/overland-entries";
import { placeLook } from "@/labs/overland/model/place-biomes";
import { ATTRIBUTION_BAND_PX } from "@/labs/overland/model/realm-layout";
import { normaliseRouteLine } from "@/labs/overland/model/route-line";
import { routeNumberLabel } from "@/labs/overland/model/text-box";
import { OverlandJump, type TownJumpCover } from "@/labs/overland/overland-jump";
import { initialOverlandJumpState, townCover, type TownCover } from "@/labs/overland/overland-jump-state";
import { usePhone } from "@/labs/overland/overland-ui";
import { applySketchStyle } from "@/labs/sketch/sketch-apply";
import { cityView, farView, routeStartView, streetView, type SketchCamera } from "@/labs/sketch/sketch-camera";
import { createEdgeLayer } from "@/labs/sketch/sketch-edge-layer";
import { initialSketchMapState, reduceSketchMap } from "@/labs/sketch/sketch-map-state";
import { sketchOptions, withOption, type SketchLook } from "@/labs/sketch/sketch-options";
import { REVEAL_LAYERS } from "@/labs/sketch/sketch-tile";
import { REVEAL_RADIUS_M, exploredRoutes, type RevealMode } from "@/labs/sketch/sketch-reveal";
import { sketchStyle } from "@/labs/sketch/sketch-style";
import { googleWarmKey, readDataSaving, shouldWarmGoogle, warmGoogle } from "@/labs/sketch/sketch-warmup";
import { HANDOVER_FADE_MS, useSketchHandover } from "@/labs/sketch/use-sketch-handover";
import { MAPLIBRE_FOV_DEG } from "@/labs/sketch/sketch-camera-match";
import { fovAlongFlight, mapCameraForReplay } from "@/labs/sketch/sketch-jump-camera";
import type { QuestRoute } from "@/domain/route";
import { googleRouteCameraPose, initialGoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";
import { sustainedRouteCamera } from "@/surfaces/replay/scene/route-camera-score";
import { RouteNotFound } from "@/ui/route-not-found";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/labs/overland/overland.css";
import "./sketch.css";

// MapLibre (280 KB) is not in the page's static graph (S26): the paper, the
// status and her route list render as soon as the route data is here, while
// the library is still arriving. Its download starts when this module runs.
type MapLibreModule = typeof import("@/providers/maplibre").default;
let maplibreLoad: Promise<MapLibreModule> | undefined;
const loadMaplibre = () =>
  (maplibreLoad ??= import("@/providers/maplibre").then((module) => module.default).catch((error: unknown) => {
    maplibreLoad = undefined;
    throw error;
  }));
void loadMaplibre().catch(() => undefined);

// Planted moments live in their own chunk, loaded once the map is up.
const MomentLayer = lazy(() => import("@/labs/sketch/moment-layer"));

// The proof covers one city: Kyoto and her routes there.
const CITY = "Kyoto, Japan";
const ENTRIES = buildOverlandEntries(routes).filter((entry) => entry.place === CITY);
const EXPLORED = exploredRoutes(routes.filter((route) => route.region === CITY));
const lineOf = (slug: string) => EXPLORED.find((route) => route.slug === slug)?.line;

/** What the tiles are searched for: her routes and how far colour reaches. */
const revealFor = (mode: RevealMode) => ({ lines: EXPLORED.map((route) => route.line), radiusM: REVEAL_RADIUS_M[mode], fade: mode === "wash" });

/** The pose the 3D replay opens with, read from the same functions its driver uses. */
/**
 * Where the jump's dive lands for a route: the drawn city's camera matched to
 * where Google's replay opens (S23), or the route's start if its detail is
 * missing. Used by the dive and, earlier, to make the landing's buildings.
 */
async function landingCamera(slug: string, height: number) {
  const line = lineOf(slug);
  if (!line) return undefined;
  const detail = await loadRouteDetail(slug);
  return detail.status === "ready" && detail.route.route.length > 1
    ? mapCameraForReplay(openingPose(detail.route, window.innerWidth), { height })
    : { ...routeStartView(line), fovDeg: MAPLIBRE_FOV_DEG };
}

function openingPose(route: QuestRoute, viewportWidth: number) {
  const state = initialGoogleRouteNavigatorState();
  return sustainedRouteCamera(route, state, googleRouteCameraPose(route, state), viewportWidth);
}

interface SketchState {
  via?: "jump";
}

type Camera = Pick<SketchCamera, "center" | "zoom" | "pitch" | "bearing">;

const LOOK_NAMES: Record<SketchLook, string> = { line: "A · clean line", pencil: "B · pencil" };
const REVEAL_NAMES: Record<RevealMode, string> = { line: "Line", corridor: "Corridor", wash: "Wash" };

export function SketchWorldPage() {
  const { routeSlug } = useParams();
  const realmSlug = decodedRouteSlug(routeSlug);
  const realmEntry = realmSlug ? ENTRIES.find((entry) => entry.slug === realmSlug) : undefined;
  if (realmSlug && !realmEntry) return <RouteNotFound />;
  return <SketchWorld realmSlug={realmEntry?.slug} />;
}

function SketchWorld({ realmSlug }: { realmSlug?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const options = sketchOptions(searchParams);
  const phone = usePhone();
  const reducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const edgesRef = useRef<ReturnType<typeof createEdgeLayer> | null>(null);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [state, dispatch] = useReducer(reduceSketchMap, undefined, initialSketchMapState);
  const chosen = searchParams.get("route") ?? realmSlug ?? null;
  const chosenEntry = ENTRIES.find((entry) => entry.slug === chosen);
  const styleRef = useRef(sketchStyle({ look: options.look, reveal: options.reveal, explored: EXPLORED }));
  const [jumpCoverState, setCover] = useState<TownCover>(() => townCover(initialOverlandJumpState()));
  const cover = realmSlug ? jumpCoverState : townCover(initialOverlandJumpState());
  const revealRef = useRef(options.reveal);
  const realLayerRef = useRef<HTMLDivElement>(null);
  const handover = useSketchHandover({
    mapRef,
    layerRef: realLayerRef,
    mapReady: state.phase === "ready" || state.phase === "degraded",
    enabled: options.realCity,
    paused: Boolean(realmSlug),
    explored: EXPLORED,
    reveal: options.reveal,
    look: options.look,
    reducedMotion,
  });
  // Wait 2 (S24): choosing a route warms Google's 3D renderer code, so the
  // dive overlaps it and the 3D tiles can start as soon as the jump mounts.
  const mapUp = state.phase === "ready" || state.phase === "degraded";
  // Round 8 (S27): making a tile's buildings takes 0.4–1.7 s each in Safari,
  // one at a time, so on choosing a route the landing's tiles are made then,
  // not on Jump in. About six building tiles, once per route; none with
  // Save-Data or reduced data, when the dive still asks for them as it starts.
  useEffect(() => {
    const key = googleWarmKey();
    const saving = readDataSaving();
    if (shouldWarmGoogle({ chosen, realmOpen: Boolean(realmSlug), mapReady: mapUp, hasKey: Boolean(key), ...saving })) void warmGoogle(key);
    const map = mapRef.current;
    if (!chosen || realmSlug || !mapUp || !map || saving.saveData || saving.reducedData) return;
    let cancelled = false;
    void landingCamera(chosen, map.getCanvas().clientHeight).then((target) => {
      if (!cancelled && target) edgesRef.current?.prefetchView({ ...target, height: map.getCanvas().clientHeight });
    });
    return () => {
      cancelled = true;
    };
  }, [chosen, realmSlug, mapUp]);
  const [momentOpen, setMomentOpen] = useState(false);
  const handoverRef = useRef(handover);
  handoverRef.current = handover;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  const screen = () => ({ width: hostRef.current?.clientWidth ?? window.innerWidth, height: hostRef.current?.clientHeight ?? window.innerHeight });
  const cityCamera = useCallback((slug?: string | null) => {
    const line = slug ? lineOf(slug) : undefined;
    return cityView(line ? [line] : EXPLORED.map((route) => route.line), screen());
  }, []);

  /** Moves the camera: a flight, or a cut with reduced motion. Resolves when it is there. */
  const move = useCallback((camera: Camera, duration = 2600) => {
    const map = mapRef.current;
    if (!map) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // A field-of-view step fires its own moveend; only the flight's own counts.
      const onEnd = (event: object) => {
        if ((event as { fovStep?: boolean }).fovStep) return;
        map.off("moveend", onEnd);
        resolve();
      };
      map.on("moveend", onEnd);
      if (reducedRef.current) map.jumpTo(camera);
      else map.flyTo({ ...camera, duration, essential: true, curve: 1.5 });
    });
  }, []);

  // ---------------------------------------------------------------- the map

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const loadId = Date.now();
    dispatch({ type: "loadStarted", loadId });
    const back = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("route");
    const start: Camera = realmSlug ? routeStartView(lineOf(realmSlug) ?? EXPLORED[0].line) : back && lineOf(back) ? cityCamera(back) : farView();
    const create = (maplibregl: MapLibreModule) => {
    let map: MapLibreMap;
    try {
      // Timing marks (standard performance marks, cheap): where the opening's time goes.
      performance.mark("sketch:map-created");
      map = new maplibregl.Map({
        container: host,
        style: styleRef.current,
        ...start,
        maxPitch: 80,
        // OpenStreetMap's credit is always shown in full, never folded away.
        attributionControl: { compact: false },
        canvasContextAttributes: { antialias: true },
        fadeDuration: 0,
      });
    } catch {
      dispatch({ type: "mapFailed", loadId, reason: "webgl" });
      return;
    }
    mapRef.current = map;
    map.getCanvas().setAttribute("aria-label", "A sketched map of the world, from Japan down to Kyoto's streets. Her routes are drawn in red; the list of routes follows.");
    // Ready once the first view is drawn, tiles and all, not merely styled:
    // until then the page says it is drawing the world.
    map.once("idle", () => {
      performance.mark("sketch:idle");
      dispatch({ type: "mapReady", loadId });
    });
    map.once("load", () => performance.mark("sketch:style-loaded"));
    map.once("render", () => performance.mark("sketch:first-render"));
    map.on("load", () => {
      const source = map.getSource("openmaptiles") as VectorTileSource | undefined;
      const add = (tilesUrl: string) => {
        if (map.getLayer("building-edges")) return;
        const edges = createEdgeLayer({
          tilesUrl,
          look: sketchOptions(new URLSearchParams(window.location.hash.split("?")[1] ?? "")).look,
          maxTiles: phone ? 6 : 12,
          // A tile that arrives on screen rises into place over 700 ms, never pops.
          riseMs: () => (reducedRef.current ? 0 : 700),
          onExplored: (ids) => {
            for (const { layer, id, level } of ids) map.setFeatureState({ source: "openmaptiles", sourceLayer: layer, id }, { explored: level });
          },
        });
        // Without its edges the city still stands, as white forms.
        try {
          map.addLayer(edges, "route-casing");
          edgesRef.current = edges;
          edges.setReveal(revealFor(revealRef.current));
          edges.setRoutes(EXPLORED.map((route) => route.line));
          // Her routes at full resolution, so close up they follow the streets she ran.
          void Promise.all(ENTRIES.map((entry) => loadRouteDetail(entry.slug))).then((results) => {
            const lines = results.flatMap((result) => (result.status === "ready" && result.route.route.length > 1 ? [result.route.route.map((point): [number, number] => [point.lng, point.lat])] : []));
            if (lines.length && edgesRef.current === edges) edges.setRoutes(lines);
          });
        } catch {
          if (map.getLayer("building-edges")) map.removeLayer("building-edges");
        }
      };
      if (source?.tiles?.[0]) add(source.tiles[0]);
      else map.once("sourcedata", () => (map.getSource("openmaptiles") as VectorTileSource | undefined)?.tiles?.[0] && add((map.getSource("openmaptiles") as VectorTileSource).tiles![0]));
    });
    map.on("error", (event) => {
      if ((event as { sourceId?: string }).sourceId || /tile|source|fetch/i.test(String(event.error?.message))) dispatch({ type: "tilesFailed", loadId });
    });
    let firstTile = true;
    map.on("data", (event) => {
      const data = event as { dataType?: string; sourceId?: string; tile?: unknown };
      if (data.dataType !== "source" || data.sourceId !== "openmaptiles" || !data.tile) return;
      if (firstTile) performance.mark("sketch:first-tile");
      firstTile = false;
      dispatch({ type: "tilesLoaded", loadId });
    });
    // Everything at the bottom sits above the credit, however many lines it takes.
    const credit = host.querySelector(".maplibregl-ctrl-bottom-right");
    const creditObserver = new ResizeObserver(() => rootRef.current?.style.setProperty("--sk-credit", `${credit?.getBoundingClientRect().height ?? 0}px`));
    if (credit) creditObserver.observe(credit);
    (window as Window & { __sketch?: unknown }).__sketch = {
      map,
      edges: () => edgesRef.current?.stats(),
      handover: () => ({ phase: handoverRef.current.state.phase, real: handoverRef.current.view()?.stats() ?? null, times: handoverRef.current.phaseTimes() }),
    };
    return () => {
      creditObserver.disconnect();
      map.remove();
      mapRef.current = null;
      edgesRef.current = null;
      dispatch({ type: "disposed" });
    };
    };
    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadMaplibre().then(
      (maplibregl) => {
        if (!disposed) dispose = create(maplibregl);
      },
      () => {
        if (!disposed) dispatch({ type: "mapFailed", loadId, reason: "style" });
      },
    );
    return () => {
      disposed = true;
      dispose?.();
    };
    // The map is made once; options and routes are sent to it.
  }, []);

  // Look and reveal, live.
  revealRef.current = options.reveal;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !edgesRef.current) return;
    for (const layer of REVEAL_LAYERS) map.removeFeatureState({ source: "openmaptiles", sourceLayer: layer });
    edgesRef.current.setReveal(revealFor(options.reveal));
  }, [options.reveal]);
  useEffect(() => {
    const map = mapRef.current;
    const next = sketchStyle({ look: options.look, reveal: options.reveal, explored: EXPLORED });
    const previous = styleRef.current;
    styleRef.current = next;
    edgesRef.current?.setLook(options.look);
    if (!map || !map.isStyleLoaded()) return;
    applySketchStyle(
      {
        getLayer: (id) => map.getLayer(id),
        getPaintProperty: (id, name) => map.getPaintProperty(id, name as Parameters<MapLibreMap["getPaintProperty"]>[1]),
        setPaintProperty: (id, name, value) => map.setPaintProperty(id, name as Parameters<MapLibreMap["setPaintProperty"]>[1], value as Parameters<MapLibreMap["setPaintProperty"]>[2]),
        addLayer: (layer, before) => map.addLayer(layer, before),
        removeLayer: (id) => map.removeLayer(id),
        setSourceData: (id, data) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as GeoJSON.GeoJSON),
      },
      next,
      previous,
    );
  }, [options.look, options.reveal]);

  // With the real city up, the keys sit above Google's credit line too.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!handover.real) {
      root.style.setProperty("--sk-credit-real", "0px");
      return;
    }
    const measure = () => {
      const credits = realLayerRef.current?.querySelector(".cesium-viewer-bottom");
      root.style.setProperty("--sk-credit-real", `${credits ? credits.getBoundingClientRect().height + 4 : 0}px`);
    };
    measure();
    const timer = window.setInterval(measure, 500);
    return () => window.clearInterval(timer);
  }, [handover.real]);

  // Under the real city the drawn buildings need not be drawn.
  useEffect(() => {
    edgesRef.current?.setPaused(handover.state.phase === "real");
  }, [handover.state.phase]);

  // The chosen route stands out.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state.phase === "loading" || state.phase === "idle" || !map.getLayer("route-line")) return;
    map.setPaintProperty("route-line", "line-width", chosen ? ["case", ["==", ["get", "slug"], chosen], ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5, 18, 9], ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 2.5, 18, 5]] : ["interpolate", ["exponential", 1.6], ["zoom"], 8, 2, 14, 3.5, 18, 7]);
  }, [chosen, state.phase]);

  // ---------------------------------------------------------------- choosing and jumping

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const choose = (slug: string) => {
    if (chosen === slug) return jump(slug);
    setParam("route", slug);
    void move(cityCamera(slug), 2200);
  };
  const jump = (slug: string) => {
    const query = new URLSearchParams(searchParams);
    query.set("route", slug);
    navigate(sketchRealmPath(slug, query.toString()), { state: { via: "jump" } satisfies SketchState });
  };
  const realmState = location.state as SketchState | null;
  const exitRealm = useCallback(() => {
    if (realmState?.via === "jump") navigate(-1);
    else navigate(sketchWorldPath(new URLSearchParams(location.search).toString()), { replace: true });
  }, [location.search, navigate, realmState]);

  /**
   * The jump's flights. Diving, the camera ends exactly where the 3D
   * replay's opening camera will stand (centre, heading, tilt, range and
   * field of view), so the drawn city gives way to Google's without a jump;
   * the field of view eases across on the way. The tiles round that spot
   * start loading as the dive begins, so the drawn buildings are there when
   * it lands. Coming back, it settles close over the route's start, where
   * its corridor shows in colour. With the lab switch's real city up, the
   * dive also floods Google's colour in on the same geometry (S17.5).
   */
  // Where the current flight is going, so finishing it early lands there, not mid-air.
  const flightRef = useRef<(Camera & { fovDeg: number }) | null>(null);
  const fly = useCallback(
    (camera: Camera & { fovDeg: number }, duration: number) => {
      const map = mapRef.current;
      if (!map) return Promise.resolve();
      flightRef.current = camera;
      const fromZoom = map.getZoom();
      const fromFov = map.getVerticalFieldOfView();
      const setFov = (fov: number) => map.setVerticalFieldOfView(fov, { fovStep: true });
      if (reducedRef.current) {
        setFov(camera.fovDeg);
        return move(camera, duration);
      }
      const onMove = (event: object) => {
        if (!(event as { fovStep?: boolean }).fovStep) setFov(fovAlongFlight({ fromZoom, toZoom: camera.zoom, zoom: map.getZoom(), fromFov, toFov: camera.fovDeg }));
      };
      map.on("move", onMove);
      return move(camera, duration).then(() => {
        map.off("move", onMove);
        setFov(camera.fovDeg);
      });
    },
    [move],
  );
  const jumpCover: TownJumpCover = useMemo(
    () => ({
      dive: async () => {
        const map = mapRef.current;
        if (!map || !realmSlug) return;
        const target = await landingCamera(realmSlug, map.getCanvas().clientHeight);
        if (!target) return;
        (window as Window & { __sketchJumpCamera?: unknown }).__sketchJumpCamera = target;
        edgesRef.current?.prefetchView({ ...target, height: map.getCanvas().clientHeight });
        const flying = fly(target, 2800);
        if (!handoverRef.current.real) return flying;
        return Promise.all([flying, handoverRef.current.flood(0, 1, 2800)]).then(() => undefined);
      },
      finish: () => {
        const map = mapRef.current;
        const target = flightRef.current;
        map?.stop();
        // Ends the flight where it was going: the cut must land on the matched camera.
        if (map && target) {
          map.setVerticalFieldOfView(target.fovDeg, { fovStep: true });
          map.jumpTo(target);
        }
        handoverRef.current.view()?.setFlood(handoverRef.current.real ? 1 : 0);
      },
      travel: () => undefined,
      surface: () => {
        const line = realmSlug ? lineOf(realmSlug) : undefined;
        const camera = line ? { ...routeStartView(line), zoom: 16, pitch: 50 } : cityCamera(realmSlug);
        const flying = fly({ ...camera, fovDeg: MAPLIBRE_FOV_DEG }, 2400);
        if (!handoverRef.current.real) return flying;
        return Promise.all([flying, handoverRef.current.flood(1, 0, 2400)]).then(() => undefined);
      },
    }),
    [cityCamera, fly, realmSlug],
  );

  const realmEntry = realmSlug ? ENTRIES.find((entry) => entry.slug === realmSlug) : undefined;
  const jumpMap = useMemo(() => {
    if (!realmEntry) return null;
    const summary = routes.find((route) => route.slug === realmEntry.slug)!;
    const look = placeLook(realmEntry.place, summary.centerLat);
    return {
      slug: realmEntry.slug,
      line: normaliseRouteLine(summary.trace),
      biome: look.biome,
      coastal: look.coastal,
      climbPerKm: realmEntry.climbM === null ? 0 : realmEntry.climbM / Math.max(1, realmEntry.km),
    };
  }, [realmEntry]);

  // Escape leaves the lab when no 3D world is open.
  useEffect(() => {
    if (realmSlug) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && chosen) setParam("route", null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------- render

  const stageStyle: React.CSSProperties = {
    opacity: cover.opacity,
    zIndex: cover.above ? 3 : 1,
    clipPath: cover.clipBand ? `inset(0px 0px ${ATTRIBUTION_BAND_PX}px 0px)` : undefined,
    transition: `opacity ${reducedMotion ? CROSSFADE_MS : WIPE_STEP_MS}ms linear`,
    visibility: cover.opacity === 0 && !cover.above ? "hidden" : undefined,
  };
  const unavailable = state.phase === "unavailable";

  return (
    <div className="overland overland-in-town sketch" data-look={options.look} data-reveal={options.reveal} data-testid="sketch">
      <div
        className="sketch-world"
        data-handover={handover.state.phase}
        data-handover-reason={handover.state.phase === "declined" ? handover.state.reason : undefined}
        data-map-phase={state.phase}
        data-testid="sketch-world"
        ref={(element) => {
          rootRef.current = element;
          setRootElement(element);
        }}>
        <h1 className="sr-only">Kyoto, sketched: {ENTRIES.length} routes</h1>
        <div className="sketch-stage" data-cover-opacity={cover.opacity} inert={!cover.interactive || momentOpen} style={stageStyle}>
          <div className="sketch-map" data-testid="sketch-map" ref={hostRef} role="region" aria-label="Sketched map" />
          {/* The real city, Google's 3D drawn as the sketch, fading in over the drawn one. */}
          <div
            aria-hidden="true"
            className="sketch-real-layer"
            data-testid="sketch-real-layer"
            ref={realLayerRef}
            style={{
              opacity: handover.real ? 1 : 0,
              transition: `opacity ${reducedMotion ? 0 : HANDOVER_FADE_MS}ms ease-in-out`,
              visibility: handover.state.phase === "drawn" || handover.state.phase === "declined" ? "hidden" : undefined,
            }}
          />
          {options.look === "pencil" ? <div aria-hidden="true" className="sketch-grain" /> : null}
        </div>

        <div className="sketch-ui" hidden={!cover.interactive} inert={!cover.interactive || momentOpen}>
          <div className="sketch-top">
            <button className="sketch-key" onClick={() => navigate(APP_PATHS.atlas)} type="button">
              Exit
            </button>
            <div aria-label="Where to look" className="sketch-places" role="group">
              <button className="sketch-key" onClick={() => void move(farView(), 3200)} type="button">
                Japan
              </button>
              <button className="sketch-key" onClick={() => void move(cityCamera(chosen), 3200)} type="button">
                Kyoto
              </button>
              {chosen && lineOf(chosen) ? (
                <button className="sketch-key" onClick={() => void move(streetView(lineOf(chosen)!), 2400)} type="button">
                  Street
                </button>
              ) : null}
            </div>
          </div>

          {options.review ? (
            <div aria-label="Review: compare looks" className="sketch-review" data-testid="sketch-review" role="group">
              <span className="sketch-review-label">Look</span>
              {(["line", "pencil"] as const).map((look) => (
                <button aria-pressed={options.look === look} className="sketch-chip-option" key={look} onClick={() => setSearchParams(withOption(searchParams, "look", look), { replace: true })} type="button">
                  {LOOK_NAMES[look]}
                </button>
              ))}
              <span className="sketch-review-label">Colour</span>
              {(["line", "corridor", "wash"] as const).map((reveal) => (
                <button aria-pressed={options.reveal === reveal} className="sketch-chip-option" key={reveal} onClick={() => setSearchParams(withOption(searchParams, "reveal", reveal), { replace: true })} type="button">
                  {REVEAL_NAMES[reveal]}
                </button>
              ))}
            </div>
          ) : null}

          <div aria-label="Map controls" className="sketch-controls" role="group">
            <button aria-label="Zoom in" className="sketch-key sketch-key-square" onClick={() => mapRef.current?.zoomIn()} type="button">
              +
            </button>
            <button aria-label="Zoom out" className="sketch-key sketch-key-square" onClick={() => mapRef.current?.zoomOut()} type="button">
              −
            </button>
            <button aria-label="Turn left" className="sketch-key sketch-key-square" onClick={() => mapRef.current?.rotateTo((mapRef.current.getBearing() ?? 0) - 30)} type="button">
              ↺
            </button>
            <button aria-label="Turn right" className="sketch-key sketch-key-square" onClick={() => mapRef.current?.rotateTo((mapRef.current.getBearing() ?? 0) + 30)} type="button">
              ↻
            </button>
            <button aria-label="Tilt" className="sketch-key sketch-key-square" onClick={() => mapRef.current?.easeTo({ pitch: (mapRef.current.getPitch() ?? 0) > 40 ? 0 : 60 })} type="button">
              ⟂
            </button>
          </div>

          <section aria-labelledby="sketch-routes-title" className="sketch-routes" data-testid="sketch-routes">
            <h2 className="sr-only" id="sketch-routes-title">
              Her routes in Kyoto
            </h2>
            <ol className="sketch-chips">
              {ENTRIES.map((entry) => (
                <li key={entry.slug}>
                  <button
                    aria-label={`${routeNumberLabel(entry.number)}, ${entry.title}, ${entry.km.toFixed(1)} km${chosen === entry.slug ? ". Chosen: press again to jump in" : ""}`}
                    aria-pressed={chosen === entry.slug}
                    className="sketch-chip"
                    data-slug={entry.slug}
                    onClick={() => choose(entry.slug)}
                    type="button"
                  >
                    <span className="sketch-chip-number">{String(entry.number).padStart(3, "0")}</span>
                    <span className="sketch-chip-title">{entry.title}</span>
                    <span className="sketch-chip-km">{entry.km.toFixed(1)} km</span>
                  </button>
                </li>
              ))}
            </ol>
            {chosenEntry ? (
              <button className="sketch-key sketch-jump" data-testid="sketch-jump" onClick={() => jump(chosenEntry.slug)} type="button">
                Jump in
              </button>
            ) : null}
          </section>
        </div>

        {state.phase === "degraded" || unavailable || state.phase === "loading" || state.phase === "idle" ? (
          <p className="sketch-status" data-loading={state.phase === "loading" || state.phase === "idle"} data-testid="sketch-status" role="status">
            {unavailable && state.reason === "style"
              ? "The map couldn't load right now. Her routes are listed below and still open in 3D."
              : unavailable
              ? "This map needs WebGL, which this browser cannot give it. Her routes are listed below and still open in 3D."
              : state.phase === "degraded"
                ? "The map's tiles aren't loading right now; her routes are still here."
                : "Drawing the world…"}
          </p>
        ) : null}
      </div>

      {mapUp && mapRef.current ? (
        <Suspense fallback={null}>
          <MomentLayer map={mapRef.current} move={move} onOpenChange={setMomentOpen} reducedMotion={reducedMotion} />
        </Suspense>
      ) : null}
      {realmEntry && jumpMap && rootElement ? (
        <OverlandJump
          container={rootElement}
          cover={unavailable ? undefined : jumpCover}
          entrance={realmState?.via === "jump" ? "dive" : "direct"}
          entry={realmEntry}
          map={jumpMap}
          miniMapRect={() => undefined}
          onCover={setCover}
          onExit={exitRealm}
          skin="sketch"
          transition={unavailable ? "wipe" : "town"}
        />
      ) : null}
    </div>
  );
}
