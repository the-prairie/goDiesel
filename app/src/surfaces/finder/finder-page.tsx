import { Database, SearchX, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { curatedRouteDiscoveryProvider } from "@/data/discovery-provider";
import { savePlannedRoute, usePlannedRoutes } from "@/data/planned-route-store";
import {
  finderIntentFromSearchParams,
  finderSearchParamsForIntent,
} from "@/domain/finder-intent-url";
import type {
  DiscoveryCandidate,
  DiscoveryResult,
  FinderIntent,
  PlannedRoute,
} from "@/domain/planning";
import { CandidateRoute } from "@/surfaces/finder/components/candidate-route";
import { FinderForm } from "@/surfaces/finder/components/finder-form";
import { FinderRouteMap } from "@/surfaces/finder/components/finder-route-map";
import { Button } from "@/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/ui/sheet";
import { useIsMobile } from "@/ui/use-mobile";

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
    () => finderIntentFromSearchParams(searchParams),
    [searchParams],
  );
  const [intent, setIntent] = useState(submittedIntent ?? initialIntent);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [previewedSlug, setPreviewedSlug] = useState<string>();
  const isMobile = useIsMobile();
  const plannedRoutes = usePlannedRoutes();
  const requestedSlug = searchParams.get("candidate") ?? undefined;
  const result = useMemo(
    () => {
      if (!submittedIntent) return null;
      const discovered = curatedRouteDiscoveryProvider.search(submittedIntent);
      const sourceAlreadyPresent = discovered.candidates.some(
        (candidate) => candidate.sourceRouteSlug === requestedSlug,
      );
      const savedPlan = requestedSlug && !sourceAlreadyPresent
        ? plannedRoutes.find((route) => route.planning.sourceRouteSlug === requestedSlug)
        : undefined;
      if (!savedPlan) return discovered;
      const restored = savedPlanAsCandidate(savedPlan);
      if (!restored) return discovered;
      return {
        status: "matches" as const,
        candidates: [...discovered.candidates, restored],
        message: "Saved planning source reopened from its durable route snapshot.",
      };
    },
    [plannedRoutes, requestedSlug, submittedIntent],
  );
  const candidates = result?.status === "matches" ? result.candidates : [];
  const selectedCandidate =
    candidates.find((candidate) => candidate.sourceRouteSlug === requestedSlug) ?? candidates[0];

  useEffect(() => {
    setIntent(submittedIntent ?? initialIntent);
  }, [submittedIntent]);

  function search() {
    setSearchParams(finderSearchParamsForIntent(intent));
    setFiltersOpen(false);
    setPreviewedSlug(undefined);
  }

  function openFilters(trigger: HTMLButtonElement) {
    filterReturnFocusRef.current = trigger;
    setFiltersOpen(true);
  }

  function selectCandidate(candidate: DiscoveryCandidate) {
    const next = new URLSearchParams(searchParams);
    next.set("candidate", candidate.sourceRouteSlug);
    setSearchParams(next);
    setPreviewedSlug(undefined);
  }

  function selectSlug(slug: string) {
    const candidate = candidates.find((item) => item.sourceRouteSlug === slug);
    if (candidate) selectCandidate(candidate);
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
    setSearchParams(next.place ? finderSearchParamsForIntent(next) : new URLSearchParams());
  }

  return (
    <section className="relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-[#102b33] md:h-dvh">
      <FinderRouteMap
        candidates={candidates}
        selectedSlug={selectedCandidate?.sourceRouteSlug}
        committedSlug={requestedSlug}
        previewedSlug={previewedSlug}
        onSelect={selectSlug}
        onPreview={setPreviewedSlug}
        showEmptyPrompt={!submittedIntent}
      />

      <header data-testid="finder-header" className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 md:inset-x-auto md:left-5 md:top-[5.75rem] md:w-[28rem] md:p-0 [@media(max-height:640px)]:left-3 [@media(max-height:640px)]:top-[5rem] [@media(max-height:640px)]:w-[min(30rem,calc(100%-1.5rem))]">
        <div className="pointer-events-auto border border-white/30 bg-[#07151c]/90 p-3 text-white shadow-panel backdrop-blur-xl md:p-5 [@media(max-height:640px)]:p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-0.5 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-[#9be7e1] md:mb-1 md:text-xs">
                <Sparkles className="size-3.5" aria-hidden="true" /> Daydream Finder
              </div>
              <h1 className="font-editorial text-[1.45rem] font-semibold text-white md:text-3xl">Plan the next day.</h1>
              <p className="mt-1 hidden text-control text-white/68 sm:block [@media(max-height:640px)]:hidden">
                Name the feeling. Finder brings the recorded possibilities into view.
              </p>
            </div>
          </div>

          {submittedIntent ? (
            <div className="mt-2 flex min-w-0 items-start gap-2 border-t border-white/15 pt-2 md:mt-3 md:items-center md:pt-3">
              <ActiveFilterChips intent={submittedIntent} onRemove={removeFilter} />
              <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-white hover:bg-white/12 hover:text-white" aria-label="Edit filters" title="Edit filters" onClick={(event) => openFilters(event.currentTarget)}>
                <SlidersHorizontal aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <Button type="button" className="mt-4 w-full" onClick={(event) => openFilters(event.currentTarget)}>
              <SlidersHorizontal aria-hidden="true" /> Shape the day
            </Button>
          )}
        </div>
      </header>

      <FinderResults
        result={result}
        submittedIntent={submittedIntent}
        selectedCandidate={selectedCandidate}
        plannedRoutes={plannedRoutes}
        onEditSearch={openFilters}
        onSelect={selectCandidate}
        onPreview={setPreviewedSlug}
      />

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          aria-label="Edit route plan"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            filterReturnFocusRef.current?.focus();
          }}
          className={isMobile
            ? "max-h-[88dvh] overflow-y-auto rounded-t-[22px] border-white/70 bg-surface p-0"
            : "w-[25rem] max-w-[25rem] overflow-y-auto border-white/70 bg-surface p-0"}
        >
          <SheetHeader className="border-b border-line px-5 pb-4 pt-5 text-left">
            <SheetTitle className="font-editorial text-2xl">Shape the next day</SheetTitle>
            <SheetDescription>Filter the recorded route shelf by place, effort, surface, and mood.</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
            <FinderForm intent={intent} onChange={setIntent} onSubmit={search} />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function FinderResults({
  result,
  submittedIntent,
  selectedCandidate,
  plannedRoutes,
  onEditSearch,
  onSelect,
  onPreview,
}: {
  result: DiscoveryResult | null;
  submittedIntent: FinderIntent | null;
  selectedCandidate?: DiscoveryCandidate;
  plannedRoutes: ReturnType<typeof usePlannedRoutes>;
  onEditSearch: (trigger: HTMLButtonElement) => void;
  onSelect: (candidate: DiscoveryCandidate) => void;
  onPreview: (slug?: string) => void;
}) {
  const [searchParams] = useSearchParams();
  return (
    <section
      aria-label="Finder results"
      data-testid="finder-results"
      className="absolute inset-x-0 bottom-0 z-20 border-t border-white/15 bg-[#07151c]/92 pb-2 pt-3 text-white shadow-[0_-8px_24px_rgba(3,12,18,0.32)] backdrop-blur-xl md:pb-4 md:pt-4"
    >
      <div className="mb-2 flex items-center justify-between gap-4 px-4 md:px-5">
        <div className="min-w-0">
          <h2 className="font-editorial text-lg font-semibold text-white md:text-xl">
            {result?.status === "matches"
              ? `${result.candidates.length} recorded ${result.candidates.length === 1 ? "possibility" : "possibilities"}`
              : "Recorded possibilities"}
          </h2>
          <p aria-live="polite" className="truncate text-xs text-white/58">
            {result?.message ?? "Search the curated shelf to reveal routes on the map."}
          </p>
        </div>
        <div className="hidden items-center gap-2 text-xs text-white/58 sm:flex">
          <Database className="size-4 text-[#9be7e1]" aria-hidden="true" />
          <span><strong className="font-semibold text-white">Finder does not generate routes.</strong> Recorded GPX only.</span>
        </div>
      </div>

      {result?.status === "matches" ? (
        <div className="flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:px-5">
          {result.candidates.map((candidate) => (
            <CandidateRoute
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedCandidate?.id}
              committed={candidate.sourceRouteSlug === searchParams.get("candidate")}
              matchReason={matchReason(candidate, submittedIntent!)}
              plannedRoute={plannedRoutes.find((route) => route.planning.candidateId === candidate.id)}
              onSelect={() => onSelect(candidate)}
              onPreview={(previewing) => onPreview(previewing ? candidate.sourceRouteSlug : undefined)}
              onSave={() => savePlannedRoute(candidate, submittedIntent!).persisted}
            />
          ))}
        </div>
      ) : (
        <FinderState
          title={result?.status === "unsupported" ? "No curated match" : "The map is waiting"}
          copy={result?.message ?? "Open the planner and describe the route you want to remember next."}
          action={result?.status === "unsupported"
            ? { label: "Edit search", onTrigger: onEditSearch }
            : undefined}
          role={result?.status === "unsupported" ? "status" : undefined}
        />
      )}
    </section>
  );
}

