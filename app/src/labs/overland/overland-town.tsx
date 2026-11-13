import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { overlandTownPath, overlandTownRealmPath } from "@/app/route-paths";
import { routes } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { context2d } from "@/labs/overland/engine/canvas";
import { measureText } from "@/labs/overland/engine/font";
import { C } from "@/labs/overland/engine/palette";
import { drawFrame, drawText } from "@/labs/overland/engine/text-draw";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import type { OverlandTown } from "@/labs/overland/model/overland-towns";
import { placeLook } from "@/labs/overland/model/place-biomes";
import { ATTRIBUTION_BAND_PX } from "@/labs/overland/model/realm-layout";
import { normaliseRouteLine } from "@/labs/overland/model/route-line";
import { PLACE_DEFAULT_LIGHT, runLight, type TownLight } from "@/labs/overland/model/run-light";
import { formatEntryDate, routeNumberLabel } from "@/labs/overland/model/text-box";
import { signPolaroids, signStoryPages } from "@/labs/overland/model/sign-story";
import { PhotoViewer, PixelPolaroid } from "@/labs/overland/overland-photo";
import type { RouteAnnotation } from "@/domain/route";
import { townInput, townSlug } from "@/labs/overland/model/town-input";
import { planTown, type Signpost } from "@/labs/overland/model/town-plan";
import { initialTier } from "@/labs/overland/model/town-quality";
import { WIPE_STEP_MS, CROSSFADE_MS } from "@/labs/overland/model/dither-wipe";
import { OverlandJump, type TownJumpCover } from "@/labs/overland/overland-jump";
import { townCover, initialOverlandJumpState, type TownCover } from "@/labs/overland/overland-jump-state";
import { initialOverlandTownState, reduceOverlandTown, type OverlandTownEvent } from "@/labs/overland/overland-town-state";
import { Key, PixelLabel } from "@/labs/overland/overland-ui";
import type { SignProjection, TownRenderer } from "@/labs/overland/town3d/town-renderer";
import { useReducedMotion } from "@/ui/use-reduced-motion";

type RendererModule = typeof import("@/labs/overland/town3d/town-renderer");

const BROWSING_COVER = townCover(initialOverlandJumpState());

// The town renderer and three.js load only when a town opens.
const loadRenderer = () => import("@/labs/overland/town3d/town-renderer");

interface TownState {
  /** Set when the 3D world was jumped into from a signpost here. */
  via?: "jump";
}

function plural(count: number, one: string) {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

function signLabel(sign: Signpost) {
  return `${routeNumberLabel(sign.number)}: ${sign.title}. ${sign.km.toFixed(1)} km, ${formatEntryDate(sign.date)}. Jump into the 3D world.`;
}

/**
 * The chosen signpost's story, as the route's trailer: her title and the
 * facts, then her note on the pages after. Tapping the box, or Enter or
 * Space on it, turns the page.
 */
function StoryBox({ sign, note, width, boxRef }: { sign: Signpost; note: string | null; width: number; boxRef: React.Ref<HTMLDivElement> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = width < 560 ? 2 : 3;
  const inner = Math.floor(Math.min(width - 32, 440) / scale);
  const pages = useMemo(() => signStoryPages({ number: sign.number, title: sign.title, km: sign.km, date: sign.date, note }, inner - 18, (text) => measureText(text)), [inner, note, sign]);
  const [page, setPage] = useState(0);
  const current = pages[Math.min(page, pages.length - 1)];
  const more = pages.length > 1;
  const lineCount = Math.max(...pages.map((candidate) => (candidate.kind === "facts" ? candidate.lines.length + 2 : candidate.lines.length)));
  const height = 7 + lineCount * 11 + 10;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = context2d(canvas);
    context.clearRect(0, 0, inner, height);
    drawFrame(context, 0, 0, inner, height);
    let y = 7;
    if (current.kind === "facts") {
      drawText(context, current.heading, 9, y, C.acc2, true);
      y += 13;
      for (const line of current.lines) {
        drawText(context, line, 9, y, C.ink, true);
        y += 11;
      }
      drawText(context, current.facts, 9, y + 1, C.mute);
    } else {
      for (const line of current.lines) {
        drawText(context, line, 9, y, C.ink);
        y += 11;
      }
    }
    if (more) {
      const marker = `${page + 1}/${pages.length}`;
      drawText(context, marker, inner - 9 - measureText(marker), height - 13, C.mute);
    }
  }, [current, height, inner, more, page, pages.length]);
  return (
    <div className="overland-town-box" data-page={page + 1} data-pages={pages.length} data-testid="overland-town-box" ref={boxRef}>
      <div className="overland-town-box-frame">
      <canvas aria-hidden="true" className="overland-pixels" height={height} ref={ref} style={{ width: inner * scale, height: height * scale }} width={inner} />
      {more ? (
        <button
          aria-label={page < pages.length - 1 ? "Next page of her note" : "Back to the first page"}
          className="overland-town-box-page"
          data-testid="overland-town-box-page"
          onClick={() => setPage((value) => (value + 1) % pages.length)}
          type="button"
        />
      ) : null}
      </div>
    </div>
  );
}

