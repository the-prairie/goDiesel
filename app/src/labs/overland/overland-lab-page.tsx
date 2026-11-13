import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  APP_PATHS,
  decodedRouteSlug,
  overlandEntryPath,
  overlandRealmPath,
  overlandTownPath,
  overlandWorldPath,
  type OverlandView,
} from "@/app/route-paths";
import { routes } from "@/data/routes";
import { context2d } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import {
  ENTRY_BOX_HEIGHT,
  ENTRY_HEIGHT,
  ENTRY_MAP,
  INDEX_ROW_HEIGHT,
  SCREEN_WIDTH,
  WORLD_BOX_HEIGHT,
  WORLD_HEIGHT,
  drawEntryScreen,
  drawIndexRow,
  drawLabel,
  drawWorldScreen,
  typedLength,
  wrapForBox,
} from "@/labs/overland/engine/screens";
import { WORLD_MASK_ID } from "@/labs/overland/engine/world-mask";
import { buildOverlandEntries, type OverlandEntry } from "@/labs/overland/model/overland-entries";
import { WORLD_MAP, buildOverlandTowns, spreadTowns, type OverlandTown } from "@/labs/overland/model/overland-towns";
import { placeLook } from "@/labs/overland/model/place-biomes";
import { normaliseRouteLine } from "@/labs/overland/model/route-line";
import type { JumpTransition } from "@/labs/overland/overland-jump-state";
import { OverlandJump, useRealmViewport } from "@/labs/overland/overland-jump";
import { phoneWorldScreen } from "@/labs/overland/model/world-screen";
import { OverlandTownView } from "@/labs/overland/overland-town";
import { townBySlug, townSlug } from "@/labs/overland/model/town-input";
import { ArrowIcon, Device, Key, PixelLabel, usePhone } from "@/labs/overland/overland-ui";
import { entryBoxText, entryFacts, formatEntryDate, pageLines, routeNumberLabel } from "@/labs/overland/model/text-box";
import { RouteNotFound } from "@/ui/route-not-found";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import "./overland.css";

const ENTRIES = buildOverlandEntries(routes);
// Close places are drawn apart so each town stays visible and tappable.
const TOWNS = spreadTowns(buildOverlandTowns(routes), 11);
const NEWEST_FIRST = [...ENTRIES].reverse();
const HOME_TOWN = Math.max(0, TOWNS.findIndex((town) => town.name === ENTRIES.at(-1)?.place));
const TYPE_MS_PER_GRAPHEME = 26;

