import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { RouteSummary } from "@/domain/route";
import { isPlannedRoute } from "@/domain/planning";
import { APP_PATHS, routeDetailPath } from "@/app/route-paths";
import { RouteCover } from "@/ui/route-cover";

export function RouteCard({
  route,
  onOpen,
}: {
  route: RouteSummary;
  onOpen?: () => void;
}) {
  const planned = isPlannedRoute(route);
  const reviewed = route.guide.reviewStatus === "reviewed" || route.guide.reviewStatus === "published";
  const summary = (reviewed ? route.guide.vibe?.split(/(?<=[.!?])\s/)[0] : undefined)
    || `${route.distanceKm.toFixed(1)} km ${route.type.toLowerCase()} with ${route.elevationGainM.toLocaleString()} m of climbing.`;
  return (
    <article aria-label={planned ? `Planned route ${route.region}` : undefined} className="route-preview field-note-card group">
      <Link
        to={planned ? APP_PATHS.finder : routeDetailPath(route.slug)}
        onClick={planned ? undefined : onOpen}
        aria-label={planned ? `Edit planned ${route.name} route in Finder` : `Open ${route.name} route from ${route.date || "an unknown date"}, ${route.distanceKm.toFixed(1)} km`}
        className="field-note-link focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <RouteCover key={route.slug} route={route} />
        <div className="field-note-copy">
          <p className="field-note-eyebrow">{planned ? "Planned" : route.lifecycle === "completed" ? "Recorded" : "Discovered"} {route.type}</p>
          <h2 className="field-note-title">{route.name}</h2>
          <p className="field-note-summary">{planned ? route.planning.sourceLabel : summary}</p>
          <div className="field-note-metrics">
            <span>{route.distanceKm.toFixed(1)} <small>km</small></span>
            <span>{route.elevationGainM.toLocaleString()} <small>m up</small></span>
          </div>
          <div className="field-note-footer">
            <time dateTime={route.date || undefined}>{formatCardDate(route.date)}</time>
            <span>{planned ? "Edit plan" : "Route guide"}<ArrowUpRight aria-hidden="true" /></span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function formatCardDate(date: string) {
  if (!date) return "Date not recorded";
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime())) return date;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

export { RouteThread } from "@/ui/route-thread";
