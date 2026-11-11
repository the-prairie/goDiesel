import { Check, LocateFixed, Mountain, Search, SlidersHorizontal, X } from "lucide-react";
import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { routeDetailPath } from "@/app/route-paths";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import {
  atlasSheetOpens,
  reduceAtlasSheet,
  type AtlasCardLayout,
  type AtlasSheetDetent,
} from "@/surfaces/atlas/atlas-prototype-layout";
import type { AtlasContentInsets } from "@/surfaces/atlas/atlas-world";
import {
  type AtlasActivityMode,
} from "@/surfaces/atlas/components/atlas-controls";
import "./atlas-prototype-chrome.css";

interface AtlasPrototypeChromeProps {
  layout: AtlasCardLayout;
  routes: RouteSummary[];
  regions: RouteRegion[];
  query: string;
  onQueryChange: (query: string) => void;
  mode: AtlasActivityMode;
  onModeChange: (mode: AtlasActivityMode) => void;
  selectedRegion?: RouteRegion;
  selectedRoute?: RouteSummary;
  onSelectRegion: (region: RouteRegion) => void;
  onSelectRoute: (route: RouteSummary) => void;
  onSelectListedRoute: (route: RouteSummary) => void;
  onClearRegion: () => void;
  onClearRoute: () => void;
  onLocate: () => void;
  replayPathForRoute: (route: RouteSummary) => string;
  terrainNote: string | null;
  openSignal: number;
  onContentInsets: (insets: AtlasContentInsets) => void;
}

const ACTIVITY_OPTIONS = [
  ["all", "All activities"],
  ["runs", "Runs"],
  ["rides", "Rides"],
] as const;

