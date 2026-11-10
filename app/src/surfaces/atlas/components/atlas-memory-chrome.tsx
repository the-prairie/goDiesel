import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { routeDetailPath } from "@/app/route-paths";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import {
  chapterOrder,
  latestRoute,
  memoryYears,
  placesInYear,
  yearFromPointer,
} from "@/surfaces/atlas/atlas-memory";
import type { AtlasMemoryLayout } from "@/surfaces/atlas/atlas-prototype-layout";
import type { AtlasContentInsets } from "@/surfaces/atlas/atlas-world";
import "./atlas-memory.css";

interface AtlasMemoryChromeProps {
  layout: AtlasMemoryLayout;
  routes: RouteSummary[];
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  year: number | null;
  flying: boolean;
  terrainNote: string | null;
  onSelectRegion: (region: RouteRegion) => void;
  onClearRegion: () => void;
  onYear: (year: number) => void;
  onSpin: (radians: number) => void;
  replayPathForRoute: (route: RouteSummary) => string;
  onContentInsets: (insets: AtlasContentInsets) => void;
}

export function AtlasMemoryChrome({
  layout,
  routes,
  regions,
  selectedRegion,
  year,
  flying,
  terrainNote,
  onSelectRegion,
  onClearRegion,
  onYear,
  onSpin,
  replayPathForRoute,
  onContentInsets,
}: AtlasMemoryChromeProps) {
  const years = useMemo(() => memoryYears(routes), [routes]);
  const chapters = useMemo(() => chapterOrder(regions), [regions]);
  const activeYear = year && years.includes(year) ? year : years.at(-1) ?? null;
  const [finding, setFinding] = useState(false);
  const [turning, setTurning] = useState(layout === "d");

  useEffect(() => {
    if (layout === "d" && !selectedRegion) setTurning(true);
  }, [layout, selectedRegion]);

  useEffect(() => {
    if (layout !== "d" || selectedRegion || !turning) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(0.05, (now - last) / 1000);
      last = now;
      onSpin(elapsed * 0.045);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [layout, onSpin, selectedRegion, turning]);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("[data-testid='atlas-spine-mobile']");
    const navHeight = nav && getComputedStyle(nav).display !== "none"
      ? nav.getBoundingClientRect().height
      : 0;
    const bottom = layout === "f"
      ? Math.round(window.innerHeight * 0.46)
      : layout === "e"
        ? Math.round(navHeight + 96)
        : selectedRegion
          ? Math.round(navHeight + 230)
          : Math.round(navHeight + 24);
    onContentInsets({ top: 88, right: 72, bottom, left: 20 });
  }, [layout, onContentInsets, selectedRegion?.name]);

  const selectRegionRef = useRef(onSelectRegion);
  selectRegionRef.current = onSelectRegion;
  const startedChapter = useRef(false);

  useEffect(() => {
    if (layout !== "f" || selectedRegion || startedChapter.current) return;
    const first = chapters[0];
    if (!first) return;
    startedChapter.current = true;
    selectRegionRef.current(first);
  }, [chapters, layout, selectedRegion]);

  const signature = latestRoute(selectedRegion?.routes ?? []);
  const terrainLimit = terrainNote && /unavailable/i.test(terrainNote) ? terrainNote : null;

  return (
    <>
      {selectedRegion && layout !== "f" ? (
        <button type="button" className="atlas-memory-back" aria-label="Back to the planet" onClick={onClearRegion}>
          <X aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="atlas-memory-find"
        data-testid="atlas-memory-find"
        aria-expanded={finding}
        aria-label={finding ? "Close find" : "Find a place"}
        onClick={() => setFinding((open) => !open)}
      >
        {finding ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
      </button>
      {layout === "d" && !selectedRegion ? (
        <button
          type="button"
          className="atlas-memory-hold"
          aria-pressed={turning}
          onClick={() => setTurning((value) => !value)}
        >
          {turning ? "Hold" : "Turn"}
        </button>
      ) : null}
      {finding ? (
        <FindPlaces
          routes={routes}
          regions={regions}
          onSelectRegion={(region) => {
            setFinding(false);
            onSelectRegion(region);
          }}
        />
      ) : null}
      {layout === "d" && flying && selectedRegion ? (
        <p className="atlas-memory-flying">Flying to {selectedRegion.name}</p>
      ) : null}
      {layout === "d" && selectedRegion ? (
        <Arrival
          region={selectedRegion}
          route={signature}
          terrainNote={terrainLimit}
          replayPath={signature ? replayPathForRoute(signature) : undefined}
        />
      ) : null}
      {layout === "e" && activeYear ? (
        <Biography
          year={activeYear}
          years={years}
          routes={routes}
          regions={regions}
          onYear={onYear}
          onSelectRegion={onSelectRegion}
        />
      ) : null}
      {layout === "f" && selectedRegion ? (
        <Chapter
          chapters={chapters}
          region={selectedRegion}
          route={signature}
          terrainNote={terrainLimit}
          replayPath={signature ? replayPathForRoute(signature) : undefined}
          onSelectRegion={onSelectRegion}
        />
      ) : null}
    </>
  );
}

function Arrival({
  region,
  route,
  terrainNote,
  replayPath,
}: {
  region: RouteRegion;
  route?: RouteSummary;
  terrainNote: string | null;
  replayPath?: string;
}) {
  const years = memoryYears(region.routes);
  const span = years.length > 1 ? `${years[0]} to ${years.at(-1)}` : String(years[0] ?? "");
  return (
    <footer className="atlas-memory-arrival" data-testid="atlas-memory-arrival">
      <p className="atlas-memory-kicker">You were here {span}</p>
      <h1 className="atlas-memory-title">{region.name}</h1>
      <p className="atlas-memory-meta">
        {region.routes.length} {region.routes.length === 1 ? "route" : "routes"}
        {" · "}
        {Math.round(region.totalKm)} km
      </p>
      {route && route.name !== region.name ? <p className="atlas-memory-quote">{route.name}</p> : null}
      {terrainNote ? <p className="atlas-memory-meta">{terrainNote}</p> : null}
      {route && replayPath ? <MemoryAction route={route} replayPath={replayPath} /> : null}
    </footer>
  );
}

function Biography({
  year,
  years,
  routes,
  regions,
  onYear,
  onSelectRegion,
}: {
  year: number;
  years: number[];
  routes: RouteSummary[];
  regions: RouteRegion[];
  onYear: (year: number) => void;
  onSelectRegion: (region: RouteRegion) => void;
}) {
  const places = placesInYear(routes, year).slice(0, 4);
  const railRef = useRef<HTMLDivElement>(null);

  function choose(name: string) {
    const region = regions.find((item) => item.name === name);
    if (region) onSelectRegion(region);
  }

  function yearAt(clientX: number) {
    const rail = railRef.current;
    if (!rail) return;
    const box = rail.getBoundingClientRect();
    const next = yearFromPointer(clientX, box.left, box.width, years);
    if (next !== null && next !== year) onYear(next);
  }

  return (
    <>
      <p className="atlas-memory-year" data-testid="atlas-memory-year">{year}</p>
      <ul className="atlas-memory-places">
        {places.map((place) => (
          <li key={place.name}>
            <button
              type="button"
              className="atlas-memory-place"
              onClick={() => choose(place.name)}
            >
              {place.name}
              <small>{place.count}</small>
            </button>
          </li>
        ))}
      </ul>
      <div
        ref={railRef}
        className="atlas-memory-rail"
        data-testid="atlas-memory-rail"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          yearAt(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) yearAt(event.clientX);
        }}
      >
        {years.map((value) => (
          <button
            key={value}
            type="button"
            className="atlas-memory-year-button"
            aria-pressed={value === year}
            onClick={() => onYear(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </>
  );
}

function Chapter({
  chapters,
  region,
  route,
  terrainNote,
  replayPath,
  onSelectRegion,
}: {
  chapters: RouteRegion[];
  region: RouteRegion;
  route?: RouteSummary;
  terrainNote: string | null;
  replayPath?: string;
  onSelectRegion: (region: RouteRegion) => void;
}) {
  const index = Math.max(0, chapters.findIndex((item) => item.name === region.name));
  const startX = useRef<number | null>(null);
  const go = (step: number) => {
    const next = chapters[index + step];
    if (next) onSelectRegion(next);
  };
  return (
    <article
      className="atlas-memory-chapter"
      data-testid="atlas-memory-chapter"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        startX.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (startX.current === null) return;
        const delta = event.clientX - startX.current;
        startX.current = null;
        if (delta <= -48) go(1);
        else if (delta >= 48) go(-1);
      }}
    >
      <p className="atlas-memory-kicker">
        {String(index + 1).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")}
      </p>
      <h1 className="atlas-memory-title">{region.name}</h1>
      {route && route.name !== region.name ? <p className="atlas-memory-quote">{route.name}</p> : null}
      <div className="atlas-memory-stats">
        <p><b>{Math.round(region.totalKm)}</b><span>kilometres</span></p>
        <p><b>{region.routes.length}</b><span>{region.routes.length === 1 ? "route" : "routes"}</span></p>
        <p><b>{Math.round(region.totalClimbM).toLocaleString()}</b><span>metres up</span></p>
      </div>
      {terrainNote ? <p className="atlas-memory-meta">{terrainNote}</p> : null}
      <div className="atlas-memory-actions">
        {route && replayPath ? <MemoryAction route={route} replayPath={replayPath} /> : null}
        <div className="atlas-memory-chapter-nav">
          <button type="button" className="atlas-memory-step" aria-label="Previous place" onClick={() => go(-1)} disabled={index === 0}>
            Prev
          </button>
          <button type="button" className="atlas-memory-step" aria-label="Next place" onClick={() => go(1)} disabled={index === chapters.length - 1}>
            Next
          </button>
        </div>
      </div>
    </article>
  );
}

function MemoryAction({ route, replayPath }: { route: RouteSummary; replayPath: string }) {
  const replayable = route.lifecycle !== "planned"
    && route.replay.geometryStatus === "ready"
    && route.replay.replayEligible;
  return (
    <Link className="atlas-memory-replay" to={replayable ? replayPath : routeDetailPath(route.slug)}>
      {replayable ? "Replay" : "Route guide"}
    </Link>
  );
}

function FindPlaces({
  routes,
  regions,
  onSelectRegion,
}: {
  routes: RouteSummary[];
  regions: RouteRegion[];
  onSelectRegion: (region: RouteRegion) => void;
}) {
  const fieldId = useId();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (normalized.length < 2) return [];
    return regions
      .filter((region) => region.name.toLowerCase().includes(normalized))
      .slice(0, 6);
  }, [normalized, regions]);
  const routeHits = useMemo(() => {
    if (normalized.length < 2) return [];
    return routes
      .filter((route) => route.name.toLowerCase().includes(normalized) || route.region.toLowerCase().includes(normalized))
      .slice(0, 5);
  }, [normalized, routes]);
  return (
    <div className="atlas-memory-search" role="dialog" aria-label="Find a place" data-testid="atlas-memory-search">
      <label className="atlas-memory-field" htmlFor={fieldId}>
        <span className="sr-only">Search places and routes</span>
        <input
          id={fieldId}
          value={query}
          placeholder="Search places and routes"
          aria-label="Search places and routes"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {hits.map((region) => (
        <button key={region.name} type="button" className="atlas-memory-hit" onClick={() => onSelectRegion(region)}>
          {region.name}
        </button>
      ))}
      {routeHits.map((route) => (
        <button
          key={route.slug}
          type="button"
          className="atlas-memory-hit"
          onClick={() => {
            const region = regions.find((item) => item.name === route.region);
            if (region) onSelectRegion(region);
          }}
        >
          {route.name}
        </button>
      ))}
    </div>
  );
}
