import { Database, SearchX, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { curatedRouteDiscoveryProvider } from "@/data/discovery-provider";
import { savePlannedRoute, usePlannedRoutes } from "@/data/planned-route-store";
import type { DiscoveryCandidate, DiscoveryResult, FinderIntent } from "@/domain/planning";
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
  const submittedIntent = useMemo(() => intentFromSearchParams(searchParams), [searchParams]);
  const [intent, setIntent] = useState(submittedIntent ?? initialIntent);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const [previewedSlug, setPreviewedSlug] = useState<string>();
  const isMobile = useIsMobile();
  const result = useMemo(
    () => submittedIntent ? curatedRouteDiscoveryProvider.search(submittedIntent) : null,
    [submittedIntent],
  );
  const candidates = result?.status === "matches" ? result.candidates : [];
  const requestedSlug = searchParams.get("candidate") ?? undefined;
  const selectedCandidate =
    candidates.find((candidate) => candidate.sourceRouteSlug === requestedSlug) ?? candidates[0];
  const plannedRoutes = usePlannedRoutes();

  useEffect(() => {
    setIntent(submittedIntent ?? initialIntent);
  }, [submittedIntent]);

  function search() {
    setSearchParams(paramsForIntent(intent));
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
    setSearchParams(next.place ? paramsForIntent(next) : new URLSearchParams());
  }

  return (
    <section className="relative h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-[#cadfdc] md:h-dvh">
      <FinderRouteMap
        candidates={candidates}
        selectedSlug={selectedCandidate?.sourceRouteSlug}
        committedSlug={requestedSlug}
        previewedSlug={previewedSlug}
        onSelect={selectSlug}
        onPreview={setPreviewedSlug}
        showEmptyPrompt={!submittedIntent}
      />

      <header data-testid="finder-header" className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 md:right-auto md:w-[25rem] md:p-5 [@media(max-height:640px)]:w-[min(36rem,calc(100%-1.5rem))] [@media(max-height:640px)]:p-3">
        <div className="pointer-events-auto border border-white/65 bg-surface/90 p-3 shadow-panel backdrop-blur-xl md:p-5 [@media(max-height:640px)]:p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-0.5 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-primary md:mb-1 md:text-xs">
                <Sparkles className="size-3.5" aria-hidden="true" /> Daydream Finder
              </div>
              <h1 className="font-editorial text-[1.45rem] font-semibold text-ink md:text-3xl">Plan the next day.</h1>
              <p className="mt-1 hidden text-control text-ink-secondary sm:block [@media(max-height:640px)]:hidden">
                Name the feeling. Finder brings the recorded possibilities into view.
              </p>
            </div>
          </div>

          {submittedIntent ? (
            <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-line/80 pt-2 md:mt-3 md:gap-3 md:pt-3">
              <ActiveFilterChips intent={submittedIntent} onRemove={removeFilter} />
              <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 md:px-3" aria-label="Edit filters" onClick={(event) => openFilters(event.currentTarget)}>
                <SlidersHorizontal aria-hidden="true" /> <span className="hidden md:inline [@media(max-height:640px)]:hidden">Edit filters</span>
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
            ? "max-h-[88dvh] overflow-y-auto rounded-t-2xl border-white/70 bg-surface p-0"
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
      className="absolute inset-x-0 bottom-0 z-20 border-t border-white/50 bg-[#dce7ed]/88 pb-2 pt-3 shadow-[0_-14px_40px_rgba(20,39,68,0.18)] backdrop-blur-xl md:pb-4 md:pt-4"
    >
      <div className="mb-2 flex items-center justify-between gap-4 px-4 md:px-5">
        <div className="min-w-0">
          <h2 className="font-editorial text-lg font-semibold text-ink md:text-xl">
            {result?.status === "matches"
              ? `${result.candidates.length} recorded ${result.candidates.length === 1 ? "possibility" : "possibilities"}`
              : "Recorded possibilities"}
          </h2>
          <p aria-live="polite" className="truncate text-xs text-ink-muted">
            {result?.message ?? "Search the curated shelf to reveal routes on the map."}
          </p>
        </div>
        <div className="hidden items-center gap-2 text-xs text-ink-muted sm:flex">
          <Database className="size-4 text-primary" aria-hidden="true" />
          <span><strong className="font-semibold text-ink">Finder does not generate routes.</strong> Recorded GPX only.</span>
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
              onSave={() => savePlannedRoute(candidate, submittedIntent!).route}
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
    <div aria-label="Active Finder filters" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <Button key={chip.key} type="button" variant="outline" size="sm" className="h-8 shrink-0 bg-surface/80 px-2 capitalize" aria-label={chip.aria} onClick={() => onRemove(chip.key)}>
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
        <SearchX className="size-5 text-primary" aria-hidden="true" />
        <h3 className="font-editorial text-lg font-semibold text-ink">{title}</h3>
        <p className="text-control text-ink-secondary">{copy}</p>
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

function intentFromSearchParams(params: URLSearchParams): FinderIntent | null {
  const place = params.get("place")?.trim() ?? "";
  if (!place) return null;
  const activity = params.get("activity") === "Ride" ? "Ride" : "Run";
  const distance = Number(params.get("distance"));
  const terrainValue = params.get("terrain");
  const terrain = ["road", "trail", "mixed", "mountain"].includes(terrainValue ?? "") ? terrainValue as FinderIntent["terrain"] : "any";
  return { place, activity, distanceKm: Number.isFinite(distance) && distance > 0 ? distance : 20, terrain, vibe: params.get("vibe")?.trim() ?? "" };
}

function paramsForIntent(intent: FinderIntent) {
  const params = new URLSearchParams({ place: intent.place.trim(), activity: intent.activity, distance: String(intent.distanceKm) });
  if (intent.terrain !== "any") params.set("terrain", intent.terrain);
  if (intent.vibe.trim()) params.set("vibe", intent.vibe.trim());
  return params;
}