export function AtlasPrototypeChrome({
  layout,
  routes,
  regions,
  query,
  onQueryChange,
  mode,
  onModeChange,
  selectedRegion,
  selectedRoute,
  onSelectRegion,
  onSelectRoute,
  onSelectListedRoute,
  onClearRegion,
  onClearRoute,
  onLocate,
  replayPathForRoute,
  terrainNote,
  openSignal,
  onContentInsets,
}: AtlasPrototypeChromeProps) {
  const filterId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const peekRestRef = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [sheetState, setSheetState] = useState<{ key: string; detent: AtlasSheetDetent } | null>(null);
  const selectionKey = `${layout}|${selectedRegion?.name ?? ""}|${selectedRoute?.slug ?? ""}`;
  const autoOpen = atlasSheetOpens(layout, Boolean(selectedRegion), Boolean(selectedRoute));
  const detent: AtlasSheetDetent = sheetState?.key === selectionKey
    ? sheetState.detent
    : autoOpen
      ? "peek"
      : "closed";
  const seenSignal = useRef(openSignal);
  useEffect(() => {
    if (seenSignal.current === openSignal) return;
    seenSignal.current = openSignal;
    if (autoOpen) setSheetState({ key: selectionKey, detent: "peek" });
  }, [autoOpen, openSignal, selectionKey]);
  const terrainLimit = terrainNote && /unavailable/i.test(terrainNote) ? terrainNote : null;
  const showTerrainIcon = Boolean(terrainLimit) && !(layout === "c" && detent !== "closed");
  const presentedRoute = layout === "c"
    ? selectedRoute
    : selectedRoute ?? selectedRegion?.routes[0];

  function setDetent(next: AtlasSheetDetent) {
    setSheetState({ key: selectionKey, detent: next });
  }

  useEffect(() => {
    if (!filtersOpen) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button, input, a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFiltersOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || toggleRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [filtersOpen]);

  useLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>("[data-testid='atlas-spine-mobile']");
    const navHeight = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0;
    const sheetHeight = detent === "closed" ? 0 : sheetRef.current?.offsetHeight ?? 0;
    if (detent === "peek" && sheetHeight > 0) peekRestRef.current = sheetHeight;
    const aboveNavigation = detent === "closed" ? 10 : (peekRestRef.current || sheetHeight) + 10;
    const section = sheetRef.current?.closest<HTMLElement>(".atlas-layout")
      ?? document.querySelector<HTMLElement>(".atlas-layout");
    section?.style.setProperty("--atlas-peek-rest", `${Math.round(aboveNavigation)}px`);
    onContentInsets({
      top: 88,
      right: 76,
      bottom: Math.round(navHeight + sheetHeight + 16),
      left: 16,
    });
  }, [detent, onContentInsets, presentedRoute?.slug, selectedRegion?.name, terrainLimit, terrainOpen]);

  return (
    <>
      <div className="atlas-proto-search" data-atlas-chrome="search">
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="atlas-proto-pill">
            <Search aria-hidden="true" size={18} />
            <label className="sr-only" htmlFor={`${filterId}-query`}>
              {selectedRegion ? `Search ${selectedRegion.name}` : "Search memories"}
            </label>
            <input
              id={`${filterId}-query`}
              value={query}
              placeholder="Search places and routes"
              aria-label="Search places and routes"
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {layout === "c" && mode !== "all" ? (
              <button
                type="button"
                className="atlas-proto-token"
                onClick={() => onModeChange("all")}
              >
                {mode === "runs" ? "Runs" : "Rides"}
                <X aria-hidden="true" size={14} />
                <span className="sr-only">Clear activity filter</span>
              </button>
            ) : null}
            <button
              ref={toggleRef}
              type="button"
              className="atlas-proto-icon-button"
              data-testid="atlas-prototype-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls={filterId}
              aria-label={filtersOpen ? "Close filters" : "Activity and place filters"}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? <X aria-hidden="true" /> : <SlidersHorizontal aria-hidden="true" />}
            </button>
          </div>
        </form>
        {filtersOpen ? (
          <div
            ref={panelRef}
            id={filterId}
            role="dialog"
            aria-label="Search filters"
            data-testid="atlas-prototype-filters"
            data-attached={layout === "b" ? "true" : "false"}
            className="atlas-proto-panel"
          >
            <h2>Filters</h2>
            <FilterChoices layout={layout} mode={mode} onModeChange={onModeChange} />
            {selectedRegion ? (
              <button type="button" className="atlas-proto-place" onClick={onClearRegion}>
                Show every place
                <span>Leave {selectedRegion.name}</span>
              </button>
            ) : null}
            <SearchResults
              query={query}
              routes={routes}
              regions={regions}
              onSelectRegion={onSelectRegion}
              onSelectRoute={onSelectRoute}
              onClear={() => setFiltersOpen(false)}
            />
            <button
              type="button"
              className="atlas-proto-primary"
              onClick={() => {
                setFiltersOpen(false);
                toggleRef.current?.focus();
              }}
            >
              Done
            </button>
          </div>
        ) : null}
      </div>
      <div className="atlas-proto-locate" data-atlas-chrome="locate">
        <button type="button" aria-label="Reset map view" onClick={onLocate}>
          <LocateFixed aria-hidden="true" />
        </button>
        {showTerrainIcon && terrainLimit ? (
          <span>
            <button
              type="button"
              aria-label={terrainLimit}
              aria-expanded={terrainOpen}
              onClick={() => setTerrainOpen((open) => !open)}
            >
              <Mountain aria-hidden="true" />
            </button>
            {terrainOpen ? <p className="atlas-proto-terrain-note" role="note">{terrainLimit}</p> : null}
          </span>
        ) : null}
      </div>
      {detent !== "closed" && selectedRegion ? (
        <Sheet
          ref={sheetRef}
          layout={layout}
          detent={detent}
          region={selectedRegion}
          route={presentedRoute}
          terrainNote={layout === "c" ? terrainLimit : null}
          onDetent={setDetent}
          onSelectRoute={onSelectListedRoute}
          onClearRoute={onClearRoute}
          replayPathForRoute={replayPathForRoute}
        />
      ) : null}
    </>
  );
}

function FilterChoices({
  layout,
  mode,
  onModeChange,
}: {
  layout: AtlasCardLayout;
  mode: AtlasActivityMode;
  onModeChange: (mode: AtlasActivityMode) => void;
}) {
  if (layout === "b") {
    return (
      <div className="atlas-proto-segment" role="group" aria-label="Activity">
        {ACTIVITY_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            {mode === value ? <Check aria-hidden="true" size={14} /> : null}
            {label}
          </button>
        ))}
      </div>
    );
  }
  if (layout === "c") {
    return (
      <div className="atlas-proto-tokens" role="group" aria-label="Activity">
        {ACTIVITY_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="atlas-proto-token"
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            {mode === value ? <Check aria-hidden="true" size={14} /> : null}
            {label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="atlas-proto-rows" role="group" aria-label="Activity">
      {ACTIVITY_OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="atlas-proto-row"
          aria-pressed={mode === value}
          onClick={() => onModeChange(value)}
        >
          <span>{label}</span>
          {mode === value ? <Check aria-hidden="true" size={16} /> : null}
        </button>
      ))}
    </div>
  );
}