export interface OverlandTownViewProps {
  town: OverlandTown;
  entries: readonly OverlandEntry[];
  /** The route whose 3D world is open over the town, from the URL. */
  realmSlug?: string;
  /** Back to the world map. */
  onBack: () => void;
  /** The pixel town, shown when the 3D town cannot open. */
  fallback: ReactNode;
}

/**
 * One of her places as a 3D pixel town. Each route is a signpost; choosing
 * one lights the town as the hour she set out, and activating it dives into
 * that route's photorealistic 3D world.
 */
export function OverlandTownView({ town, entries, realmSlug, onBack, fallback }: OverlandTownViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const reducedMotion = useReducedMotion();
  const slug = townSlug(town.name);
  const plan = useMemo(() => planTown(townInput(town, routes, entries)), [entries, town]);
  const [state, dispatchTown] = useReducer(reduceOverlandTown, undefined, initialOverlandTownState);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TownRenderer | null>(null);
  const moduleRef = useRef<RendererModule | null>(null);
  const signRefs = useRef(new Map<string, HTMLButtonElement>());
  const [townElement, setTownElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [focused, setFocused] = useState<string | null>(searchParams.get("sign"));
  const jumpSign = realmSlug ? plan.signposts.find((sign) => sign.slug === realmSlug) : undefined;
  const chosen = jumpSign?.slug ?? focused;
  const chosenSign = plan.signposts.find((sign) => sign.slug === chosen);
  const detail = useRouteDetail(chosen ?? undefined);
  const storyRef = useRef<HTMLDivElement>(null);
  const polaroidRef = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<RouteAnnotation | null>(null);
  const polaroids = useMemo(() => (chosen && detail.status === "ready" && detail.route.slug === chosen ? signPolaroids(detail.route.annotations) : []), [chosen, detail]);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  // Focus moving into the chosen signpost's story or photos keeps it chosen.
  const withinStory = (target: EventTarget | null) =>
    target instanceof Node && Boolean(storyRef.current?.contains(target) || polaroidRef.current?.contains(target));
  const [jumpCoverState, setCover] = useState<TownCover>(() => townCover(initialOverlandJumpState()));
  // Without a 3D world open, the town is itself, whatever the last jump left.
  const cover = realmSlug ? jumpCoverState : BROWSING_COVER;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const totalKm = plan.signposts.reduce((sum, sign) => sum + sign.km, 0);

  // ---------------------------------------------------------------- the renderer

  const loadCount = useRef(0);
  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    loadCount.current += 1;
    const loadId = loadCount.current;
    const dispatch = (event: OverlandTownEvent) => dispatchTown(event);
    const nav = navigator as Navigator & { deviceMemory?: number };
    const tier = initialTier({ deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency, override: new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("quality") });
    dispatch({ type: "loadStarted", tier });
    let active = true;
    let renderer: TownRenderer | null = null;
    let drawn = false;
    loadRenderer()
      .then((module) => {
        if (!active) return;
        moduleRef.current = module;
        try {
          renderer = module.createTownRenderer({
            host,
            canvasAttributes: {
              "aria-label": `${town.name} as a town. Drag to look around; scroll or pinch to zoom. Each route is a signpost.`,
              role: "img",
              tabindex: "0",
              "data-testid": "overland-town-canvas",
            },
            plan,
            tier,
            reducedMotion,
            onFrame: (signs) => {
              placeSigns(signs);
              if (!drawn) {
                drawn = true;
                dispatch({ type: "rendererReady", loadId });
              }
            },
            onQualityLowered: (lowered) => dispatch({ type: "qualityLowered", loadId, tier: lowered }),
            onContextLost: () => dispatch({ type: "contextLost", loadId }),
          });
        } catch (error) {
          dispatch({ type: "rendererFailed", loadId, reason: error instanceof module.TownWebGLUnavailable ? "webgl" : "error" });
          return;
        }
        rendererRef.current = renderer;
        renderer.resize(sizeRef.current.width, sizeRef.current.height);
        (window as Window & { __overlandTown?: unknown }).__overlandTown = {
          stats: () => renderer?.stats(),
          trees: plan.trees.length,
          biome: plan.biome,
          season: plan.season,
        };
      })
      .catch(() => {
        if (active) dispatch({ type: "rendererFailed", loadId, reason: "chunk" });
      });
    return () => {
      active = false;
      renderer?.dispose();
      rendererRef.current = null;
      dispatch({ type: "disposed" });
    };
    // The renderer is made once per town; later prop changes are sent to it.
  }, [plan]);

  const placeSigns = (signs: SignProjection[]) => {
    for (const sign of signs) {
      if (sign.slug === chosenRef.current && polaroidRef.current) {
        // The photos hang just above the chosen signpost's board.
        polaroidRef.current.style.left = `${sign.x}px`;
        polaroidRef.current.style.top = `${sign.y - sign.height / 2 - 4}px`;
      }
      const button = signRefs.current.get(sign.slug);
      if (!button) continue;
      button.style.left = `${sign.x}px`;
      button.style.top = `${sign.y}px`;
      button.style.width = `${sign.width}px`;
      button.style.height = `${sign.height}px`;
      button.dataset.onScreen = String(sign.visible);
    }
  };

  useLayoutEffect(() => {
    const element = townElement;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      rendererRef.current?.resize(box.width, box.height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [townElement]);

  useEffect(() => rendererRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);

  // ---------------------------------------------------------------- light

  const light: TownLight = useMemo(() => {
    if (!chosen || detail.status !== "ready") return PLACE_DEFAULT_LIGHT;
    const temporal = detail.route.provenance.temporal;
    return runLight({ startTimeUtc: temporal.startTimeUtc, timeZone: temporal.timeZone, lng: detail.route.route[0]?.lng ?? town.lng });
  }, [chosen, detail, town.lng]);
  useEffect(() => {
    rendererRef.current?.setLight(light);
  }, [light, state.phase]);
  useEffect(() => {
    rendererRef.current?.highlight(focused);
  }, [focused, state.phase]);

  // ---------------------------------------------------------------- the jump

  const realmState = location.state as TownState | null;
  const startJump = useCallback(
    (sign: string) => navigate(overlandTownRealmPath(slug, sign), { state: { via: "jump" } satisfies TownState }),
    [navigate, slug],
  );
  const exitRealm = useCallback(() => {
    if (realmState?.via === "jump") navigate(-1);
    else navigate(overlandTownPath(slug, realmSlug), { replace: true });
  }, [navigate, realmSlug, realmState, slug]);

  // Coming back from the 3D world, focus returns to its signpost.
  const wasRealm = useRef(realmSlug);
  useEffect(() => {
    const left = wasRealm.current;
    wasRealm.current = realmSlug;
    if (left && !realmSlug) {
      setFocused(left);
      requestAnimationFrame(() => signRefs.current.get(left)?.focus({ preventScroll: true }));
    }
  }, [realmSlug]);
  // A deep link with a chosen signpost focuses it once the town is up.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || state.phase !== "ready" || realmSlug) return;
    focusedOnce.current = true;
    const sign = searchParams.get("sign");
    if (sign) signRefs.current.get(sign)?.focus({ preventScroll: true });
  }, [realmSlug, searchParams, state.phase]);

  const trace = useMemo(() => routes.find((route) => route.slug === realmSlug)?.trace ?? null, [realmSlug]);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const jumpCover: TownJumpCover = useMemo(
    () => ({
      dive: () => {
        const renderer = rendererRef.current;
        if (!renderer || !realmSlug) return Promise.resolve();
        const current = detailRef.current;
        const opening = current.status === "ready" && moduleRef.current ? moduleRef.current.openingCamera(current.route, sizeRef.current.width) : undefined;
        return renderer.dive(realmSlug, opening);
      },
      finish: () => rendererRef.current?.finish(),
      travel: () => rendererRef.current?.travel(trace),
      surface: () => rendererRef.current?.surface() ?? Promise.resolve(),
    }),
    [realmSlug, trace],
  );

  useEffect(() => {
    rendererRef.current?.setPaused(cover.opacity === 0 && !cover.above);
  }, [cover]);

  // ---------------------------------------------------------------- keys

  useEffect(() => {
    if (realmSlug) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, realmSlug]);

  const stepSign = (from: string, direction: 1 | -1) => {
    const order = [...plan.signposts].sort((a, b) => a.x - b.x || a.tier - b.tier);
    const index = order.findIndex((sign) => sign.slug === from);
    const next = order[(index + direction + order.length) % order.length];
    signRefs.current.get(next.slug)?.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------- render

  const fallen = state.phase === "fallback";
  const entry = realmSlug ? entries.find((candidate) => candidate.slug === realmSlug) : undefined;
  const look = placeLook(town.name, town.lat);
  const map = useMemo(
    () =>
      entry
        ? {
            slug: entry.slug,
            line: normaliseRouteLine(trace ?? []),
            biome: look.biome,
            coastal: look.coastal,
            climbPerKm: entry.climbM === null ? 0 : entry.climbM / Math.max(1, entry.km),
          }
        : null,
    [entry, look.biome, look.coastal, trace],
  );
  const stageStyle: React.CSSProperties = {
    opacity: cover.opacity,
    zIndex: cover.above ? 3 : 1,
    clipPath: cover.clipBand ? `inset(0px 0px ${ATTRIBUTION_BAND_PX}px 0px)` : undefined,
    transition: `opacity ${reducedMotion ? CROSSFADE_MS : WIPE_STEP_MS}ms linear`,
    visibility: cover.opacity === 0 && !cover.above ? "hidden" : undefined,
  };

  if (fallen) {
    return (
      <>
        <p className="overland-town-notice" data-testid="overland-town-fallback" role="status">
          <span className="sr-only">The 3D town isn&apos;t available right now. Here are its routes.</span>
          <PixelLabel scale={2} text="The 3D town isn't available right now." />
        </p>
        {fallback}
        {entry && map ? <OverlandJump entrance={realmState?.via === "jump" ? "dive" : "direct"} entry={entry} map={map} miniMapRect={() => undefined} onExit={exitRealm} transition="wipe" /> : null}
      </>
    );
  }

  return (
    <div
      className="overland-diorama"
      data-light={light}
      data-testid="overland-town"
      data-town-biome={plan.biome}
      data-town-phase={state.phase}
      data-town-tier={state.phase === "ready" || state.phase === "loading" ? state.tier : undefined}
      ref={setTownElement}
    >
      <h1 className="sr-only">{`${town.name}, ${plural(plan.signposts.length, "route")}`}</h1>
      <div className="overland-town-stage" data-cover-opacity={cover.opacity} data-testid="overland-town-stage" inert={!cover.interactive} ref={stageRef} style={stageStyle} />
      <div
        className="overland-town-ui"
        hidden={!cover.interactive}
        inert={!cover.interactive}
        onBlur={(event) => {
          // Leaving the story or photos for anywhere but a signpost lets the signpost go.
          const next = event.relatedTarget;
          if (!withinStory(event.target) || withinStory(next) || (next instanceof HTMLElement && next.classList.contains("overland-town-sign"))) return;
          if (!photo) setFocused(null);
        }}
      >
        <div className="overland-town-head" aria-hidden="true">
          <PixelLabel bold scale={2} text={town.name} />
          <PixelLabel colour={C.mute} scale={2} text={`${plural(plan.signposts.length, "route")} · ${Math.round(totalKm).toLocaleString("en")} km`} />
        </div>
        <div className="overland-town-back">
          <Key label="Back to the world map" onClick={onBack}>
            <PixelLabel scale={2} text="World" />
          </Key>
        </div>
        <ol aria-label={`Routes in ${town.name}`} className="overland-town-signs" data-testid="overland-town-signs">
          {plan.signposts.map((sign) => (
            <li key={sign.slug}>
              {entries.find((candidate) => candidate.slug === sign.slug)?.note ? (
                <span className="sr-only" id={`overland-sign-note-${sign.slug}`}>
                  {entries.find((candidate) => candidate.slug === sign.slug)?.note}
                </span>
              ) : null}
              <button
                aria-label={signLabel(sign)}
                className="overland-town-sign"
                data-slug={sign.slug}
                aria-describedby={entries.find((candidate) => candidate.slug === sign.slug)?.note ? `overland-sign-note-${sign.slug}` : undefined}
                onBlur={(event) => {
                  if (withinStory(event.relatedTarget)) return;
                  setFocused((current) => (current === sign.slug ? null : current));
                }}
                onClick={() => startJump(sign.slug)}
                onFocus={() => setFocused(sign.slug)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    stepSign(sign.slug, event.key === "ArrowRight" ? 1 : -1);
                  }
                }}
                onMouseEnter={() => setFocused(sign.slug)}
                onMouseLeave={(event) => {
                  if (withinStory(event.relatedTarget)) return;
                  setFocused((current) => (current === sign.slug && document.activeElement !== signRefs.current.get(sign.slug) && !withinStory(document.activeElement) ? null : current));
                }}
                ref={(button) => {
                  if (button) signRefs.current.set(sign.slug, button);
                  else signRefs.current.delete(sign.slug);
                }}
                type="button"
              />
            </li>
          ))}
        </ol>
        {chosenSign && !realmSlug ? (
          <StoryBox boxRef={storyRef} key={chosenSign.slug} note={entries.find((candidate) => candidate.slug === chosenSign.slug)?.note ?? null} sign={chosenSign} width={size.width} />
        ) : null}
        <div className="overland-town-polaroids" data-testid="overland-town-polaroids" ref={polaroidRef}>
          {!realmSlug
            ? polaroids.map((annotation, index) => (
                <PixelPolaroid annotation={annotation} key={annotation.id} onOpen={() => setPhoto(annotation)} scale={size.width < 560 ? 2 : 3} tilt={[-5, 3, -2][index] ?? 0} />
              ))
            : null}
        </div>
        <p className="overland-town-hint" aria-hidden="true">
          <PixelLabel colour={C.paper} scale={2} text={state.phase === "loading" ? "Building the town" : "Tap a signpost"} />
        </p>
      </div>
      {photo ? <PhotoViewer annotation={photo} onClose={() => setPhoto(null)} /> : null}
      {entry && map && townElement ? (
        <OverlandJump
          container={townElement}
          cover={jumpCover}
          entrance={realmState?.via === "jump" ? "dive" : "direct"}
          entry={entry}
          map={map}
          miniMapRect={() => undefined}
          onCover={setCover}
          onExit={exitRealm}
          transition="town"
        />
      ) : null}
    </div>
  );
}
