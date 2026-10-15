import { ExternalDiscovery } from "./components/external-discovery";
import { interpretQuery, isExperienceQuery } from "@/domain/search/intent";
import { useCollectionSearch } from "@/data/search/use-collection-search";
import { List, Map as MapIcon, SearchX, X, Pencil, ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CandidateRoute } from "@/surfaces/finder/components/candidate-route";
import { FinderForm } from "@/surfaces/finder/components/finder-form";
import { FinderRouteMap } from "@/ui/planning-route-map";
import { routes } from "@/data/routes";
import { RouteThread } from "@/ui/route-card";
import { Button } from "@/ui/button";
import { curatedDiscoveryCandidates } from "@/data/discovery-provider";
import { savePlannedRoute, usePlannedRoutes } from "@/data/planned-route-store";
import { useRouteDetail } from "@/data/use-route-detail";
import type {
  DiscoveryCandidate,
  DiscoveryResult,
  FinderIntent,
} from "@/domain/planning";

const initialIntent: FinderIntent = {
  place: "",
  activity: "Run",
  distanceKm: 20,
  terrain: "any",
  vibe: "",
};

export function FinderPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const submittedIntent = useMemo(
    () => intentFromSearchParams(searchParams),
    [searchParams],
  );
  const [intent, setIntent] = useState(submittedIntent ?? initialIntent);
  const scope = searchParams.get("scope") === "new" ? "new" : "collection";
  function setScope(value: "collection" | "new") {
    const next = new URLSearchParams(searchParams);
    if (value === "new") next.set("scope", "new"); else next.delete("scope");
    setSearchParams(next, { replace: true });
  }
  function writeIntent(next: FinderIntent) {
    const params = paramsForIntent(next);
    if (scope === "new") params.set("scope", "new");
    const destination = searchParams.get("near");
    if (destination && next.place === submittedIntent?.place) params.set("near", destination);
    setSearchParams(params);
  }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const { result, mode } = useCollectionSearch(scope === "collection" ? submittedIntent : null);

  const plannedRoutes = usePlannedRoutes();
  const selectedCandidate =
    result?.candidates.find(
      (candidate) => candidate.sourceRouteSlug === searchParams.get("selected"),
    ) ?? result?.candidates[0];
  const selectedDetail = useRouteDetail(selectedCandidate?.sourceRouteSlug);

  useEffect(() => {
    setIntent(submittedIntent ?? initialIntent);
  }, [submittedIntent]);


  function search() {
    writeIntent(intent.query && intent.query !== submittedIntent?.query ? interpretQuery(intent.query, intent, routes.map(r => r.region)) : intent);
    setFiltersOpen(false);
    setView("list");
  }

  function removeFilter(filter: "place" | "terrain" | "vibe" | "query") {
    if (!submittedIntent) return;
    const next: FinderIntent = {
      ...submittedIntent,
      ...(filter === "place" ? { place: "", query: submittedIntent.query?.replace(new RegExp(submittedIntent.place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim() } : {}),
      ...(filter === "query" ? { query: "", similarPlace: undefined } : {}),
      ...(filter === "terrain" ? { terrain: "any" as const } : {}),
      ...(filter === "vibe" ? { vibe: "" } : {}),
    };
    setIntent(next);
    writeIntent(next);
  }

  const mapRoute =
    selectedDetail.status === "ready" ? selectedDetail.route : undefined;

  return (
    <section className="flex h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 flex-col overflow-hidden bg-canvas md:h-dvh">
      <header className="z-20 shrink-0 max-h-[65%] overflow-y-auto border-b border-line bg-surface/97 px-4 py-3 sm:px-5">
        <div className={submittedIntent ? "sr-only" : "mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1"}>
          <h1 className="font-editorial text-3xl font-semibold text-ink">
            Plan the next day.
          </h1>
          <p className="text-control text-ink-secondary">
            Find a run or ride worth making time for.
          </p>
        </div>
        <FinderForm
          intent={intent}
          submitted={Boolean(submittedIntent)}
          preferencesChanged={Boolean(submittedIntent && paramsForIntent(intent).toString() !== paramsForIntent(submittedIntent).toString())}
          onChange={setIntent}
          onSubmit={search}
          expanded={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
        />
        {submittedIntent ? (
          <ActiveFilterChips intent={submittedIntent} onRemove={removeFilter} onEditDistance={() => { setFiltersOpen(true); requestAnimationFrame(() => document.getElementById("finder-distance")?.focus()); }} />
        ) : null}
        <div role="group" aria-label="Search scope" className="mt-3 flex gap-2">
          <Button type="button" variant={scope === "collection" ? "secondary" : "ghost"} size="sm" aria-pressed={scope === "collection"} onClick={() => setScope("collection")}>My collection · {routes.length}</Button>
          <Button type="button" variant={scope === "new" ? "secondary" : "ghost"} size="sm" aria-pressed={scope === "new"} onClick={() => setScope("new")}>Discover new routes</Button>
        </div>
      </header>

      {scope === "new" ? <ExternalDiscovery key={JSON.stringify(submittedIntent)} intent={submittedIntent ?? intent} /> : !submittedIntent ? (
        <section aria-label="Choose a starting place" className="mx-auto min-h-0 w-full max-w-5xl overflow-y-auto px-4 py-8 sm:p-8">
          <h2 className="font-editorial text-2xl text-ink">Where would you like to go?</h2>
          <p className="mt-2 text-sm text-ink-secondary">Choose a place from your collection, or search above.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {["Kyoto", "Banff", "Victoria"].map((place) => {
              const records = routes.filter((route) => route.region.includes(place));
              const preview = curatedDiscoveryCandidates.filter(c => ["17654151284", "13358070690", "5650407638"].includes(c.sourceRouteSlug)).find((candidate) => candidate.route.region.includes(place))?.route ?? records[0];
              return (
                <button key={place} type="button" aria-label={place}
                  className="group grid grid-cols-[6rem_1fr] overflow-hidden rounded-[var(--radius-panel)] border border-line text-left transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-1"
                  onClick={() => { const next = { ...initialIntent, place, activity: preview?.type === "Ride" ? "Ride" as const : "Run" as const, distanceKm: preview ? Math.round(preview.distanceKm) : 20 }; setIntent(next); writeIntent(next); setFiltersOpen(false); }}>
                  {preview ? <RouteThread route={preview} className="h-24 border-b-0 border-r sm:h-36 sm:border-b sm:border-r-0" /> : null}
                  <span className="flex items-center gap-3 p-4">
                    <span className="flex-1"><span className="block text-lg text-ink">{place}</span><span className="mt-1 block text-xs text-ink-muted">{preview?.type} · around {preview ? Math.round(preview.distanceKm) : 20} km</span></span>
                    <ArrowUpRight className="size-4 text-ink-secondary" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {result?.status === "matches" ? <div role="group" aria-label="Results view" className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2 lg:hidden">
            <span aria-live="polite" className="text-sm text-ink-secondary">{result.candidates.length} routes</span>
            <div className="flex gap-1">
              <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => setView("list")}><List />List</Button>
              <Button size="sm" variant={view === "map" ? "secondary" : "ghost"} aria-pressed={view === "map"} onClick={() => setView("map")}><MapIcon />Map</Button>
            </div>
          </div> : null}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(22rem,0.9fr)_minmax(0,1.4fr)]">
            <div className={`${view === "list" || result?.status !== "matches" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
              <FinderResults limited={mode.includes("unavailable")} result={result} submittedIntent={submittedIntent} selectedCandidate={selectedCandidate}
                plannedRoutes={plannedRoutes} onSelect={(candidate) => { const params = new URLSearchParams(searchParams); params.set("selected", candidate.sourceRouteSlug); setSearchParams(params, {replace: true}); setView("map"); }} />
            </div>
            {result?.status === "matches" ? <div className={`${view === "map" ? "flex" : "hidden"} min-h-0 flex-col border-line lg:flex lg:border-l`}>
              <div aria-label="Selected map route" className="shrink-0 border-b border-line bg-surface px-4 py-3">
                <p className="text-xs text-ink-muted">Showing selected route</p>
                <p className="mt-1 text-sm font-medium">{selectedCandidate?.displayTitle ?? selectedCandidate?.route.region}</p>
                <p className="mt-1 text-xs text-ink-secondary">{selectedCandidate?.route.region} · {selectedCandidate?.route.distanceKm.toFixed(1)} km</p>
              </div>
              <div className="min-h-0 flex-1"><FinderRouteMap route={mapRoute} selectedSlug={selectedCandidate?.sourceRouteSlug} /></div>
            </div> : null}
          </div>
        </div>
      )}
    </section>
  );
}

function FinderResults({
  limited,
  result,
  submittedIntent,
  selectedCandidate,
  plannedRoutes,
  onSelect,
}: {
  limited: boolean;
  result: DiscoveryResult | null;
  submittedIntent: FinderIntent | null;
  selectedCandidate?: DiscoveryCandidate;
  plannedRoutes: ReturnType<typeof usePlannedRoutes>;
  onSelect: (candidate: DiscoveryCandidate) => void;
}) {
  return (
    <section
      aria-label="Finder results"
      className="min-h-0 flex-1 overflow-y-auto bg-surface"
    >
      <div className="hidden border-b border-line px-5 py-3 lg:block">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {result?.status === "matches"
              ? `${result.candidates.length} ${result.candidates.length === 1 ? "route" : "routes"} to explore`
              : "Where will you go next?"}
          </h2>
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:p-4">
        {limited ? <p role="status" className="text-xs text-ink-secondary">Search is limited to available route details right now.</p> : null}
        {result === null ? (
          <FinderState
            title="A new day, a familiar place"
            copy="Choose a place above to find recorded routes. Refine the distance and terrain when you need to."
          />
        ) : result.status === "unsupported" ? (
          <FinderState
            title="No matching routes"
            copy={result.message}
            role="status"
          />
        ) : (
          result.candidates.map((candidate) => (
            <CandidateRoute
              key={candidate.id}
              candidate={candidate}
              compact
              selected={candidate.id === selectedCandidate?.id}
              matchReason={matchReason(candidate, submittedIntent!)}
              plannedRoute={plannedRoutes.find(
                (route) => route.planning.candidateId === candidate.id,
              )}
              onSelect={() => onSelect(candidate)}
              onSave={() => savePlannedRoute(candidate, submittedIntent!).route}
            />
          ))
        )}

        <p className="border-t border-line pt-3 text-xs text-ink-muted">Routes from your collection. Save a route to plan a future outing.</p>
      </div>
    </section>
  );
}

function ActiveFilterChips({
  intent,
  onRemove,
  onEditDistance,
}: {
  intent: FinderIntent;
  onRemove: (filter: "place" | "terrain" | "vibe" | "query") => void;
  onEditDistance: () => void;
}) {
  const chips = [
    { key: "query" as const, label: intent.query && intent.query !== intent.place ? intent.query : "", aria: "Clear experience search" },
    {
      key: "place" as const,
      label: intent.place,
      aria: "Clear location filter",
    },
    ...(intent.terrain !== "any"
      ? [
          {
            key: "terrain" as const,
            label: intent.terrain,
            aria: "Remove terrain filter",
          },
        ]
      : []),
    ...(intent.vibe
      ? [
          {
            key: "vibe" as const,
            label: intent.vibe,
            aria: "Remove vibe filter",
          },
        ]
      : []),
  ];

  return (
    <div
      aria-label="Active Finder filters"
      className="mt-2 flex flex-wrap items-center gap-1"
    >

      <span className="px-2 text-sm text-ink-secondary">{intent.activity}</span>
      <Button type="button" variant="secondary" size="sm" aria-label="Edit distance target" onClick={onEditDistance}>{intent.minDistanceKm != null || intent.maxDistanceKm != null ? `${intent.minDistanceKm ?? 0}–${intent.maxDistanceKm ?? "∞"} km` : intent.distanceKm ? `Around ${intent.distanceKm} km` : "Any distance"} <Pencil aria-hidden="true" /></Button>
      {intent.maxElevationM != null ? <span className="text-sm text-ink-secondary">Up to {intent.maxElevationM} m climbing</span> : null}
      {chips.filter(chip => chip.label).map((chip) => (
        <Button
          key={chip.key}
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 bg-surface-raised capitalize"
          aria-label={chip.aria}
          onClick={() => onRemove(chip.key)}
        >
          <span className="max-w-48 truncate">{chip.label}</span>
          <X aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}

function FinderState({
  title,
  copy,
  role,
}: {
  title: string;
  copy: string;
  role?: "status";
}) {
  return (
    <div
      role={role}
      className="grid min-h-48 place-items-center border-y border-line p-6 text-center"
    >
      <div className="grid max-w-sm justify-items-center gap-3">
        <SearchX className="size-6 text-forest" aria-hidden="true" />
        <h3 className="font-editorial text-xl font-semibold text-ink">
          {title}
        </h3>
        <p className="text-control leading-6 text-ink-secondary">{copy}</p>
      </div>
    </div>
  );
}

function matchReason(candidate: DiscoveryCandidate, intent: FinderIntent) {
  if (candidate.matchEvidence) return candidate.matchEvidence;
  const parts = [
    `${candidate.route.distanceKm.toFixed(1)} km near your ${intent.distanceKm} km target`,
    intent.terrain !== "any" ? `${intent.terrain} terrain` : "",
    intent.vibe ? `the ${intent.vibe} feeling` : "",
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

function intentFromSearchParams(params: URLSearchParams): FinderIntent | null {
  const rawPlace = params.get("place")?.trim() ?? "";
  const place = rawPlace === params.get("q") && isExperienceQuery(rawPlace) ? "" : rawPlace;
  const query = params.get("q") ?? "";
  if (!place && !query && !params.has("activity")) return null;
  const activity = params.get("activity") === "Ride" ? "Ride" : "Run";
  const distance = Number(params.get("distance"));
  const terrainValue = params.get("terrain");
  const terrain = ["road", "trail", "mixed", "mountain"].includes(
    terrainValue ?? "",
  )
    ? (terrainValue as FinderIntent["terrain"])
    : "any";
  return {
    place, query: query || undefined,
    minDistanceKm: optionalNumber(params, "min"),
    maxDistanceKm: optionalNumber(params, "max"),
    maxElevationM: optionalNumber(params, "climb"),
    similarPlace: params.get("like") ?? undefined,
    activity,
    distanceKm: Number.isFinite(distance) && distance >= 0 ? distance : 20,
    terrain,
    vibe: params.get("vibe")?.trim() ?? "",
  };
}

function paramsForIntent(intent: FinderIntent) {
  const params = new URLSearchParams({
    place: intent.place.trim(),
    activity: intent.activity,
    distance: String(intent.distanceKm),
  });
  if (intent.query) params.set("q", intent.query);
  if (intent.minDistanceKm != null) params.set("min", String(intent.minDistanceKm));
  if (intent.maxDistanceKm != null) params.set("max", String(intent.maxDistanceKm));
  if (intent.maxElevationM != null) params.set("climb", String(intent.maxElevationM));
  if (intent.similarPlace) params.set("like", intent.similarPlace);
  if (intent.terrain !== "any") params.set("terrain", intent.terrain);
  if (intent.vibe.trim()) params.set("vibe", intent.vibe.trim());
  return params;
}

function optionalNumber(params: URLSearchParams, key: string) { const v = params.get(key); return v !== null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined; }
