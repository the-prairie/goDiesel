import { Database, SlidersHorizontal, SearchX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CandidateRoute } from "@/surfaces/finder/components/candidate-route";
import { FinderForm } from "@/surfaces/finder/components/finder-form";
import { FinderRouteMap } from "@/surfaces/finder/components/finder-route-map";
import { Button } from "@/ui/button";
import { createCuratedRouteDiscoveryProvider } from "@/data/discovery-provider";
import { discoveredRoutes } from "@/data/routes";
import {
  mergeRouteSummaries,
  useOwnerRoutes,
} from "@/data/owner-route-repository";
import {
  savePlannedRoute,
  usePlannedRoutes,
} from "@/data/planned-route-store";
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
  const ownerRoutes = useOwnerRoutes();
  const discoveryProvider = useMemo(
    () =>
      createCuratedRouteDiscoveryProvider(
        mergeRouteSummaries(discoveredRoutes, ownerRoutes),
      ),
    [ownerRoutes],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const submittedIntent = useMemo(
    () => intentFromSearchParams(searchParams),
    [searchParams],
  );
  const [intent, setIntent] = useState(submittedIntent ?? initialIntent);
  const [filtersOpen, setFiltersOpen] = useState(!submittedIntent);
  const result = useMemo(
    () =>
      submittedIntent
        ? discoveryProvider.search(submittedIntent)
        : null,
    [discoveryProvider, submittedIntent],
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const plannedRoutes = usePlannedRoutes();
  const selectedCandidate = result?.candidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  ) ?? result?.candidates[0];
  const selectedDetail = useRouteDetail(selectedCandidate?.sourceRouteSlug);

  useEffect(() => {
    setIntent(submittedIntent ?? initialIntent);
  }, [submittedIntent]);

  useEffect(() => {
    if (!result || result.status !== "matches") {
      setSelectedCandidateId(undefined);
      return;
    }
    if (!result.candidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(result.candidates[0]?.id);
    }
  }, [result, selectedCandidateId]);

  function search() {
    setSearchParams(paramsForIntent(intent));
    setFiltersOpen(false);
  }

  function removeFilter(filter: "place" | "distance" | "terrain" | "vibe") {
    if (!submittedIntent) return;
    const next: FinderIntent = {
      ...submittedIntent,
      ...(filter === "place" ? { place: "" } : {}),
      ...(filter === "distance" ? { distanceKm: initialIntent.distanceKm } : {}),
      ...(filter === "terrain" ? { terrain: "any" as const } : {}),
      ...(filter === "vibe" ? { vibe: "" } : {}),
    };
    setIntent(next);
    setSearchParams(next.place ? paramsForIntent(next) : new URLSearchParams());
  }

  const mapRoute = selectedDetail.status === "ready" ? selectedDetail.route : undefined;

  return (
    <section className="flex h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 flex-col overflow-hidden bg-canvas md:h-dvh">
      <header className="z-20 border-b border-line bg-surface/97 px-4 py-3 shadow-sm sm:px-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <h1 className="font-editorial text-3xl font-semibold text-ink">Plan the next day.</h1>
          <p className="text-control text-ink-secondary">
            Choose what kind of run or ride you want.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-3 w-full lg:hidden"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" />
          {filtersOpen ? "Hide filters" : "Edit filters"}
        </Button>
        <div className={filtersOpen ? "block" : "hidden lg:block"}>
          <FinderForm intent={intent} onChange={setIntent} onSubmit={search} />
        </div>
        {submittedIntent ? (
          <ActiveFilterChips intent={submittedIntent} onRemove={removeFilter} />
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(14rem,0.9fr)_minmax(16rem,1.1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)] lg:grid-rows-1">
        <FinderRouteMap
          route={mapRoute}
          selectedSlug={selectedCandidate?.sourceRouteSlug}
        />
        <FinderResults
          result={result}
          submittedIntent={submittedIntent}
          selectedCandidate={selectedCandidate}
          plannedRoutes={plannedRoutes}
          onSelect={(candidate) => setSelectedCandidateId(candidate.id)}
        />
      </div>
    </section>
  );
}

function FinderResults({
  result,
  submittedIntent,
  selectedCandidate,
  plannedRoutes,
  onSelect,
}: {
  result: DiscoveryResult | null;
  submittedIntent: FinderIntent | null;
  selectedCandidate?: DiscoveryCandidate;
  plannedRoutes: ReturnType<typeof usePlannedRoutes>;
  onSelect: (candidate: DiscoveryCandidate) => void;
}) {
  return (
    <section
      aria-label="Finder results"
      className="min-h-0 overflow-y-auto border-t border-line bg-surface lg:border-l lg:border-t-0"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/96 px-4 py-3 backdrop-blur sm:px-5">
        <div>
          <h2 className="font-editorial text-2xl font-semibold text-ink">
            {result?.status === "matches"
              ? `${result.candidates.length} candidate ${result.candidates.length === 1 ? "route" : "routes"}`
              : "Candidate routes"}
          </h2>
          <p aria-live="polite" className="mt-0.5 text-caption text-ink-muted">
            {result?.message ?? "Based on your filters"}
          </p>
        </div>
        <Database className="mt-1 size-5 shrink-0 text-forest" aria-hidden="true" />
      </div>

      <div className="grid gap-3 p-3 sm:p-4">
        {result === null ? (
          <FinderState
            title="Set the kind of day you want"
            copy="Search the curated route shelf by place, effort, surface, and feeling."
          />
        ) : result.status === "unsupported" ? (
          <FinderState title="No curated match" copy={result.message} role="status" />
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

        <div className="flex gap-3 border-t border-line pt-4 text-caption leading-5 text-ink-muted">
          <Database className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" />
          <p>
            <strong className="font-semibold text-ink">Finder does not generate routes.</strong>{" "}
            Every result comes from an owner-curated or imported GPX record.
          </p>
        </div>
      </div>
    </section>
  );
}

function ActiveFilterChips({
  intent,
  onRemove,
}: {
  intent: FinderIntent;
  onRemove: (filter: "place" | "distance" | "terrain" | "vibe") => void;
}) {
  const chips = [
    { key: "place" as const, label: intent.place, aria: "Clear location filter" },
    {
      key: "distance" as const,
      label: `${intent.distanceKm} km`,
      aria: "Remove distance filter",
    },
    ...(intent.terrain !== "any"
      ? [{ key: "terrain" as const, label: intent.terrain, aria: "Remove terrain filter" }]
      : []),
    ...(intent.vibe
      ? [{ key: "vibe" as const, label: intent.vibe, aria: "Remove vibe filter" }]
      : []),
  ];

  return (
    <div aria-label="Active Finder filters" className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
      {chips.map((chip) => (
        <Button
          key={chip.key}
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 bg-surface-raised capitalize"
          aria-label={chip.aria}
          onClick={() => onRemove(chip.key)}
        >
          {chip.label}
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
    <div role={role} className="grid min-h-48 place-items-center border-y border-line p-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <SearchX className="size-6 text-forest" aria-hidden="true" />
        <h3 className="font-editorial text-xl font-semibold text-ink">{title}</h3>
        <p className="text-control leading-6 text-ink-secondary">{copy}</p>
      </div>
    </div>
  );
}

function matchReason(candidate: DiscoveryCandidate, intent: FinderIntent) {
  const parts = [
    intent.place,
    `${candidate.route.distanceKm.toFixed(1)} km near your ${intent.distanceKm} km target`,
    intent.terrain !== "any" ? `${intent.terrain} terrain` : "recorded terrain",
    intent.vibe ? `the ${intent.vibe} feeling` : candidate.vibes[0],
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

function intentFromSearchParams(params: URLSearchParams): FinderIntent | null {
  const place = params.get("place")?.trim() ?? "";
  if (!place) return null;
  const activity = params.get("activity") === "Ride" ? "Ride" : "Run";
  const distance = Number(params.get("distance"));
  const terrainValue = params.get("terrain");
  const terrain = ["road", "trail", "mixed", "mountain"].includes(
    terrainValue ?? "",
  )
    ? (terrainValue as FinderIntent["terrain"])
    : "any";
  return {
    place,
    activity,
    distanceKm: Number.isFinite(distance) && distance > 0 ? distance : 20,
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
  if (intent.terrain !== "any") params.set("terrain", intent.terrain);
  if (intent.vibe.trim()) params.set("vibe", intent.vibe.trim());
  return params;
}
