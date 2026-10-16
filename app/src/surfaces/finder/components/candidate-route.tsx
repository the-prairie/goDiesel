import { useState } from "react";
import { RouteCover } from "@/ui/route-cover";
import { Check, Eye, MapPin, Plus, Route as RouteIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { RouteThread } from "@/ui/route-card";
import { Button } from "@/ui/button";
import type { DiscoveryCandidate, PlannedRoute } from "@/domain/planning";
import { cn } from "@/ui/utils";
import { APP_PATHS, routeDetailPath } from "@/app/route-paths";

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
  const [saveError, setSaveError] = useState("");
  const location = useLocation();
  const route = candidate.route;
  const guidePath = `${routeDetailPath(route.slug)}?from=${encodeURIComponent(location.pathname + location.search)}`;
  const description = route.guide.vibe ?? route.subtitle ?? route.description;

  if (compact) return (
    <article aria-label={`${route.region} candidate`} data-selected={selected} className={cn("min-w-0 rounded-xl border border-line bg-surface p-4", selected && "border-white/40 bg-white/[0.03]")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-muted">{route.region}</p>
          <h3 className="mt-1 text-base font-medium leading-snug">{candidate.displayTitle ?? `${route.distanceKm.toFixed(1)} km ${route.type.toLowerCase()} in ${route.region.split(",")[0]}`}</h3>
          <p className="mt-2 text-sm text-ink-secondary">{route.distanceKm.toFixed(1)} km <span className="px-1 text-ink-muted">·</span> {route.elevationGainM.toLocaleString()} m up</p>
        </div>
        <div aria-hidden="true" className="finder-result-cover size-20 shrink-0 overflow-hidden rounded-lg"><RouteCover route={route} /></div>
      </div>
      {matchReason && matchReason !== `Title: ${candidate.displayTitle}` ? <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{matchReason}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-2">
        <Button asChild variant="ghost" size="sm"><Link to={guidePath}>Route guide</Link></Button>
        {onSelect ? <Button type="button" variant="ghost" size="sm" aria-label={`Preview ${route.region} on map`} aria-pressed={selected} onClick={onSelect}><Eye />{selected ? "On map" : "Map"}</Button> : null}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={Boolean(plannedRoute)} aria-label={plannedRoute ? "Already planned" : "Save planned route"} onClick={() => { try { onSave(); setSaveError(""); } catch { setSaveError("Could not save. Device storage is unavailable."); } }}>{plannedRoute ? <Check /> : <Plus />}{plannedRoute ? "Saved" : "Save"}</Button>
      </div>
      {plannedRoute ? <p role="status" className="mt-2 text-xs text-ink-secondary">Saved to Planned routes · <Link className="underline" to={`${APP_PATHS.routes}?lifecycle=planned`}>View plans</Link></p> : null}
      {saveError ? <p role="status" className="mt-2 text-sm">{saveError}</p> : null}
    </article>
  );

  return (
    <article
      aria-label={`${route.region} candidate`}
      data-selected={selected}
      className={cn(
        "grid min-w-0 overflow-hidden rounded-2xl border border-line bg-surface",
        selected && "border-white/40 bg-white/[0.03]",
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
            ? "hidden h-32 border-b sm:block"
            : "h-48 border-b sm:h-full sm:min-h-72 sm:border-b-0 sm:border-r",
        )}
      />
      <div className={cn("grid content-start", compact ? "gap-3 p-4" : "gap-5 p-5")}>
        <div className="grid gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-accent-foreground">
            <MapPin className="size-3.5" aria-hidden="true" />
            {route.lifecycle === "completed" ? "Recorded route" : candidate.sourceLabel}
          </div>
          <div>
            <h2 className="font-editorial text-xl font-semibold">{route.region}</h2>
            {!compact ? <p className="mt-1 text-sm text-muted-foreground">{route.activityName}</p> : null}
          </div>
        </div>

        <dl className={cn("grid grid-cols-3 gap-px overflow-hidden border border-line bg-line text-sm", compact && "text-xs")}>
          <Metric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <Metric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <Metric label="Activity" value={route.type} />
        </dl>

        <div className={cn("grid gap-2 text-sm", compact && "text-control")}>
          {description?.trim().toLowerCase() !== route.activityName?.trim().toLowerCase() ? (
            <p className={cn("story-copy text-muted-foreground", compact && "line-clamp-3")}>{description}</p>
          ) : null}
          {matchReason ? (
            <p className="border-l-2 border-l-route pl-3 text-control leading-5 text-ink-secondary">
              <strong className="font-semibold text-ink">Why it matches:</strong>{" "}
              {matchReason}
            </p>
          ) : null}
          <div className={cn("flex flex-wrap gap-2 text-xs text-muted-foreground", compact && "hidden")}>
            {candidate.terrain.map((terrain) => (
              <span key={terrain} className="rounded-full border border-border px-2.5 py-1">
                {terrain}
              </span>
            ))}
            {candidate.vibes.slice(0, 3).map((vibe) => (
              <span key={vibe} className="rounded-full border border-border px-2.5 py-1">
                {vibe}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button asChild variant="outline" size="sm">
            <Link to={guidePath}>Route guide</Link>
          </Button>
          {onSelect && !selected ? (
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
              <span role="status" className="text-sm text-accent-foreground">
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