function SearchResults({
  query,
  routes,
  regions,
  onSelectRegion,
  onSelectRoute,
  onClear,
}: {
  query: string;
  routes: RouteSummary[];
  regions: RouteRegion[];
  onSelectRegion: (region: RouteRegion) => void;
  onSelectRoute: (route: RouteSummary) => void;
  onClear: () => void;
}) {
  const normalized = query.trim().toLowerCase();
  const unsupported = /^(plan|find|near|suggest)\b/i.test(query.trim());
  const hits = useMemo(() => {
    if (normalized.length < 2 || unsupported) return { regions: [], routes: [] };
    return {
      regions: regions.filter((region) => region.name.toLowerCase().includes(normalized)).slice(0, 6),
      routes: routes.filter((route) =>
        [route.name, route.subtitle, route.region, route.type].join(" ").toLowerCase().includes(normalized),
      ).slice(0, 8),
    };
  }, [normalized, regions, routes, unsupported]);
  if (!query.trim()) return null;
  if (unsupported) {
    return <p className="atlas-proto-note" role="status">Planning queries belong in Finder. Atlas searches completed memories.</p>;
  }
  if (normalized.length < 2) {
    return <p className="atlas-proto-note" role="status">Keep typing to search completed memories.</p>;
  }
  if (hits.regions.length === 0 && hits.routes.length === 0) {
    return <p className="atlas-proto-note" role="status">No places or routes match that search.</p>;
  }
  return (
    <div className="atlas-proto-results">
      {hits.regions.map((region) => (
        <button
          key={region.name}
          type="button"
          className="atlas-proto-result"
          onClick={() => {
            onSelectRegion(region);
            onClear();
          }}
        >
          {region.name}
          <small>{region.routes.length} {region.routes.length === 1 ? "route" : "routes"}</small>
        </button>
      ))}
      {hits.routes.map((route) => (
        <button
          key={route.slug}
          type="button"
          className="atlas-proto-result"
          onClick={() => {
            onSelectRoute(route);
            onClear();
          }}
        >
          {route.name}
          <small>{route.region} · {route.distanceKm.toFixed(1)} km</small>
        </button>
      ))}
    </div>
  );
}