function plural(count: number, one: string) {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** The integer pixel scale that fits the screen in the viewport. */
function usePixelScale() {
  // The entry screen is the tallest: 184 pixels plus the device and its keys.
  const pick = () => {
    const byWidth = window.innerWidth < 560 ? 2 : window.innerWidth >= 1200 ? 4 : 3;
    const byHeight = Math.floor((window.innerHeight - 180) / ENTRY_HEIGHT);
    return Math.max(2, Math.min(byWidth, byHeight));
  };
  const [scale, setScale] = useState(pick);
  useEffect(() => {
    const update = () => setScale(pick());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return scale;
}

/**
 * Runs a draw function every animation frame while mounted. The function is
 * read from a ref, so a re-render changes what is drawn without restarting
 * the loop. With reduced motion the clock stands still.
 */
function usePixelLoop(canvas: React.RefObject<HTMLCanvasElement | null>, draw: (context: CanvasRenderingContext2D, now: number) => void, reducedMotion: boolean) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = context2d(element);
    let frame = 0;
    const tick = (now: number) => {
      drawRef.current(context, reducedMotion ? 0 : now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [canvas, reducedMotion]);
}

/** How many graphemes of a text box have been typed out by `now`. */
function useTypedText(lines: string[], reducedMotion: boolean) {
  const key = lines.join("\n");
  const startRef = useRef({ key: "", at: 0 });
  return useCallback(
    (now: number) => {
      if (reducedMotion) return typedLength(key.split("\n"));
      if (startRef.current.key !== key) startRef.current = { key, at: now };
      return Math.floor((now - startRef.current.at) / TYPE_MS_PER_GRAPHEME);
    },
    [key, reducedMotion],
  );
}

// ---------------------------------------------------------------- world

function townLabel(town: OverlandTown) {
  return `${town.name}, ${plural(town.routeCount, "route")}`;
}

function worldLines(selected: OverlandTown | undefined) {
  if (selected) {
    return [selected.name, `${plural(selected.routeCount, "route")} · ${Math.round(selected.km).toLocaleString("en")} km`];
  }
  return [`${plural(TOWNS.length, "town")} · ${plural(ENTRIES.length, "route")}`, `Latest: ${TOWNS[HOME_TOWN]?.name ?? ""}`];
}

/** The world screen in pixels: the handheld's, or a phone's whole screen. */
interface ScreenSize {
  cols: number;
  rows: number;
}

const HANDHELD: ScreenSize = { cols: SCREEN_WIDTH, rows: WORLD_HEIGHT };

function clampCamera(x: number, y: number, screen: ScreenSize) {
  const viewHeight = screen.rows - WORLD_BOX_HEIGHT;
  return {
    x: Math.min(Math.max(x, 0), WORLD_MAP.width - screen.cols),
    y: Math.min(Math.max(y, 0), Math.max(0, WORLD_MAP.height - viewHeight)),
  };
}

function cameraOn(town: OverlandTown | undefined, screen: ScreenSize) {
  if (!town) return { x: 0, y: 0 };
  return clampCamera(town.x - screen.cols / 2, town.y - (screen.rows - WORLD_BOX_HEIGHT) / 2, screen);
}

function WorldMap({
  scale,
  screen,
  selected,
  reducedMotion,
  onSelect,
  onOpen,
}: {
  scale: number;
  screen: ScreenSize;
  selected: number;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onOpen: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const camera = useRef(cameraOn(TOWNS[selected] ?? TOWNS[HOME_TOWN], screen));
  const target = useRef(camera.current);
  const drag = useRef<{ id: number; x: number; y: number; camX: number; camY: number; moved: boolean } | null>(null);
  const lines = worldLines(TOWNS[selected]);
  const shownAt = useTypedText(lines, reducedMotion);

  useEffect(() => {
    if (selected >= 0) target.current = cameraOn(TOWNS[selected], screen);
    else target.current = clampCamera(target.current.x, target.current.y, screen);
  }, [screen, selected]);

  usePixelLoop(canvas, (context, now) => {
    if (!drag.current) {
      const ease = reducedMotion ? 1 : 0.18;
      camera.current = {
        x: camera.current.x + (target.current.x - camera.current.x) * ease,
        y: camera.current.y + (target.current.y - camera.current.y) * ease,
      };
    }
    if (layer.current) {
      layer.current.style.transform = `translate(${-camera.current.x * scale}px, ${-camera.current.y * scale}px)`;
    }
    drawWorldScreen(context, {
      camX: camera.current.x,
      camY: camera.current.y,
      towns: TOWNS,
      selected,
      homeTown: HOME_TOWN,
      lines,
      shown: shownAt(performance.now()),
      now,
      width: screen.cols,
      height: screen.rows,
    });
  }, reducedMotion);

  const step = (direction: 1 | -1) => {
    const next = selected < 0 ? (direction === 1 ? 0 : TOWNS.length - 1) : (selected + direction + TOWNS.length) % TOWNS.length;
    onSelect(next);
  };

  return (
    <>
      <canvas
        aria-describedby="overland-world-text"
        aria-label="World map. Use the arrow keys to move between towns and Enter to open one."
        className="overland-pan"
        data-mask={WORLD_MASK_ID}
        data-testid="overland-world"
        height={screen.rows}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") step(1);
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
          else if (event.key === "Enter" || event.key === " ") onOpen();
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camX: camera.current.x, camY: camera.current.y, moved: false };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          const dx = (event.clientX - current.x) / scale;
          const dy = (event.clientY - current.y) / scale;
          if (Math.hypot(dx, dy) > 2) current.moved = true;
          camera.current = clampCamera(current.camX - dx, current.camY - dy, screen);
          target.current = camera.current;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        ref={canvas}
        role="img"
        style={{ width: screen.cols * scale, height: screen.rows * scale }}
        tabIndex={0}
        width={screen.cols}
      />
      <div className="overland-view" style={{ width: screen.cols * scale, height: (screen.rows - WORLD_BOX_HEIGHT) * scale }}>
        <div className="overland-towns" data-testid="overland-towns" ref={layer} style={{ width: WORLD_MAP.width * scale, height: WORLD_MAP.height * scale }}>
          {TOWNS.map((town, index) => (
            <button
              aria-label={townLabel(town)}
              aria-pressed={index === selected}
              className="overland-town"
              key={town.name}
              onClick={() => onSelect(index)}
              onFocus={() => {
                target.current = cameraOn(town, screen);
              }}
              style={{ left: town.x * scale, top: town.y * scale, width: 14 * scale, height: 14 * scale }}
              type="button"
            />
          ))}
        </div>
      </div>
      <p aria-live="polite" className="sr-only" data-testid="overland-world-text" id="overland-world-text">
        {lines.join(". ")}
      </p>
    </>
  );
}

function IndexHeader({ town, count, scale }: { town?: OverlandTown; count: number; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const context = context2d(target);
    context.fillStyle = C.ink;
    context.fillRect(0, 0, SCREEN_WIDTH, 16);
    const title = drawLabel(town ? town.name : "Index", C.paper, true);
    context.drawImage(title, 6, 4);
    const total = drawLabel(town ? `${count} of ${ENTRIES.length}` : plural(count, "route"), "#c9d1e4");
    context.drawImage(total, SCREEN_WIDTH - 6 - total.width, 4);
  }, [count, town]);
  return <canvas aria-hidden="true" height={16} ref={ref} style={{ width: SCREEN_WIDTH * scale, height: 16 * scale }} width={SCREEN_WIDTH} />;
}

function IndexRow({ entry, scale, onOpen }: { entry: OverlandEntry; scale: number; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (target) context2d(target).drawImage(drawIndexRow(entry, false), 0, 0);
  }, [entry]);
  return (
    <li>
      <button
        aria-label={`${routeNumberLabel(entry.number)}, ${entry.title}, ${entry.place}, ${entry.km.toFixed(1)} km`}
        className="overland-row"
        onClick={onOpen}
        type="button"
      >
        <canvas aria-hidden="true" height={INDEX_ROW_HEIGHT} ref={ref} style={{ width: SCREEN_WIDTH * scale, height: INDEX_ROW_HEIGHT * scale }} width={SCREEN_WIDTH} />
      </button>
    </li>
  );
}

function RouteIndex({ scale, town, onOpenEntry, height }: { scale: number; town?: OverlandTown; onOpenEntry: (slug: string) => void; height?: number }) {
  const list = town ? NEWEST_FIRST.filter((entry) => entry.place === town.name) : NEWEST_FIRST;
  return (
    <div className="overland-index" data-testid="overland-index" style={{ width: SCREEN_WIDTH * scale, height: height ?? WORLD_HEIGHT * scale }}>
      <IndexHeader count={list.length} scale={scale} town={town} />
      <ol aria-label={town ? `Routes in ${town.name}` : "All routes"}>
        {list.map((entry) => (
          <IndexRow entry={entry} key={entry.slug} onOpen={() => onOpenEntry(entry.slug)} scale={scale} />
        ))}
      </ol>
    </div>
  );
}

/**
 * The world, on a phone, fills the screen: the map at a whole-pixel scale
 * edge to edge, its text box and the keys at the bottom in thumb reach, the
 * safe areas clear. In the handheld frame otherwise.
 */
function usePhoneScreen(phone: boolean) {
  const viewport = useRealmViewport();
  return useMemo(() => (phone ? phoneWorldScreen(viewport) : null), [phone, viewport]);
}

function World({ scale: handheldScale, reducedMotion }: { scale: number; reducedMotion: boolean }) {
  const phone = usePhone();
  const phoneScreen = usePhoneScreen(phone);
  const scale = phoneScreen?.scale ?? handheldScale;
  const screen = useMemo<ScreenSize>(() => (phoneScreen ? { cols: phoneScreen.cols, rows: phoneScreen.rows } : HANDHELD), [phoneScreen]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const townName = searchParams.get("town") ?? undefined;
  const view: OverlandView = searchParams.get("view") === "index" ? "index" : "map";
  const selected = TOWNS.findIndex((town) => town.name === townName);
  const town = TOWNS[selected];

  const select = (index: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("town", TOWNS[index].name);
    setSearchParams(next, { replace: true });
  };
  const showView = useCallback(
    (next: OverlandView) => navigate(overlandWorldPath({ town: town?.name, view: next })),
    [navigate, town?.name],
  );
  const openEntry = (slug: string) => navigate(overlandEntryPath(slug), { state: { fromOverland: true } });
  // Entering a town opens it in 3D; without a town chosen, Open lists every route.
  const openTown = () => (town ? navigate(overlandTownPath(townSlug(town.name))) : showView("index"));
  const step = (direction: 1 | -1) => {
    select(selected < 0 ? (direction === 1 ? 0 : TOWNS.length - 1) : (selected + direction + TOWNS.length) % TOWNS.length);
  };

  useEffect(() => {
    if (view !== "index") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) showView("map");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showView, view]);

  return (
    <Device
      bare={phone}
      corner={
        phone ? (
          <Key className="overland-exit" label="Leave Overland" onClick={() => navigate(APP_PATHS.atlas)}>
            <PixelLabel scale={2} text="Exit" />
          </Key>
        ) : null
      }
      keys={
        <>
          <div className="overland-key-group">
            <Key className="overland-key-square" label="Previous town" onClick={() => step(-1)}>
              <ArrowIcon direction="left" scale={2} />
            </Key>
            <Key className="overland-key-square" label="Next town" onClick={() => step(1)}>
              <ArrowIcon direction="right" scale={2} />
            </Key>
          </div>
          <div aria-label="View" className="overland-segment" role="group">
            <Key label="Map" onClick={() => showView("map")} pressed={view === "map"}>
              <PixelLabel scale={2} text="Map" />
            </Key>
            <Key label="Index" onClick={() => showView("index")} pressed={view === "index"}>
              <PixelLabel scale={2} text="Index" />
            </Key>
          </div>
          {view === "map" ? (
            <Key className="overland-key-primary" label="Open" onClick={openTown}>
              <PixelLabel bold colour="#ffffff" scale={2} text="Open" />
            </Key>
          ) : (
            <span aria-hidden="true" style={{ width: 60 }} />
          )}
        </>
      }
    >
      {view === "map" ? (
        <WorldMap onOpen={openTown} onSelect={select} reducedMotion={reducedMotion} scale={scale} screen={screen} selected={selected} />
      ) : (
        <RouteIndex
          height={phoneScreen ? phoneScreen.rows * phoneScreen.scale : undefined}
          onOpenEntry={openEntry}
          scale={phoneScreen ? Math.max(2, Math.floor((phoneScreen.cols * phoneScreen.scale) / SCREEN_WIDTH)) : scale}
          town={town}
        />
      )}
    </Device>
  );
}

// ---------------------------------------------------------------- entry

interface EntryState {
  fromOverland?: boolean;
  /** Set when the 3D world was jumped into from this entry. */
  via?: "jump";
}

function Entry({ entry, scale, reducedMotion, realm }: { entry: OverlandEntry; scale: number; reducedMotion: boolean; realm: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const transition: JumpTransition = searchParams.get("jump") === "live" ? "live" : "wipe";
  const enterKey = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(0);
  // A separator stays with the word before it, so no line starts with "·".
  const pages = useMemo(
    () => pageLines(wrapForBox(entryBoxText(entry).replace(/ · /g, "\u00a0· "), SCREEN_WIDTH - 16), 3),
    [entry],
  );
  const lines = pages[Math.min(page, pages.length - 1)] ?? [];
  const shownAt = useTypedText(lines, reducedMotion);
  const summary = routes.find((route) => route.slug === entry.slug)!;
  const look = placeLook(entry.place, summary.centerLat);
  const map = useMemo(
    () => ({
      slug: entry.slug,
      line: normaliseRouteLine(summary.trace),
      biome: look.biome,
      coastal: look.coastal,
      climbPerKm: entry.climbM === null ? 0 : entry.climbM / Math.max(1, entry.km),
    }),
    [entry, look.biome, look.coastal, summary.trace],
  );

  usePixelLoop(canvas, (context, now) => {
    drawEntryScreen(context, { entry, map, lines, shown: shownAt(performance.now()), morePages: page < pages.length - 1, now });
  }, reducedMotion);

  const entryState = location.state as EntryState | null;
  const back = useCallback(() => {
    if (entryState?.fromOverland) navigate(-1);
    else navigate(overlandWorldPath({ town: entry.place, view: "index" }));
  }, [entry.place, entryState, navigate]);

  // The 3D world is a URL below the entry, so Back and Escape return here.
  const enter = useCallback(() => {
    navigate(overlandRealmPath(entry.slug, transition), { state: { ...entryState, via: "jump" } satisfies EntryState });
  }, [entry.slug, entryState, navigate, transition]);
  const exitRealm = useCallback(() => {
    if (entryState?.via === "jump") navigate(-1);
    else navigate(`${overlandEntryPath(entry.slug)}${location.search}`, { replace: true });
  }, [entry.slug, entryState, location.search, navigate]);
  const miniMapRect = useCallback(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const box = element.getBoundingClientRect();
    const unit = box.width / SCREEN_WIDTH;
    return {
      left: box.left + ENTRY_MAP.left * unit,
      top: box.top + ENTRY_MAP.top * unit,
      width: ENTRY_MAP.width * unit,
      height: ENTRY_MAP.height * unit,
    };
  }, []);

  useEffect(() => {
    if (realm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") back();
      else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, enter, realm]);

  // Focus returns to Enter when the person comes back from the 3D world.
  const wasRealm = useRef(realm);
  useEffect(() => {
    if (wasRealm.current && !realm) enterKey.current?.focus({ preventScroll: true });
    wasRealm.current = realm;
  }, [realm]);

  const neighbour = (direction: 1 | -1) => {
    const next = ENTRIES[(entry.number - 1 + direction + ENTRIES.length) % ENTRIES.length];
    navigate(`${overlandEntryPath(next.slug)}${location.search}`, { replace: true, state: location.state });
  };

  return (
    <Device
      keys={
        <>
          <Key label="Back" onClick={back}>
            <PixelLabel scale={2} text="Back" />
          </Key>
          <div className="overland-key-group">
            <Key className="overland-key-square" label="Previous route" onClick={() => neighbour(-1)}>
              <ArrowIcon direction="left" scale={2} />
            </Key>
            <Key className="overland-key-square" label="Next route" onClick={() => neighbour(1)}>
              <ArrowIcon direction="right" scale={2} />
            </Key>
          </div>
          <Key className="overland-key-primary" label="Enter route" onClick={enter} ref={enterKey}>
            <PixelLabel bold colour="#ffffff" scale={2} text="Enter" />
          </Key>
        </>
      }
    >
      <section aria-labelledby="overland-entry-title" data-testid="overland-entry">
        <canvas
          aria-hidden="true"
          height={ENTRY_HEIGHT}
          ref={canvas}
          style={{ width: SCREEN_WIDTH * scale, height: ENTRY_HEIGHT * scale }}
          width={SCREEN_WIDTH}
        />
        {pages.length > 1 ? (
          <button
            aria-label={page < pages.length - 1 ? "Next page" : "First page"}
            className="overland-hit"
            onClick={() => setPage((current) => (current + 1) % pages.length)}
            style={{ left: 0, top: (ENTRY_HEIGHT - ENTRY_BOX_HEIGHT) * scale, width: SCREEN_WIDTH * scale, height: ENTRY_BOX_HEIGHT * scale }}
            type="button"
          />
        ) : null}
        <div className="sr-only">
          <p>{routeNumberLabel(entry.number)}</p>
          <h1 id="overland-entry-title">{entry.title}</h1>
          <p data-testid="overland-entry-text">{entryBoxText(entry)}</p>
          {entry.note ? <p>{entryFacts(entry)}</p> : null}
          <p>{entry.climbM === null ? "Climb not recorded" : `${entry.climbM.toLocaleString("en")} m of climb`}</p>
          <p>{formatEntryDate(entry.date)}</p>
        </div>
      </section>
      {realm ? (
        <OverlandJump
          entrance={entryState?.via === "jump" ? "dive" : "direct"}
          entry={entry}
          map={map}
          miniMapRect={miniMapRect}
          onExit={exitRealm}
          transition={transition}
        />
      ) : null}
    </Device>
  );
}

/** One of her places as a 3D town, and the pixel town's index when 3D cannot open. */
function Town({ townName, realmSlug, scale }: { townName: string; realmSlug?: string; scale: number }) {
  const navigate = useNavigate();
  const town = TOWNS.find((candidate) => candidate.name === townName)!;
  const back = useCallback(() => navigate(overlandWorldPath({ town: town.name })), [navigate, town.name]);
  const openEntry = (slug: string) => navigate(overlandEntryPath(slug), { state: { fromOverland: true } });
  return (
    <OverlandTownView
      entries={ENTRIES}
      fallback={
        <Device
          keys={
            <Key label="Back to the world map" onClick={back}>
              <PixelLabel scale={2} text="World" />
            </Key>
          }
        >
          <RouteIndex onOpenEntry={openEntry} scale={scale} town={town} />
        </Device>
      }
      onBack={back}
      realmSlug={realmSlug}
      town={town}
    />
  );
}

export function OverlandLabPage() {
  const { routeSlug, townSlug: townParam } = useParams();
  const scale = usePixelScale();
  const reducedMotion = useReducedMotion();
  const slug = decodedRouteSlug(routeSlug);
  const entry = slug ? ENTRIES.find((candidate) => candidate.slug === slug) : undefined;
  const { pathname } = useLocation();
  const realm = Boolean(entry) && pathname.endsWith("/3d");
  const town = townParam ? townBySlug(TOWNS, townParam) : undefined;

  if (townParam) {
    if (!town || (routeSlug && entry?.place !== town.name)) return <RouteNotFound />;
    return (
      <div className="overland overland-in-town" data-testid="overland">
        <Town key={town.name} realmSlug={routeSlug} scale={scale} townName={town.name} />
      </div>
    );
  }
  if (routeSlug && !entry) return <RouteNotFound />;

  return (
    <div className="overland overland-phone-ready" data-testid="overland" inert={realm}>
      {entry ? null : <h1 className="sr-only">Overland</h1>}
      {entry ? (
        <Entry entry={entry} key={entry.slug} realm={realm} reducedMotion={reducedMotion} scale={scale} />
      ) : (
        <World reducedMotion={reducedMotion} scale={scale} />
      )}
    </div>
  );
}
