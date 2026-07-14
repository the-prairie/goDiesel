import { Check, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { RouteThread } from "@/components/routes/route-card";
import { Button } from "@/components/ui/button";
import type { DiscoveryCandidate, PlannedRoute } from "@/domain/planning";
import { APP_PATHS } from "@/navigation";

export function CandidateRoute({
  candidate,
  plannedRoute,
  onSave,
}: {
  candidate: DiscoveryCandidate;
  plannedRoute?: PlannedRoute;
  onSave: () => PlannedRoute;
}) {
  const route = candidate.route;

  return (
    <article
      aria-label={`${route.region} candidate`}
      className="grid min-w-0 overflow-hidden rounded-md border border-border bg-card sm:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]"
    >
      <RouteThread route={route} className="h-48 border-b sm:h-full sm:min-h-72 sm:border-b-0 sm:border-r" />
      <div className="grid content-start gap-5 p-5">
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <MapPin className="size-3.5" aria-hidden="true" />
            {candidate.sourceLabel}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{route.region}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{route.activityName}</p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border text-sm">
          <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <Metric label="Activity" value={route.type} />
        </dl>

        <div className="grid gap-2 text-sm">
          <p className="leading-6 text-muted-foreground">
            {route.guide.vibe ?? route.subtitle ?? route.description}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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

        <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            type="button"
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
    <div className="grid gap-1 bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