function ActiveFilterChips({ intent, onRemove }: { intent: FinderIntent; onRemove: (filter: "place" | "distance" | "terrain" | "vibe") => void }) {
  const chips = [
    { key: "place" as const, label: intent.place, aria: "Clear location filter" },
    { key: "distance" as const, label: `${intent.distanceKm} km`, aria: "Remove distance filter" },
    ...(intent.terrain !== "any" ? [{ key: "terrain" as const, label: intent.terrain, aria: "Remove terrain filter" }] : []),
    ...(intent.vibe ? [{ key: "vibe" as const, label: intent.vibe, aria: "Remove vibe filter" }] : []),
  ];
  return (
    <div aria-label="Active Finder filters" className="flex min-w-0 flex-1 flex-wrap gap-1.5 pr-1 sm:flex-nowrap sm:overflow-x-auto sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <Button key={chip.key} type="button" variant="outline" size="sm" className="h-8 shrink-0 border-white/25 bg-white/10 px-2 capitalize text-white hover:bg-white/18 hover:text-white" aria-label={chip.aria} onClick={() => onRemove(chip.key)}>
          {chip.label}<X aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}

function FinderState({
  title,
  copy,
  action,
  role,
}: {
  title: string;
  copy: string;
  action?: {
    label: string;
    onTrigger: (trigger: HTMLButtonElement) => void;
  };
  role?: "status";
}) {
  return (
    <div role={role} className="grid min-h-28 place-items-center px-6 py-4 text-center">
      <div className="grid max-w-md justify-items-center gap-2">
        <SearchX className="size-5 text-[#9be7e1]" aria-hidden="true" />
        <h3 className="font-editorial text-lg font-semibold text-white">{title}</h3>
        <p className="text-control text-white/66">{copy}</p>
        {action ? (
          <Button
            className="mt-1 min-h-11"
            onClick={(event) => action.onTrigger(event.currentTarget)}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" />
            {action.label}
          </Button>
        ) : null}
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

function savedPlanAsCandidate(plan: PlannedRoute): DiscoveryCandidate | undefined {
  const sourceSnapshot = plan.planning.sourceSnapshot;
  if (!sourceSnapshot) return undefined;
  const terrain: DiscoveryCandidate["terrain"] = plan.planning.intent.terrain === "any"
    ? []
    : [plan.planning.intent.terrain];
  return {
    id: plan.planning.candidateId,
    sourceRouteSlug: plan.planning.sourceRouteSlug,
    sourceLabel: plan.planning.sourceLabel,
    terrain,
    vibes: plan.planning.intent.vibe ? [plan.planning.intent.vibe] : [],
    route: sourceSnapshot,
  };
}
