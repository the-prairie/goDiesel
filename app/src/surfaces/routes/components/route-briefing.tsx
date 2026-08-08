import { Flag, Mountain, Route as RouteIcon } from "lucide-react";

import type { QuestRoute } from "@/domain/routes";
import {
  elevationRange,
  projectRouteGeometry,
  sampleElevationProfile,
  sampleRoutePoints,
} from "@/domain/geometry/route-visualization";

const traceWidth = 640;
const traceHeight = 280;
const profileWidth = 640;
const profileHeight = 180;

export function RouteBriefing({ route }: { route: QuestRoute }) {
  const hasGeometry = route.route.length > 1;

  return (
    <section
      aria-label="Route briefing"
      className="grid min-w-0 gap-5 border-y border-border py-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">
            Route briefing
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            Read the route before you replay it.
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {route.route.length.toLocaleString()} recorded points
        </p>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <figure className="grid min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-md border border-border bg-card">
          <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <RouteIcon className="size-4 text-primary" aria-hidden="true" />
              Recorded path
            </span>
            <span className="text-xs text-muted-foreground">
              Start to finish
            </span>
          </figcaption>
          {hasGeometry ? (
            <RouteTrace route={route} />
          ) : (
            <BriefingUnavailable
              title="Recorded path unavailable"
              copy="This route has no usable GPS geometry to preview."
            />
          )}
        </figure>

        <figure className="grid min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-md border border-border bg-card">
          <figcaption className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold">
              <Mountain className="size-4 text-primary" aria-hidden="true" />
              Elevation character
            </span>
            <span className="text-xs text-muted-foreground">
              {route.elevationGainM.toLocaleString()} m total climb
            </span>
          </figcaption>
          {hasGeometry ? (
            <ElevationProfile route={route} />
          ) : (
            <BriefingUnavailable
              title="Elevation profile unavailable"
              copy="Climb distribution needs recorded route points."
            />
          )}
        </figure>
      </div>
    </section>
  );
}

function RouteTrace({ route }: { route: QuestRoute }) {
  const points = normalizeTrace(sampleRoutePoints(route.route));
  const first = points[0];
  const last = points.at(-1)!;

  return (
    <div className="relative h-48 overflow-hidden bg-accent/25 sm:aspect-[16/7] sm:h-auto">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px]" />
      <svg
        viewBox={`0 0 ${traceWidth} ${traceHeight}`}
        role="img"
        aria-label={`${route.name} recorded path from start to finish`}
        className="absolute inset-0 size-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={first.x} cy={first.y} r="7" fill="var(--primary)" />
        <circle cx={last.x} cy={last.y} r="7" fill="#f5c451" />
      </svg>
      <div className="absolute inset-x-4 bottom-3 flex items-center justify-between text-xs font-medium">
        <span className="text-primary">Start</span>
        <span className="inline-flex items-center gap-1 text-[#f5c451]">
          <Flag className="size-3.5" aria-hidden="true" />
          Finish
        </span>
      </div>
    </div>
  );
}

export function ElevationProfile({ route }: { route: QuestRoute }) {
  const points = sampleElevationProfile(route.route);
  const { minimum, maximum } = elevationRange(route.route);
  const range = Math.max(1, maximum - minimum);
  const totalDistance = Math.max(1, points.at(-1)?.d ?? route.distanceKm * 1_000);
  const left = 22;
  const right = profileWidth - 22;
  const top = 22;
  const bottom = profileHeight - 34;
  const rendered = points.map((point) => ({
    x: left + (point.d / totalDistance) * (right - left),
    y: bottom - ((point.elev - minimum) / range) * (bottom - top),
  }));
  const line = rendered.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M ${rendered[0].x.toFixed(1)} ${bottom} L ${line.replaceAll(",", " ")} L ${rendered.at(-1)!.x.toFixed(1)} ${bottom} Z`;

  return (
    <div className="grid min-h-48 grid-rows-[minmax(0,1fr)_auto] bg-accent/15 px-3 pb-3 pt-2">
      <svg
        viewBox={`0 0 ${profileWidth} ${profileHeight}`}
        role="img"
        aria-label={`${route.name} elevation profile from ${Math.round(minimum)} to ${Math.round(maximum)} metres`}
        className="h-full min-h-0 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={left}
          x2={right}
          y1={bottom}
          y2={bottom}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <path
          d={area}
          fill="color-mix(in srgb, var(--primary) 16%, transparent)"
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between gap-4 px-1 text-xs text-muted-foreground">
        <span>{Math.round(minimum).toLocaleString()} m low</span>
        <span>{Math.round(maximum).toLocaleString()} m high</span>
      </div>
    </div>
  );
}

function BriefingUnavailable({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 text-center" role="status">
      <div className="grid max-w-xs gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{copy}</p>
      </div>
    </div>
  );
}

function normalizeTrace(points: QuestRoute["route"]) {
  const projected = projectRouteGeometry(points);
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 0.00001);
  const height = Math.max(maxY - minY, 0.00001);
  const paddingX = 46;
  const paddingY = 34;
  const scale = Math.min(
    (traceWidth - paddingX * 2) / width,
    (traceHeight - paddingY * 2) / height,
  );
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (traceWidth - renderedWidth) / 2;
  const offsetY = (traceHeight - renderedHeight) / 2;

  return projected.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (maxY - point.y) * scale,
  }));
}