const Sheet = forwardRef<HTMLElement, {
  layout: AtlasCardLayout;
  detent: AtlasSheetDetent;
  region: RouteRegion;
  route?: RouteSummary;
  terrainNote: string | null;
  onDetent: (detent: AtlasSheetDetent) => void;
  onSelectRoute: (route: RouteSummary) => void;
  onClearRoute: () => void;
  replayPathForRoute: (route: RouteSummary) => string;
}>(function Sheet({
  layout,
  detent,
  region,
  route,
  terrainNote,
  onDetent,
  onSelectRoute,
  onClearRoute,
  replayPathForRoute,
}, ref) {
  const dragRef = useRef<{ y: number; moved: boolean } | null>(null);
  const index = route ? Math.max(0, region.routes.findIndex((item) => item.slug === route.slug)) : -1;
  const grabberLabel = detent === "peek"
    ? "Show more"
    : detent === "medium"
      ? "Show the full sheet"
      : "Return to the short sheet";
  const showRouteList = layout === "c" ? detent !== "peek" : detent === "large";

  function finishDrag(clientY: number) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return false;
    const delta = clientY - drag.y;
    if (delta <= -28) {
      onDetent(reduceAtlasSheet(detent, "expand"));
      return true;
    }
    if (delta >= 28) {
      onDetent(reduceAtlasSheet(detent, "collapse"));
      return true;
    }
    return drag.moved;
  }

  return (
    <section
      ref={ref}
      className="atlas-proto-sheet"
      data-atlas-chrome="sheet"
      data-testid="atlas-prototype-sheet"
      data-detent={detent}
      role="dialog"
      aria-modal="false"
      aria-label={layout === "c" && !route ? region.name : route?.name ?? region.name}
    >
      <div
        className="atlas-proto-sheet-bar"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          dragRef.current = { y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          if (Math.abs(event.clientY - dragRef.current.y) > 8) dragRef.current.moved = true;
        }}
        onPointerUp={(event) => finishDrag(event.clientY)}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <button
          type="button"
          className="atlas-proto-close"
          aria-label={layout === "c" ? "Close place details" : "Close route details"}
          onClick={() => {
            onDetent("closed");
            if (layout === "b") onClearRoute();
          }}
        >
          <X aria-hidden="true" />
        </button>
        <button
          type="button"
          className="atlas-proto-grabber"
          aria-label={grabberLabel}
          onPointerDown={(event) => {
            dragRef.current = { y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            if (Math.abs(event.clientY - dragRef.current.y) > 8) dragRef.current.moved = true;
          }}
          onPointerUp={(event) => {
            const dragged = finishDrag(event.clientY);
            if (!dragged) onDetent(reduceAtlasSheet(detent, "cycle"));
          }}
        >
          <span />
        </button>
      </div>
      <div className="atlas-proto-scroll">
        {layout === "c" && detent === "peek" ? (
          <>
            <h2 className="atlas-proto-title">{region.name}</h2>
            <p className="atlas-proto-meta">
              {region.routes.length} {region.routes.length === 1 ? "route" : "routes"}
              {" · "}
              {region.totalKm.toFixed(0)} km
              {" · "}
              {region.totalClimbM.toLocaleString()} m up
            </p>
          </>
        ) : route ? (
          <>
            <h2 className="atlas-proto-title">{route.name}</h2>
            {detent !== "peek" ? <p className="atlas-proto-note">{guideStatus(route)}</p> : null}
            {detent !== "peek" ? (
              <p className="atlas-proto-meta">
                {routeFacts(route)}
                {index >= 0 ? ` · ${index + 1} of ${region.routes.length}` : ""}
              </p>
            ) : null}
            {detent !== "peek" && route.date ? (
              <p className="atlas-proto-meta">{route.date.slice(0, 10)}</p>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="atlas-proto-title">{region.name}</h2>
            <p className="atlas-proto-meta">Select a route.</p>
          </>
        )}
        {terrainNote ? <p className="atlas-proto-note">{terrainNote}</p> : null}
        {showRouteList ? (
          <RouteList
            region={region}
            selectedSlug={route?.slug}
            onSelectRoute={onSelectRoute}
          />
        ) : null}
      </div>
      <div className="atlas-proto-action-row">
        <span className="atlas-proto-meta">
          {layout !== "c" && route && detent === "peek" ? (
            <>
              {guideStatus(route)}
              <br />
              {routeFacts(route)}
              {index >= 0 ? ` · ${index + 1} of ${region.routes.length}` : ""}
            </>
          ) : null}
          {detent === "large" && route && routeAction(route, replayPathForRoute(route)).label === "Open replay" ? (
            <Link className="atlas-proto-quiet" to={routeDetailPath(route.slug)}>
              Route guide
            </Link>
          ) : null}
        </span>
        {layout === "c" && detent === "peek" ? (
          <button type="button" className="atlas-proto-primary" onClick={() => onDetent("medium")}>
            Browse routes
          </button>
        ) : route ? (
          <PrimaryAction route={route} replayPath={replayPathForRoute(route)} />
        ) : null}
      </div>
    </section>
  );
});

function RouteList({
  region,
  selectedSlug,
  onSelectRoute,
}: {
  region: RouteRegion;
  selectedSlug?: string;
  onSelectRoute: (route: RouteSummary) => void;
}) {
  return (
    <ol className="atlas-proto-list">
      {region.routes.map((route, index) => {
        const selected = route.slug === selectedSlug;
        return (
          <li key={route.slug}>
            <button
              type="button"
              className="atlas-proto-route-row"
              aria-current={selected ? "true" : undefined}
              aria-pressed={selected}
              onClick={() => onSelectRoute(route)}
            >
              <span>
                <span className="atlas-proto-title">{route.name}</span>
                <span className="atlas-proto-meta">
                  {index + 1} of {region.routes.length}
                  {" · "}
                  {route.distanceKm.toFixed(1)} km
                </span>
              </span>
              {selected ? <span>Selected</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PrimaryAction({ route, replayPath }: { route: RouteSummary; replayPath: string }) {
  const action = routeAction(route, replayPath);
  return (
    <Link className="atlas-proto-primary" to={action.href}>
      {action.label}
    </Link>
  );
}

function routeAction(route: RouteSummary, replayPath: string) {
  const replayable = route.lifecycle !== "planned"
    && route.replay.geometryStatus === "ready"
    && route.replay.replayEligible;
  if (replayable) return { href: replayPath, label: "Open replay" };
  return { href: routeDetailPath(route.slug), label: "Route guide" };
}

function routeFacts(route: RouteSummary) {
  return `${route.distanceKm.toFixed(1)} km · ${route.elevationGainM.toLocaleString()} m up · ${route.type}`;
}

function guideStatus(route: RouteSummary) {
  const reviewed = route.guide.reviewStatus === "reviewed" || route.guide.reviewStatus === "published";
  return reviewed ? "Reviewed guide" : "Guide not yet reviewed";
}
