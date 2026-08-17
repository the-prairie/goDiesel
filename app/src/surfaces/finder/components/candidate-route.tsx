import { Check, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { APP_PATHS } from "@/app/route-paths";
import type { DiscoveryCandidate, PlannedRoute } from "@/domain/planning";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";

export function CandidateRoute({
  candidate,
  plannedRoute,
  selected = false,
  committed = false,
  matchReason,
  onSelect,
  onPreview,
  onSave,
}: {
  candidate: DiscoveryCandidate;
  plannedRoute?: PlannedRoute;
  selected?: boolean;
  committed?: boolean;
  matchReason?: string;
  onSelect?: () => void;
  onPreview?: (previewing: boolean) => void;
  onSave: () => boolean;
}) {
  const route = candidate.route;
  const [saveError, setSaveError] = useState(false);

  function save() {
    setSaveError(!onSave());
  }

  return (
    <article
      aria-label={`${route.region} candidate`}
      data-selected={selected}
      tabIndex={0}
      className={cn(
        "group grid w-[min(82vw,22rem)] shrink-0 gap-2 border bg-surface/96 p-3 shadow-panel backdrop-blur-md transition md:w-[21rem]",
        selected
          ? "border-route ring-1 ring-route"
          : "border-line hover:border-route/70 focus-visible:border-route focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
      onFocus={() => onPreview?.(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPreview?.(false);
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <MapPin className="size-3.5" aria-hidden="true" />
            {route.type} in {route.region}
          </div>
          <h2 className="mt-1 truncate font-editorial text-xl font-semibold text-ink">
            {route.name}
          </h2>
        </div>
        <span className="shrink-0 border border-line bg-surface-muted px-2 py-1 text-xs text-ink-secondary">
          recorded
        </span>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-line border-y border-line py-1.5 text-sm">
        <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
        <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
        <Metric label="Surface" value={candidate.terrain[0] ?? "recorded"} />
      </dl>

      {matchReason ? (
        <p className="hidden line-clamp-1 text-control leading-5 text-ink-secondary sm:block">
          <strong className="font-semibold text-ink">Why it matches:</strong> {matchReason}
        </p>
      ) : null}
      <p className="sr-only">{candidate.sourceLabel}</p>

      <div className="mt-auto flex items-center gap-2 border-t border-line pt-2">
        {onSelect ? (
          <Button
            type="button"
            variant={selected ? "secondary" : "outline"}
            size="sm"
            aria-label={`Choose ${route.region}`}
            onClick={onSelect}
          >
            <RouteIcon aria-hidden="true" />
            {committed ? "Selected" : "Choose route"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={Boolean(plannedRoute)}
          aria-label={plannedRoute ? "Already planned" : "Save planned route"}
          onClick={save}
        >
          {plannedRoute ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {plannedRoute ? "Planned" : "Plan it"}
        </Button>
        {plannedRoute ? (
          <>
            <span role="status" className="sr-only">Saved to Planned routes</span>
            <Button asChild variant="link" size="sm" className="ml-auto px-0">
              <Link to={`${APP_PATHS.routes}?lifecycle=planned`}>View plans</Link>
            </Button>
          </>
        ) : null}
      </div>
      {saveError ? (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-xs text-destructive">
          Plan could not be saved. Check browser storage and try again.
        </p>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 first:pl-0 last:pr-0">
      <dt className="text-[0.68rem] uppercase text-ink-muted">{label}</dt>
      <dd className="truncate font-semibold capitalize text-ink">{value}</dd>
    </div>
  );
}
