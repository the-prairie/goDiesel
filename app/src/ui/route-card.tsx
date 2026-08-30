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
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";
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
      className="group min-w-0 overflow-hidden border border-line bg-surface transition-colors duration-[var(--duration-standard)] hover:border-coral focus-within:border-coral"
    >
      <Link
        to={destination}
        onClick={onOpen}
        aria-label={accessibleLabel}
        className="flex h-full min-w-0 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid sm:grid-cols-[minmax(12.5rem,0.82fr)_minmax(0,1.18fr)]"
      >
        <RouteThread
          route={route}
          imagery
          className="h-44 shrink-0 border-b sm:h-full sm:min-h-[21rem] sm:border-b-0 sm:border-r"
        />

        <div className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
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
          <h2 className="mt-2 line-clamp-2 font-editorial text-2xl font-semibold leading-7 text-ink sm:text-[1.7rem] sm:leading-8">
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
              <MemoryFact label="Climb">
                {route.elevationStatus === "unavailable"
                  ? "Unavailable"
                  : `${route.elevationGainM.toLocaleString()} m up`}
              </MemoryFact>
            )}
          </dl>

          <div className="mt-4 grid min-w-0 gap-2 border-t border-line pt-3">
            <span className="justify-self-start border border-line bg-surface-muted px-2 py-1 text-micro uppercase text-ink-secondary">
              {sourceLabel}
            </span>
            <span className="inline-flex items-center gap-2 justify-self-end text-caption font-semibold text-forest">
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
  imagery = false,
  className,
}: {
  route: RouteSummary;
  imagery?: boolean;
  className?: string;
}) {
  const trace = normalizedTrace(route);
  const planned = isPlannedRoute(route);

  return (
    <div
      className={cn(
        "relative h-32 overflow-hidden border-b border-line bg-[#102b33]",
        className,
      )}
    >
      {imagery ? (
        <>
          <RouteSatelliteThumbnail
            route={route}
            enabled
            cinematic
            showRoute={false}
            imageClassName="saturate-[0.72] contrast-[1.08] brightness-[0.68] transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transform-none"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(5,20,27,0.12),rgba(5,20,27,0.52))]"
          />
          <span className="absolute left-3 top-3 z-[4] bg-[#07151c]/84 px-2 py-1 text-micro font-semibold uppercase text-white backdrop-blur">
            {planned ? "Planning source" : "Recorded geography"}
          </span>
        </>
      ) : (
        <div className="absolute inset-0 bg-surface-muted" aria-hidden="true" />
      )}
      {trace ? (
        <svg
          viewBox="0 0 320 128"
          role="img"
          aria-label={`${route.name} route trace`}
          className="absolute inset-0 z-[3] size-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <polyline
            points={trace.polyline}
            fill="none"
            stroke="rgb(3 15 20 / 76%)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={trace.polyline}
            fill="none"
            stroke="rgb(255 250 242 / 94%)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={trace.polyline}
            fill="none"
            stroke={planned ? "var(--warning)" : "#ff8065"}
            strokeWidth="2.5"
            strokeDasharray={planned ? "7 5" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={trace.start.x}
            cy={trace.start.y}
            r="5"
            fill={planned ? "var(--warning)" : "#ff8065"}
            stroke="white"
            strokeWidth="2.5"
          />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-2 text-center text-micro text-ink-muted">
          Route trace unavailable
        </div>
      )}
      {planned && !imagery ? (
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

  const points = route.trace.map((point) => {
      const x = offsetX + (point.lng - minLng) * scale;
      const y = offsetY + (maxLat - point.lat) * scale;
      return { x, y };
    });

  return {
    points,
    start: points[0],
    polyline: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
  };
}
