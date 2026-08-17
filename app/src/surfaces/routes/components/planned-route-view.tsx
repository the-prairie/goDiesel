import {
  ArrowLeft,
  Bookmark,
  CalendarClock,
  CheckCircle2,
  Map,
  Pencil,
  ScanSearch,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { APP_PATHS, routeDetailPath } from "@/app/route-paths";
import { curatedDiscoveryCandidates } from "@/data/discovery-provider";
import {
  removePlannedRoute,
  updatePlannedRouteIntent,
} from "@/data/planned-route-store";
import { completedRoutes } from "@/data/routes";
import { finderSearchParamsForIntent } from "@/domain/finder-intent-url";
import {
  findRecordedPlanMatches,
  type RecordedPlanMatch,
} from "@/domain/plan-completion";
import type { FinderIntent, PlannedRoute } from "@/domain/planning";
import { formatRouteDate } from "@/domain/route";
import { PlannedRoutePreview } from "@/surfaces/routes/components/planned-route-preview";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { RouteThread } from "@/ui/route-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/sheet";
import { useIsMobile } from "@/ui/use-mobile";

const plannedRoutesPath = `${APP_PATHS.routes}?lifecycle=planned`;

export function PlannedRouteView({ route }: { route: PlannedRoute }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [editOpen, setEditOpen] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [comparison, setComparison] = useState<RecordedPlanMatch>();
  const [intent, setIntent] = useState(route.planning.intent);
  const [sourceSlug, setSourceSlug] = useState(route.planning.sourceRouteSlug);
  const [mutationError, setMutationError] = useState<string>();
  const removeConfirmRef = useRef<HTMLButtonElement>(null);
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const wasRemovePending = useRef(false);
  const matches = useMemo(
    () => findRecordedPlanMatches(route, completedRoutes),
    [route],
  );
  const finderPath = finderPathForPlan(route);

  useEffect(() => {
    if (removePending) {
      removeConfirmRef.current?.focus();
    } else if (wasRemovePending.current) {
      removeTriggerRef.current?.focus();
    }
    wasRemovePending.current = removePending;
  }, [removePending]);

  function saveIntent() {
    const source = curatedDiscoveryCandidates.find(
      (candidate) => candidate.sourceRouteSlug === sourceSlug,
    );
    const updated = updatePlannedRouteIntent(route.slug, intent, source);
    if (!updated) {
      setMutationError("Plan changes could not be saved. Check browser storage and try again.");
      return;
    }
    setMutationError(undefined);
    setEditOpen(false);
    if (updated.slug !== route.slug) {
      navigate(routeDetailPath(updated.slug), { replace: true });
    }
  }

  function removePlan() {
    if (!removePlannedRoute(route.slug)) {
      setMutationError("Plan could not be removed. Check browser storage and try again.");
      return;
    }
    navigate(plannedRoutesPath, { replace: true });
  }

  function confirmCompletion(match: RecordedPlanMatch) {
    if (!removePlannedRoute(route.slug)) {
      setMutationError("Completion could not be confirmed because the plan was not removed from storage.");
      return;
    }
    navigate(routeDetailPath(match.route.slug), { replace: true });
  }

  return (
    <section className="h-[calc(100dvh-var(--mobile-navigation-height))] overflow-y-auto bg-surface-muted md:h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/92 px-4 py-3 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Button asChild variant="ghost" className="-ml-3 w-fit">
            <Link to={plannedRoutesPath}>
              <ArrowLeft aria-hidden="true" />
              Planned routes
            </Link>
          </Button>
          <span className="inline-flex items-center gap-2 border border-warning/40 bg-warning/10 px-2.5 py-1 text-micro font-semibold uppercase text-ink-secondary">
            <CalendarClock className="size-4 text-warning" aria-hidden="true" />
            Planning intent
          </span>
        </div>
      </header>

      <main>
        <section className="border-b border-line bg-surface">
          <div className="mx-auto grid max-w-7xl lg:grid-cols-[minmax(24rem,0.9fr)_minmax(0,1.1fr)]">
            <div className="order-2 flex min-w-0 flex-col justify-center px-5 py-10 md:px-8 md:py-14 lg:order-1 lg:px-12">
              <p className="text-micro font-semibold uppercase text-coral">
                {route.planning.intent.activity} in {route.planning.intent.place || route.region}
              </p>
              <h1 className="mt-3 text-balance font-editorial text-5xl font-semibold leading-none text-ink md:text-6xl">
                {route.planning.intent.place || route.name}
              </h1>
              <p className="mt-4 max-w-xl text-lg text-ink-secondary">
                This is a plan, not a recorded activity.
              </p>
              <p className="mt-2 max-w-xl text-control leading-6 text-ink-muted">
                It keeps this future route in Planned routes and watches later imports for a
                close recorded match. Nothing enters Memories until you compare and confirm it.
              </p>

              <div className="mt-7 border-y border-line py-5">
                <h2 className="font-editorial text-2xl font-semibold text-ink">What this plan does</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <PlanPurpose
                    icon={Bookmark}
                    title="Keeps the intention"
                    copy="Saves the route, target effort, terrain, and feeling in Planned routes."
                  />
                  <PlanPurpose
                    icon={ScanSearch}
                    title="Watches future imports"
                    copy="Compares later recorded activities against this source line and target."
                  />
                  <PlanPurpose
                    icon={ShieldCheck}
                    title="Waits for you"
                    copy="Never creates a memory or removes the plan without your confirmation."
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Button type="button" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden="true" />
                  Edit plan
                </Button>
                <Button asChild variant="outline">
                  <Link to={finderPath}>
                    <Map aria-hidden="true" />
                    Reopen source in Finder
                  </Link>
                </Button>
              </div>

              <dl className="mt-8 grid grid-cols-2 border-y border-line sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <PlanFact label="Target">{route.planning.intent.distanceKm.toFixed(1)} km</PlanFact>
                <PlanFact label="Terrain">{terrainLabel(route.planning.intent.terrain)}</PlanFact>
                <PlanFact label="Activity">{route.planning.intent.activity}</PlanFact>
                <PlanFact label="Saved">{formatPlanDate(route.date)}</PlanFact>
              </dl>

              {route.planning.intent.vibe ? (
                <div className="mt-5 bg-surface-muted p-4">
                  <p className="text-micro font-semibold uppercase text-ink-muted">Desired feeling</p>
                  <p className="mt-1 font-editorial text-xl text-ink">{route.planning.intent.vibe}</p>
                </div>
              ) : null}
            </div>

            <div className="order-1 min-h-72 border-b border-line lg:order-2 lg:min-h-[40rem] lg:border-b-0 lg:border-l">
              <PlannedRoutePreview route={route} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-14">
          <div className="grid gap-8 lg:grid-cols-[minmax(16rem,0.55fr)_minmax(0,1.45fr)]">
            <div>
              <p className="text-micro font-semibold uppercase text-coral">Completion check</p>
              <h2 className="mt-2 font-editorial text-4xl font-semibold leading-tight text-ink">
                Has this day been recorded?
              </h2>
              <p className="mt-3 max-w-md text-control leading-6 text-ink-secondary">
                goDiesel checks later recorded activities against the plan's place, activity,
                distance, and route geometry. A match is a derived suggestion until you confirm it.
              </p>
            </div>

            {matches.length ? (
              <div className="grid gap-3" aria-label="Potential recorded matches">
                {matches.map((match) => (
                  <RecordedMatch
                    key={match.route.slug}
                    match={match}
                    onCompare={() => setComparison(match)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-56 place-items-center border-y border-line py-10 text-center">
                <div className="max-w-md">
                  <Search className="mx-auto size-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 font-editorial text-2xl font-semibold text-ink">
                    No later recorded activity matches this plan yet.
                  </h3>
                  <p className="mt-2 text-control leading-6 text-ink-secondary">
                    Keep the plan open. When a new recorded activity is imported, this page will
                    compare it without inventing a completion.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <div>
              <p className="text-control font-semibold text-ink">No longer planning this route?</p>
              <p className="text-caption text-ink-muted">Removing a plan does not change recorded routes.</p>
            </div>
            {removePending ? (
              <div role="group" aria-label="Confirm plan removal" className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setRemovePending(false)}>
                  Keep plan
                </Button>
                  <Button
                    ref={removeConfirmRef}
                    type="button"
                    variant="destructive"
                    onClick={removePlan}
                  >
                  <Trash2 aria-hidden="true" />
                  Remove planned route
                </Button>
              </div>
            ) : (
              <Button
                ref={removeTriggerRef}
                type="button"
                variant="outline"
                onClick={() => setRemovePending(true)}
              >
                <Trash2 aria-hidden="true" />
                Remove plan
              </Button>
            )}
          </div>
          {mutationError ? (
            <p role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-control text-destructive">
              {mutationError}
            </p>
          ) : null}
        </section>
      </main>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          aria-label="Edit planned route"
          className={isMobile
            ? "max-h-[88dvh] overflow-y-auto border-white/70 bg-surface p-0"
            : "w-[26rem] max-w-[26rem] overflow-y-auto border-white/70 bg-surface p-0"}
        >
          <SheetHeader className="border-b border-line px-5 pb-4 pt-5 text-left">
            <SheetTitle className="font-editorial text-2xl">Edit planned route</SheetTitle>
            <SheetDescription>
              Change what Finder should watch for when later recorded activities arrive.
            </SheetDescription>
          </SheetHeader>
          <PlanIntentEditor
            intent={intent}
            onChange={setIntent}
            onSubmit={saveIntent}
            error={mutationError}
            sourceSlug={sourceSlug}
            onSourceChange={(nextSourceSlug) => {
              const source = curatedDiscoveryCandidates.find(
                (candidate) => candidate.sourceRouteSlug === nextSourceSlug,
              );
              if (!source) return;
              setSourceSlug(nextSourceSlug);
              setIntent((current) => ({
                ...current,
                place: source.route.region,
                activity: source.route.type === "Ride" ? "Ride" : "Run",
                terrain: source.terrain[0] ?? "any",
              }));
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(comparison)} onOpenChange={(open) => !open && setComparison(undefined)}>
        {comparison ? (
          <SheetContent
            side={isMobile ? "bottom" : "right"}
            aria-label="Compare plan with recorded activity"
            className={isMobile
              ? "max-h-[92dvh] overflow-y-auto border-white/70 bg-surface p-0"
              : "w-[32rem] max-w-[32rem] overflow-y-auto border-white/70 bg-surface p-0"}
          >
            <SheetHeader className="border-b border-line px-5 pb-4 pt-5 text-left">
              <SheetTitle className="font-editorial text-2xl">Compare plan with recorded activity</SheetTitle>
              <SheetDescription>
                Confirm only when this recorded activity is the day this plan became real.
              </SheetDescription>
            </SheetHeader>
            <PlanComparison plan={route} match={comparison} />
            {mutationError ? (
              <p role="alert" className="mx-5 mb-4 border-l-2 border-destructive pl-3 text-control text-destructive">
                {mutationError}
              </p>
            ) : null}
            <div className="sticky bottom-0 border-t border-line bg-surface px-5 py-4">
              <Button
                type="button"
                className="w-full"
                onClick={() => confirmCompletion(comparison)}
              >
                <CheckCircle2 aria-hidden="true" />
                Confirm recorded completion
              </Button>
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
    </section>
  );
}

function RecordedMatch({
  match,
  onCompare,
}: {
  match: RecordedPlanMatch;
  onCompare: () => void;
}) {
  const route = match.route;
  return (
    <article
      aria-label={`Recorded completion candidate ${route.activityName || route.name}`}
      className="grid gap-4 border border-line bg-surface p-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center"
    >
      <RouteThread route={route} className="h-28 border" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-line bg-surface-muted px-2 py-1 text-micro font-semibold uppercase text-ink-secondary">
            Recorded activity
          </span>
          <span className="border border-coral/40 bg-coral/10 px-2 py-1 text-micro font-semibold uppercase text-coral">
            Derived match
          </span>
        </div>
        <h3 className="mt-2 line-clamp-2 font-editorial text-2xl font-semibold text-ink">
          {route.activityName || route.name}
        </h3>
        <p className="mt-1 text-caption text-ink-secondary">
          {formatRouteDate(route.date)} · {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up
        </p>
        <p className="mt-2 text-caption text-ink-muted">
          At least {Math.round(match.overlapRatio * 100)}% of sampled points align within 1.5 km in both route directions.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onCompare}>
        Compare recorded activity
      </Button>
    </article>
  );
}

function PlanComparison({
  plan,
  match,
}: {
  plan: PlannedRoute;
  match: RecordedPlanMatch;
}) {
  return (
    <div className="grid gap-6 px-5 py-5">
      <div className="grid grid-cols-2 border-y border-line">
        <ComparisonColumn
          label="Planning target"
          distance={`${plan.planning.intent.distanceKm.toFixed(1)} km`}
          activity={plan.planning.intent.activity}
          date={formatRouteDate(plan.date)}
        />
        <ComparisonColumn
          label="Recorded activity"
          distance={`${match.route.distanceKm.toFixed(1)} km`}
          activity={match.route.type}
          date={formatRouteDate(match.route.date)}
        />
      </div>

      <div>
        <p className="text-micro font-semibold uppercase text-coral">Derived geometry comparison</p>
        <p className="mt-2 text-control leading-6 text-ink-secondary">
          At least {Math.round(match.overlapRatio * 100)}% of sampled points align within 1.5 km
          in both route directions. Distance differs by {match.distanceDeltaKm.toFixed(1)} km.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-2 text-micro font-semibold uppercase text-ink-muted">Planning source</p>
          <RouteThread route={plan} className="h-32 border" />
        </div>
        <div>
          <p className="mb-2 text-micro font-semibold uppercase text-ink-muted">Recorded trace</p>
          <RouteThread route={match.route} className="h-32 border" />
        </div>
      </div>
    </div>
  );
}

function ComparisonColumn({
  label,
  distance,
  activity,
  date,
}: {
  label: string;
  distance: string;
  activity: string;
  date: string;
}) {
  return (
    <div className="border-r border-line px-3 py-4 last:border-r-0">
      <p className="text-micro font-semibold uppercase text-ink-muted">{label}</p>
      <p className="mt-2 font-editorial text-2xl font-semibold text-ink">{distance}</p>
      <p className="mt-1 text-caption text-ink-secondary">{activity}</p>
      <p className="mt-1 text-caption text-ink-muted">{date}</p>
    </div>
  );
}

function PlanIntentEditor({
  intent,
  onChange,
  onSubmit,
  error,
  sourceSlug,
  onSourceChange,
}: {
  intent: FinderIntent;
  onChange: (intent: FinderIntent) => void;
  onSubmit: () => void;
  error?: string;
  sourceSlug: string;
  onSourceChange: (sourceSlug: string) => void;
}) {
  return (
    <form
      className="grid gap-4 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="bg-forest-soft p-4 text-control leading-6 text-forest">
        <p className="font-semibold">Changes update what Finder watches for.</p>
        <p className="mt-1 text-caption leading-5">
          Distance, terrain, and feeling change the matching rules. Choosing another recorded
          source replaces the planning line and restarts the completion clock from today.
        </p>
      </div>
      <label className="grid gap-1.5 text-control font-medium">
        Recorded route used as the planning line
        <select
          aria-label="Planning source"
          value={sourceSlug}
          className="h-11 min-w-0 border border-input bg-surface-raised px-3 text-control text-ink outline-none hover:border-forest/50 focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => onSourceChange(event.target.value)}
        >
          {!curatedDiscoveryCandidates.some((candidate) => candidate.sourceRouteSlug === sourceSlug) ? (
            <option value={sourceSlug}>{intent.activity} in {intent.place} - saved source</option>
          ) : null}
          {curatedDiscoveryCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.sourceRouteSlug}>
              {candidate.route.type} in {candidate.route.region} - {candidate.route.distanceKm.toFixed(1)} km
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-control font-medium">
          Place
          <Input aria-label="Place" readOnly value={intent.place} />
        </label>
        <label className="grid gap-1.5 text-control font-medium">
          Activity
          <Input aria-label="Activity" readOnly value={intent.activity} />
        </label>
      </div>
      <p className="-mt-2 text-caption leading-5 text-ink-muted">
        Place and activity come from the selected recorded source. Choose another source to
        change them.
      </p>
      <label className="grid gap-1.5 text-control font-medium">
        <span className="flex justify-between gap-2">Distance <span className="text-xs text-ink-muted">km</span></span>
        <Input
          aria-label="Distance"
          required
          type="number"
          min="1"
          max="500"
          step="0.5"
          value={intent.distanceKm || ""}
          onChange={(event) => onChange({ ...intent, distanceKm: Number(event.target.value) })}
        />
      </label>
      <label className="grid gap-1.5 text-control font-medium">
        Terrain
        <select
          aria-label="Terrain"
          value={intent.terrain}
          className="h-11 min-w-0 border border-input bg-surface-raised px-3 text-control text-ink outline-none hover:border-forest/50 focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => onChange({ ...intent, terrain: event.target.value as FinderIntent["terrain"] })}
        >
          <option value="any">Any terrain</option>
          <option value="road">Road</option>
          <option value="trail">Trail</option>
          <option value="mixed">Mixed</option>
          <option value="mountain">Mountain</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-control font-medium">
        Desired feeling
        <Input
          aria-label="Vibe"
          value={intent.vibe}
          onChange={(event) => onChange({ ...intent, vibe: event.target.value })}
        />
      </label>
      {error ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-control text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" aria-label="Save plan changes" className="mt-2 w-full">
        Update plan and matching rules
      </Button>
    </form>
  );
}

function PlanPurpose({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Bookmark;
  title: string;
  copy: string;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <span className="row-span-2 grid size-9 place-items-center bg-forest-soft text-forest">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h3 className="text-caption font-semibold text-ink">{title}</h3>
      <p className="text-caption leading-5 text-ink-secondary">{copy}</p>
    </div>
  );
}

function PlanFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-r border-line px-3 py-4 last:border-r-0 odd:border-b sm:odd:border-b-0 lg:odd:border-b xl:odd:border-b-0">
      <dt className="text-micro font-semibold uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 truncate text-caption font-semibold capitalize text-ink">{children}</dd>
    </div>
  );
}

function finderPathForPlan(route: PlannedRoute) {
  const source = curatedDiscoveryCandidates.find(
    (candidate) => candidate.sourceRouteSlug === route.planning.sourceRouteSlug,
  );
  const sourceRoute = source?.route ?? route.planning.sourceSnapshot ?? route;
  const sourceIntent: FinderIntent = source ? {
    place: source.route.region,
    activity: source.route.type === "Ride" ? "Ride" : "Run",
    distanceKm: source.route.distanceKm,
    terrain: source.terrain[0] ?? "any",
    vibe: "",
  } : {
    place: sourceRoute.region,
    activity: sourceRoute.type === "Ride" ? "Ride" : "Run",
    distanceKm: sourceRoute.distanceKm,
    terrain: "any",
    vibe: "",
  };
  const params = finderSearchParamsForIntent(
    sourceIntent,
    route.planning.sourceRouteSlug,
  );
  return `${APP_PATHS.finder}?${params}`;
}

function terrainLabel(value: FinderIntent["terrain"]) {
  return value === "any" ? "Any terrain" : value;
}

function formatPlanDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
