import { Check, Eye, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { RouteThread } from "@/ui/route-card";
import { Button } from "@/ui/button";
import type { DiscoveryCandidate, PlannedRoute } from "@/domain/planning";
import { cn } from "@/ui/utils";
import { APP_PATHS } from "@/app/route-paths";

export function CandidateRoute({
  candidate,
  plannedRoute,
  compact = false,
  selected = false,
  matchReason,
  onSelect,
  onSave,
}: {
  candidate: DiscoveryCandidate;
  plannedRoute?: PlannedRoute;
  compact?: boolean;
  selected?: boolean;
  matchReason?: string;
  onSelect?: () => void;
  onSave: () => PlannedRoute;
}) {
  const route = candidate.route;

  return (
    <article
      aria-label={`${route.region} candidate`}
      data-selected={selected}
      className={cn(
        "grid min-w-0 overflow-hidden border border-line bg-surface",
        selected && "border-route ring-1 ring-route",
        compact
          ? "grid-cols-1"
          : "sm:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]",
      )}
    >
      <RouteThread
        route={route}
        className={cn(
          "border-line",
          compact
            ? "h-32 border-b"
            : "h-48 border-b sm:h-full sm:min-h-72 sm:border-b-0 sm:border-r",
        )}
      />
      <div className={cn("grid content-start", compact ? "gap-3 p-4" : "gap-5 p-5")}>
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <MapPin className="size-3.5" aria-hidden="true" />
            {candidate.sourceLabel}
          </div>
          <div>
            <h2 className="font-editorial text-xl font-semibold">{route.region}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{route.activityName}</p>
          </div>
        </div>

        <dl className={cn("grid grid-cols-3 gap-px overflow-hidden border border-line bg-line text-sm", compact && "hidden sm:grid")}>
          <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <Metric label="Activity" value={route.type} />
        </dl>

        <div className={cn("grid gap-2 text-sm", compact && "text-control")}>
          <p className="leading-6 text-muted-foreground">
            {route.guide.vibe ?? route.subtitle ?? route.description}
          </p>
          {matchReason ? (
            <p className="border-l-2 border-l-route pl-3 text-control leading-5 text-ink-secondary">
              <strong className="font-semibold text-ink">Why it matches:</strong>{" "}
              {matchReason}
            </p>
          ) : null}
          <div className={cn("flex flex-wrap gap-2 text-xs text-muted-foreground", compact && "hidden sm:flex")}>
            {candidate.terrain.map((terrain) => (
              <span key={terrain} className="rounded-sm border border-border px-2 py-1">
                {terrain}
              </span>
            ))}
            {candidate.vibes.slice(0, 3).map((vibe) => (
              <span key={vibe} className="rounded-sm border border-border px-2 py-1">
                {vibe}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {onSelect ? (
            <Button
              type="button"
              variant={selected ? "secondary" : "outline"}
              size="sm"
              aria-label={`Preview ${route.region} on map`}
              onClick={onSelect}
            >
              <Eye aria-hidden="true" />
              {selected ? "On map" : "Preview"}
            </Button>
          ) : null}
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            disabled={Boolean(plannedRoute)}
            aria-label={plannedRoute ? "Already planned" : "Save planned route"}
            onClick={onSave}
          >
            {plannedRoute ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {plannedRoute ? "Already planned" : "Save as planned"}
          </Button>
          {plannedRoute ? (
            <>
              <span role="status" className="text-sm text-primary">
                Saved to Planned routes
              </span>
              <Button asChild variant="link" className="px-0">
                <Link to={`${APP_PATHS.routes}?lifecycle=planned`}>
                  <RouteIcon aria-hidden="true" />
                  View plans
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 bg-surface p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
