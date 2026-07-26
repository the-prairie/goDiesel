import {
  ArrowUpRight,
  Bike,
  CalendarClock,
  CalendarDays,
  MapPin,
  Route as RouteIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { RouteSummary } from "@/domain/routes";
import { isPlannedRoute } from "@/domain/planning";
import { patinaForRoute } from "@/domain/route-patina";
import { APP_PATHS, routeDetailPath } from "@/navigation";
import { cn } from "@/lib/utils";

export function RouteCard({
  route,
  onOpen,
}: {
  route: RouteSummary;
  onOpen?: () => void;
}) {
  if (isPlannedRoute(route)) {
    return (
      <article
        aria-label={`Planned route ${route.region}`}
        className="grid min-h-[22rem] min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-dashed border-graphite bg-surface"
      >
        <RouteThread route={route} />
        <div className="grid content-start gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-caption text-graphite">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                <span>Pencil — untraveled</span>
              </div>
              <h2 className="mt-1 truncate font-editorial text-base font-medium tracking-[0.01em] text-ink">
                {route.name}
              </h2>
              <p className="mt-1 truncate text-caption text-ink-muted">{route.region}</p>
            </div>
          </div>

          <p className="font-marginalia line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-ink-secondary">
            {route.planning.sourceLabel}. Saved for a future {route.type.toLowerCase()}.
          </p>

          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 font-tabular text-caption text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              {route.type === "Ride" ? (
                <Bike className="size-3.5" aria-hidden="true" />
              ) : (
                <RouteIcon className="size-3.5" aria-hidden="true" />
              )}
              {route.type}
            </span>
            <span>{route.distanceKm.toFixed(1)} km</span>
            <span>{route.elevationGainM.toLocaleString()} m up</span>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-caption">
            <span className="text-graphite">Future route</span>
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Saved {route.date}
            </span>
          </div>

          <Link
            to={APP_PATHS.finder}
            className="text-control font-medium text-forest underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Edit in Finder
          </Link>
        </div>
      </article>
    );
  }

  const status = route.guide.reviewStatus;
  const reviewed = status === "reviewed" || status === "published";

  return (
    <article className="min-w-0">
      <Link
        to={routeDetailPath(route.slug)}
        onClick={onOpen}
        aria-label={`Open ${route.name} route from ${route.date || "an unknown date"}, ${route.distanceKm.toFixed(1)} km`}
        className="group grid min-h-[22rem] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface text-left outline-none transition-colors hover:border-route/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RouteThread route={route} />
        <div className="grid content-start gap-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-caption text-ink-muted">
                <MapPin className="size-3.5" aria-hidden="true" />
                <span className="truncate">{route.region}</span>
              </div>
              <h2 className="mt-1 truncate font-editorial text-base font-medium tracking-[0.01em] text-ink">
                {route.name}
              </h2>
              {route.subtitle ? (
                <p className="mt-1 truncate text-caption text-ink-muted">
                  {route.subtitle}
                </p>
              ) : null}
            </div>
            <ArrowUpRight
              className="mt-0.5 size-4 shrink-0 text-ink-muted transition-colors group-hover:text-route"
              aria-hidden="true"
            />
          </div>

          <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-ink-secondary">
            {reviewed && route.guide.vibe
              ? route.guide.vibe
              : "Editorial vibe has not been reviewed for this route."}
          </p>

          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 font-tabular text-caption text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              {route.type === "Ride" ? (
                <Bike className="size-3.5" aria-hidden="true" />
              ) : (
                <RouteIcon className="size-3.5" aria-hidden="true" />
              )}
              {route.type}
            </span>
            <span>{route.distanceKm.toFixed(1)} km</span>
            <span>{route.elevationGainM.toLocaleString()} m up</span>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-caption">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink">{capitalize(route.lifecycle)}</span>
              <span aria-hidden="true" className="text-ink-muted">
                ·
              </span>
              <span className={reviewed ? "font-medium text-forest" : "text-ink-muted"}>
                {reviewed ? `${capitalize(status)} guide` : "Draft guide"}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {route.date || "Date unknown"}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export function RouteThread({
  route,
  className,
}: {
  route: RouteSummary;
  className?: string;
}) {
  const points = normalizedTrace(route);
  const patina = patinaForRoute({
    lifecycle: route.lifecycle,
    lastTraveledAt: route.date || null,
    travelCount: route.lifecycle === "completed" ? 1 : 0,
  });

  return (
    <div
      className={cn(
        "relative h-32 overflow-hidden border-b border-line bg-[radial-gradient(circle_at_50%_45%,var(--paper-lifted),var(--canvas)_70%)]",
        className,
      )}
    >
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:28px_28px]" />
      {points ? (
        <svg
          viewBox="0 0 320 128"
          role="img"
          aria-label={`${route.name} route trace`}
          className="absolute inset-0 size-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <polyline
            points={points}
            fill="none"
            stroke={patina.stroke}
            strokeWidth={patina.strokeWidthPx}
            strokeOpacity={patina.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={patina.kind === "pencil" ? "3 4" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-caption text-ink-muted">
          Route trace unavailable
        </div>
      )}
      <span className="absolute bottom-3 left-3 text-caption font-medium text-ink-secondary">
        {route.theme}
      </span>
    </div>
  );
}

function normalizedTrace(route: RouteSummary) {
  if (route.trace.length < 2) return null;
  const lngs = route.trace.map((point) => point.lng);
  const lats = route.trace.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = Math.max(maxLng - minLng, 0.00001);
  const height = Math.max(maxLat - minLat, 0.00001);
  const scale = Math.min(280 / width, 96 / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (320 - renderedWidth) / 2;
  const offsetY = (128 - renderedHeight) / 2;

  return route.trace
    .map((point) => {
      const x = offsetX + (point.lng - minLng) * scale;
      const y = offsetY + (maxLat - point.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
