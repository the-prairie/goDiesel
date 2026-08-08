import {
  ArrowRight,
  Bike,
  CalendarClock,
  Footprints,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { RouteSummary } from "@/domain/routes";
import { isPlannedRoute } from "@/surfaces/finder/planning";
import { APP_PATHS, routeDetailPath } from "@/app/route-paths";
import { cn } from "@/lib/utils";

export function RouteCard({
  route,
  onOpen,
}: {
  route: RouteSummary;
  onOpen?: () => void;
}) {
  const planned = isPlannedRoute(route);
  const reviewed =
    route.guide.reviewStatus === "reviewed" || route.guide.reviewStatus === "published";
  const destination = planned ? APP_PATHS.finder : routeDetailPath(route.slug);
  const accessibleLabel = planned
    ? `Edit planned ${route.name} route in Finder`
    : `Open ${route.name} route from ${route.date || "an unknown date"}, ${route.distanceKm.toFixed(1)} km`;

  return (
    <article
      aria-label={planned ? `Planned route ${route.region}` : undefined}
      className="min-w-0 border-b border-line bg-surface transition-colors hover:bg-surface-raised"
    >
      <Link
        to={destination}
        onClick={planned ? undefined : onOpen}
        aria-label={accessibleLabel}
        className="group grid min-w-0 gap-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(20rem,2.2fr)_7rem_5.5rem_6rem_6.5rem_minmax(9rem,1fr)_7.5rem_4.5rem]"
      >
        <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] border-line md:grid-cols-[9.5rem_minmax(0,1fr)] md:border-r">
          <RouteThread
            route={route}
            className="h-full min-h-28 border-b-0 border-r md:min-h-32"
          />
          <div className="grid min-w-0 content-center gap-1.5 px-3 py-3 md:px-4">
            <p className="truncate text-micro font-semibold uppercase text-ink-muted">
              {route.region}
            </p>
            <h2 className="truncate font-editorial text-xl font-semibold leading-tight text-ink md:text-2xl">
              {route.name}
            </h2>
            {route.subtitle ? (
              <p className="line-clamp-2 text-caption italic text-ink-secondary">
                {route.subtitle}
              </p>
            ) : null}
            <span className="mt-1 w-fit border border-line bg-surface-muted px-1.5 py-0.5 text-micro uppercase text-ink-secondary">
              {route.theme}
            </span>
            {planned ? (
              <span className="line-clamp-1 text-micro text-ink-muted">
                {route.planning.sourceLabel}
              </span>
            ) : null}
          </div>
        </div>

        <LedgerCell label="Date" className="hidden md:flex">
          {route.date || "Unknown"}
        </LedgerCell>
        <LedgerCell label="Activity" className="hidden md:flex">
          <span className="inline-flex items-center gap-2">
            {route.type === "Ride" ? (
              <Bike className="size-4 text-route" aria-hidden="true" />
            ) : (
              <Footprints className="size-4 text-route" aria-hidden="true" />
            )}
            {route.type}
          </span>
        </LedgerCell>
        <LedgerCell label="Distance" className="hidden md:flex">
          {route.distanceKm.toFixed(1)} km
        </LedgerCell>
        <LedgerCell label="Climb" className="hidden md:flex">
          {route.elevationGainM.toLocaleString()} m up
        </LedgerCell>
        <LedgerCell label="Vibe" className="hidden md:flex">
          <span className="line-clamp-3 italic">
            {reviewed && route.guide.vibe
              ? route.guide.vibe
              : "Editorial vibe awaiting review"}
          </span>
        </LedgerCell>
        <LedgerCell label="Lifecycle" className="hidden md:flex">
          <span className="grid gap-1">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  planned ? "bg-warning" : "bg-route",
                )}
              />
              {capitalize(route.lifecycle)}
            </span>
            <span className="text-micro text-ink-muted">
              {planned ? "Future route" : reviewed ? "Reviewed guide" : "Draft guide"}
            </span>
          </span>
        </LedgerCell>
        <div className="hidden items-center justify-center text-sm font-medium text-forest md:flex">
          <span className="sr-only">Action</span>
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line px-3 py-3 text-caption md:hidden">
          <MobileFact label="Activity" value={route.type} />
          <MobileFact label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
          <MobileFact label="Climb" value={`${route.elevationGainM.toLocaleString()} m up`} />
          <MobileFact
            label="Lifecycle"
            value={`${capitalize(route.lifecycle)} · ${planned ? "Future route" : reviewed ? "Reviewed guide" : "Draft guide"}`}
          />
          <div className="col-span-2 flex items-start justify-between gap-4 border-t border-line pt-2">
            <span className="line-clamp-2 italic text-ink-secondary">
              {reviewed && route.guide.vibe
                ? route.guide.vibe
                : planned
                  ? "Saved for a future day"
                  : "Editorial vibe awaiting review"}
            </span>
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" />
          </div>
        </div>
      </Link>
    </article>
  );
}

function LedgerCell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 items-center border-r border-line px-3 py-4 text-caption text-ink-secondary",
        className,
      )}
    >
      <span className="sr-only">{label}: </span>
      {children}
    </div>
  );
}

function MobileFact({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="text-micro uppercase text-ink-muted">{label}</span>
      <span className="mt-0.5 block truncate font-medium text-ink">{value}</span>
    </span>
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

  return (
    <div
      className={cn(
        "relative h-32 overflow-hidden border-b border-line bg-surface-muted",
        className,
      )}
    >
      <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:24px_24px]" />
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
            stroke="var(--route-halo)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points}
            fill="none"
            stroke="var(--route)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-2 text-center text-micro text-ink-muted">
          Route trace unavailable
        </div>
      )}
      {isPlannedRoute(route) ? (
        <CalendarClock
          className="absolute bottom-2 right-2 size-4 text-warning"
          aria-label="Planned"
        />
      ) : null}
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
