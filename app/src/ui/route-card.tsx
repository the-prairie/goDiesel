import {
  ArrowRight,
  Bike,
  CalendarClock,
  Footprints,
} from "lucide-react";
import { Link } from "react-router-dom";

import { formatRouteDate, type RouteSummary } from "@/domain/route";
import { isPlannedRoute } from "@/domain/planning";
import { routeDetailPath } from "@/app/route-paths";
import { cn } from "@/ui/utils";

export function RouteCard({
  route,
  onOpen,
}: {
  route: RouteSummary;
  onOpen?: () => void;
}) {
  const planned = isPlannedRoute(route);
  const guideReviewed =
    route.guide.reviewStatus === "reviewed" ||
    route.guide.reviewStatus === "published";
  const destination = routeDetailPath(route.slug);
  const displayRegion = planned
    ? route.planning.intent.place.trim() || route.region
    : route.region;
  const displayActivity = planned ? route.planning.intent.activity : route.type;
  const displayDistanceKm = planned
    ? route.planning.intent.distanceKm
    : route.distanceKm;
  const personalTitle = planned
    ? displayRegion
    : route.activityName.trim() || route.subtitle.trim() || route.name;
  const context = planned
    ? {
        label: "Planning source",
        text: `${route.name} - ${route.planning.sourceLabel}`,
      }
    : route.lifecycle === "discovered"
      ? {
          label: "Owner experience unavailable",
          text: "This imported route has not been recorded by the owner.",
        }
      : route.description.trim()
      ? { label: "Recorded note", text: route.description }
      : guideReviewed && route.guide.vibe
        ? { label: "Editorial hypothesis", text: route.guide.vibe }
        : { label: "Recorded note unavailable", text: "No recorded activity note." };
  const sourceLabel = planned
    ? "Planning intent"
    : route.lifecycle === "discovered"
      ? "Imported geometry"
      : "Recorded activity";
  const accessibleLabel = planned
    ? `Open planned ${displayRegion} route`
    : `Open ${route.name} route from ${route.date || "an unknown date"}, ${route.distanceKm.toFixed(1)} km`;

  return (
    <article
      aria-label={planned ? `Planned route ${displayRegion}` : undefined}
      className="group min-w-0 border border-line bg-surface transition-[border-color,box-shadow,transform] duration-[var(--duration-standard)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-panel focus-within:border-line-strong focus-within:shadow-panel motion-reduce:hover:translate-y-0"
    >
      <Link
        to={destination}
        onClick={onOpen}
        aria-label={accessibleLabel}
        className="flex h-full min-w-0 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <RouteThread route={route} className="h-44 shrink-0 border-b" />

        <div className="flex flex-1 flex-col px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <p className="min-w-0 truncate text-micro font-semibold uppercase text-coral">
              {displayRegion}
            </p>
            <time
              dateTime={route.date || undefined}
              className="shrink-0 text-micro font-semibold uppercase text-ink-muted"
            >
              {formatRouteDate(route.date)}
            </time>
          </div>
          <h2 className="mt-2 line-clamp-2 min-h-14 font-editorial text-2xl font-semibold leading-7 text-ink sm:text-3xl sm:leading-8">
            {personalTitle}
          </h2>
          <div className="mt-3 min-h-[4.5rem]">
            <p className="text-micro font-semibold uppercase text-ink-muted">
              {context.label}
            </p>
            <p className="mt-1 line-clamp-2 text-caption leading-6 text-ink-secondary">
              {context.text}
            </p>
          </div>

          <dl className="mt-5 grid grid-cols-3 border-y border-line">
            <MemoryFact label="Activity">
              <span className="inline-flex items-center gap-1.5">
                {displayActivity === "Ride" ? (
                  <Bike className="size-4 text-route" aria-hidden="true" />
                ) : (
                  <Footprints className="size-4 text-route" aria-hidden="true" />
                )}
                {displayActivity}
              </span>
            </MemoryFact>
            <MemoryFact label="Distance">{displayDistanceKm.toFixed(1)} km</MemoryFact>
            {planned ? (
              <MemoryFact label="Terrain">
                {formatTerrain(route.planning.intent.terrain)}
              </MemoryFact>
            ) : (
              <MemoryFact label="Climb">{route.elevationGainM.toLocaleString()} m up</MemoryFact>
            )}
          </dl>

          <div className="mt-4 flex min-w-0 items-center justify-between gap-4">
            <span className="min-w-0 truncate border border-line bg-surface-muted px-2 py-1 text-micro uppercase text-ink-secondary">
              {sourceLabel}
            </span>
            <span className="inline-flex shrink-0 items-center gap-2 text-caption font-semibold text-forest">
              {planned ? "Open route plan" : "Open field story"}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-1"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function formatTerrain(terrain: string) {
  return terrain === "any"
    ? "Any terrain"
    : `${terrain.charAt(0).toUpperCase()}${terrain.slice(1)}`;
}

function MemoryFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-r border-line px-2 py-3 last:border-r-0 sm:px-3">
      <dt className="text-micro uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 truncate text-caption font-semibold text-ink">{children}</dd>
    </div>
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
  const planned = isPlannedRoute(route);

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
            stroke={planned ? "var(--warning)" : "var(--route)"}
            strokeWidth="2.5"
            strokeDasharray={planned ? "7 5" : undefined}
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
      {planned ? (
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
