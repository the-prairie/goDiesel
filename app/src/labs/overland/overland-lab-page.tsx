import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  decodedRouteSlug,
  overlandEntryPath,
  overlandWorldPath,
  type OverlandView,
} from "@/app/route-paths";
import { routes } from "@/data/routes";
import { context2d } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { sprites } from "@/labs/overland/engine/sprites";
import {
  ENTRY_BOX_HEIGHT,
  ENTRY_HEIGHT,
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

/** A label drawn in the Overland font; the button around it carries the name. */
function PixelLabel({ text, colour = C.ink, bold = false, scale }: { text: string; colour?: string; bold?: boolean; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const label = drawLabel(text, colour, bold);
    target.width = label.width;
    target.height = label.height;
    context2d(target).drawImage(label, 0, 0);
  }, [bold, colour, text]);
  return <canvas aria-hidden="true" className="overland-pixels" ref={ref} style={{ height: 9 * scale, width: "auto" }} />;
}

function ArrowIcon({ direction, scale }: { direction: "left" | "right"; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    if (target) context2d(target).drawImage(sprites().icons[direction], 0, 0);
  }, [direction]);
  return <canvas aria-hidden="true" className="overland-pixels" height={7} ref={ref} style={{ width: 5 * scale, height: 7 * scale }} width={5} />;
}

function Key({ label, children, onClick, pressed, className = "" }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string }) {
  return (
    <button aria-label={label} aria-pressed={pressed} className={`overland-key ${className}`} onClick={onClick} type="button">
      {children}
    </button>
  );
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

function clampCamera(x: number, y: number) {
  const viewHeight = WORLD_HEIGHT - WORLD_BOX_HEIGHT;
  return {
    x: Math.min(Math.max(x, 0), WORLD_MAP.width - SCREEN_WIDTH),
    y: Math.min(Math.max(y, 0), WORLD_MAP.height - viewHeight),
  };
}

function cameraOn(town: OverlandTown | undefined) {
  if (!town) return { x: 0, y: 0 };
  return clampCamera(town.x - SCREEN_WIDTH / 2, town.y - (WORLD_HEIGHT - WORLD_BOX_HEIGHT) / 2);
}

function WorldMap({
  scale,
  selected,
  reducedMotion,
  onSelect,
  onOpen,
}: {
  scale: number;
  selected: number;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onOpen: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const camera = useRef(cameraOn(TOWNS[selected] ?? TOWNS[HOME_TOWN]));
  const target = useRef(camera.current);
  const drag = useRef<{ id: number; x: number; y: number; camX: number; camY: number; moved: boolean } | null>(null);
  const lines = worldLines(TOWNS[selected]);
  const shownAt = useTypedText(lines, reducedMotion);

  useEffect(() => {
    if (selected >= 0) target.current = cameraOn(TOWNS[selected]);
  }, [selected]);

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
        height={WORLD_HEIGHT}
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
          camera.current = clampCamera(current.camX - dx, current.camY - dy);
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
        style={{ width: SCREEN_WIDTH * scale, height: WORLD_HEIGHT * scale }}
        tabIndex={0}
        width={SCREEN_WIDTH}
      />
      <div className="overland-view" style={{ width: SCREEN_WIDTH * scale, height: (WORLD_HEIGHT - WORLD_BOX_HEIGHT) * scale }}>
        <div className="overland-towns" data-testid="overland-towns" ref={layer} style={{ width: WORLD_MAP.width * scale, height: WORLD_MAP.height * scale }}>
          {TOWNS.map((town, index) => (
            <button
              aria-label={townLabel(town)}
              aria-pressed={index === selected}
              className="overland-town"
              key={town.name}
              onClick={() => onSelect(index)}
              onFocus={() => {
                target.current = cameraOn(town);
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

function RouteIndex({ scale, town, onOpenEntry }: { scale: number; town?: OverlandTown; onOpenEntry: (slug: string) => void }) {
  const list = town ? NEWEST_FIRST.filter((entry) => entry.place === town.name) : NEWEST_FIRST;
  return (
    <div className="overland-index" data-testid="overland-index" style={{ width: SCREEN_WIDTH * scale, height: WORLD_HEIGHT * scale }}>
      <IndexHeader count={list.length} scale={scale} town={town} />
      <ol aria-label={town ? `Routes in ${town.name}` : "All routes"}>
        {list.map((entry) => (
          <IndexRow entry={entry} key={entry.slug} onOpen={() => onOpenEntry(entry.slug)} scale={scale} />
        ))}
      </ol>
    </div>
  );
}

function World({ scale, reducedMotion }: { scale: number; reducedMotion: boolean }) {
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
            <Key className="overland-key-primary" label="Open" onClick={() => showView("index")}>
              <PixelLabel bold colour="#ffffff" scale={2} text="Open" />
            </Key>
          ) : (
            <span aria-hidden="true" style={{ width: 60 }} />
          )}
        </>
      }
    >
      {view === "map" ? (
        <WorldMap onOpen={() => showView("index")} onSelect={select} reducedMotion={reducedMotion} scale={scale} selected={selected} />
      ) : (
        <RouteIndex onOpenEntry={openEntry} scale={scale} town={town} />
      )}
    </Device>
  );
}

// ---------------------------------------------------------------- entry

function Entry({ entry, scale, reducedMotion }: { entry: OverlandEntry; scale: number; reducedMotion: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
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

  const back = useCallback(() => {
    if ((location.state as { fromOverland?: boolean } | null)?.fromOverland) navigate(-1);
    else navigate(overlandWorldPath({ town: entry.place, view: "index" }));
  }, [entry.place, location.state, navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  const neighbour = (direction: 1 | -1) => {
    const next = ENTRIES[(entry.number - 1 + direction + ENTRIES.length) % ENTRIES.length];
    navigate(overlandEntryPath(next.slug), { replace: true, state: location.state });
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
    </Device>
  );
}

// ---------------------------------------------------------------- shell

function Device({ children, keys }: { children: ReactNode; keys: ReactNode }) {
  return (
    <div className="overland-device">
      <div className="overland-glass">
        <div className="overland-screen">{children}</div>
      </div>
      <div className="overland-keys">{keys}</div>
    </div>
  );
}

export function OverlandLabPage() {
  const { routeSlug } = useParams();
  const scale = usePixelScale();
  const reducedMotion = useReducedMotion();
  const slug = decodedRouteSlug(routeSlug);
  const entry = slug ? ENTRIES.find((candidate) => candidate.slug === slug) : undefined;

  if (routeSlug && !entry) return <RouteNotFound />;

  return (
    <div className="overland" data-testid="overland">
      {entry ? null : <h1 className="sr-only">Overland</h1>}
      {entry ? (
        <Entry entry={entry} key={entry.slug} reducedMotion={reducedMotion} scale={scale} />
      ) : (
        <World reducedMotion={reducedMotion} scale={scale} />
      )}
    </div>
  );
}
