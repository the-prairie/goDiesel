import { ArrowLeft, Play } from "lucide-react";
import { Link } from "react-router-dom";

import { replayPath, routeDetailPath } from "@/app/route-paths";
import {
  type QuestRoute,
  type RouteAnnotationEvidence,
  type RouteSummary,
} from "@/domain/route";
import {
  distanceLabel,
  routeStoryChapters,
  routeStoryTitle,
} from "@/surfaces/routes/route-story";
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";
import { cn } from "@/ui/utils";

export interface RouteStoryPrototypeProps {
  route: QuestRoute;
  routesPath: string;
}

export const EVIDENCE_LABEL: Record<RouteAnnotationEvidence, string> = {
  recorded: "Recorded",
  derived: "Track derived",
  measured: "Measured",
  hypothesis: "Editorial",
};

export function PrototypeHeader({
  route,
  routesPath,
  concept,
  quiet = false,
}: RouteStoryPrototypeProps & { concept: string; quiet?: boolean }) {
  const title = routeStoryTitle(route);
  return (
    <header
      className={cn(
        "relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-5",
        quiet
          ? "border-line bg-canvas text-ink"
          : "border-white/20 bg-[#123b35] text-white",
      )}
    >
      <Link
        to={routesPath}
        className="inline-flex min-h-11 items-center gap-2 px-2 text-control font-semibold outline-none focus-visible:ring-2 focus-visible:ring-route"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">Route collection</span>
        <span className="sm:hidden">Routes</span>
      </Link>
      <div className="min-w-0 text-center">
        <p className={cn("truncate text-micro font-semibold uppercase", quiet ? "text-ink-muted" : "text-white/55")}>
          {concept}
        </p>
        <p className="max-w-[44vw] truncate font-editorial text-lg leading-none">{title}</p>
      </div>
      {route.replay.replayEligible ? (
        <Link
          to={replayPath(route.slug, routeDetailPath(route.slug))}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 px-3 text-control font-semibold outline-none focus-visible:ring-2 focus-visible:ring-route",
            quiet ? "bg-forest text-white" : "bg-canvas text-forest",
          )}
        >
          <Play aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Cinematic replay</span>
          <span className="sm:hidden">Replay</span>
        </Link>
      ) : (
        <span className="px-2 text-caption opacity-65">Replay unavailable</span>
      )}
    </header>
  );
}

export function PrototypeTerrain({
  route,
  progress = 0,
  className,
  children,
  routeClassName,
}: {
  route: QuestRoute;
  progress?: number;
  className?: string;
  children?: React.ReactNode;
  routeClassName?: string;
}) {
  const summary: RouteSummary = {
    ...route,
    trace: route.route,
    guide: {
      vibe: route.curation.vibe,
      reviewStatus: route.curation.reviewStatus,
    },
  };
  const trace = prototypeTrace(route);
  const totalDistanceM = Math.max(route.route.at(-1)?.d ?? route.distanceKm * 1_000, 1);
  return (
    <div className={cn("relative overflow-hidden bg-[#183f39]", className)}>
      <RouteSatelliteThumbnail
        route={summary}
        enabled
        cinematic
        showRoute={false}
        imageClassName="saturate-[0.76] contrast-[1.08] brightness-[0.7]"
      />
      {trace ? (
        <svg
          viewBox="0 0 1000 700"
          role="img"
          aria-label={`${route.name} recorded route trace`}
          className={cn("pointer-events-none absolute inset-0 z-[2] size-full", routeClassName)}
          preserveAspectRatio="xMidYMid meet"
        >
          <g data-route-layer="casing">
            {trace.segments.map((segment) => (
              <path key={segment.id} d={segment.path} fill="none" stroke="rgb(255 255 255 / 76%)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
          <g data-route-layer="recorded">
            {trace.segments.map((segment) => (
              <path key={segment.id} d={segment.path} fill="none" stroke="#3379df" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
          <g data-route-layer="progress">
            {trace.segments.map((segment) => {
              const segmentProgress = Math.max(0, Math.min(1, (progress * totalDistanceM - segment.startD) / Math.max(segment.endD - segment.startD, 1)));
              return (
                <path key={segment.id} data-route-progress d={segment.path} pathLength="1" fill="none" stroke="#d95737" strokeWidth="7" strokeDasharray={`${segmentProgress} 1`} strokeLinecap="round" strokeLinejoin="round" className="transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none" />
              );
            })}
          </g>
          <circle cx={trace.start.x} cy={trace.start.y} r="12" fill="#d95737" stroke="white" strokeWidth="5" />
        </svg>
      ) : null}
      {children}
    </div>
  );
}

export function RouteChapterNodes({
  route,
  activeIndex,
  onSelect,
}: {
  route: QuestRoute;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const chapters = routeStoryChapters(route);
  const trace = prototypeTrace(route);
  if (!trace) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-label="Route chapters">
      {chapters.map((chapter, index) => {
        const point = trace.points.reduce((closest, candidate) =>
          Math.abs(candidate.distanceM - chapter.distanceM) < Math.abs(closest.distanceM - chapter.distanceM)
            ? candidate
            : closest,
        );
        return (
          <button
            key={chapter.id}
            type="button"
            aria-current={activeIndex === index ? "step" : undefined}
            aria-label={`${index + 1}. ${chapter.title}, ${distanceLabel(chapter.distanceM)}`}
            onClick={() => onSelect(index)}
            className="pointer-events-auto absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-forest"
            style={{ left: `${(point.x / 1000) * 100}%`, top: `${(point.y / 700) * 100}%` }}
          >
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full border-2 text-micro font-bold shadow-panel transition-colors",
                activeIndex === index
                  ? "border-white bg-coral text-white"
                  : "border-white/85 bg-[#173f39]/90 text-white",
              )}
            >
              {index + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function RouteIdentity({ route, light = false }: { route: QuestRoute; light?: boolean }) {
  const title = routeStoryTitle(route);
  const premise = prototypePremise(route);
  return (
    <div className={cn(light ? "text-white" : "text-ink")}>
      <p className={cn("text-caption font-semibold uppercase", light ? "text-white/70" : "text-ink-muted")}>
        {route.region} · {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(`${route.date}T00:00:00`))}
      </p>
      <h1 className="mt-4 max-w-[18ch] text-balance font-editorial text-5xl font-medium leading-[0.94] sm:text-6xl">
        {title}
      </h1>
      <p className={cn("mt-6 text-micro font-semibold uppercase", light ? "text-[#ffd2e4]" : "text-coral")}>
        {premise.label}
      </p>
      <p className={cn("mt-2 max-w-[52ch] font-editorial text-xl italic leading-7", light ? "text-[#ffdbea]" : "text-ink-secondary")}>
        {premise.text}
      </p>
    </div>
  );
}

export function PrototypeMetrics({ route, light = false }: { route: QuestRoute; light?: boolean }) {
  const chapters = routeStoryChapters(route);
  return (
    <dl className={cn("grid grid-cols-3 border-y", light ? "border-white/25 text-white" : "border-line text-ink")}>
      {[
        ["Distance", `${route.distanceKm.toFixed(1)} km`],
        ["Climb", `${route.elevationGainM.toLocaleString()} m`],
        ["Story", `${chapters.length} chapters`],
      ].map(([label, value]) => (
        <div key={label} className={cn("min-w-0 px-3 py-4 first:pl-0", light ? "border-white/20" : "border-line")}>
          <dt className={cn("text-micro uppercase", light ? "text-white/55" : "text-ink-muted")}>{label}</dt>
          <dd className="mt-1 text-control font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function prototypeTrace(route: QuestRoute) {
  if (route.route.length < 2) return undefined;
  const lngs = route.route.map((point) => point.lng);
  const lats = route.route.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = Math.max(maxLng - minLng, 0.00001);
  const height = Math.max(maxLat - minLat, 0.00001);
  const scale = Math.min(850 / width, 550 / height);
  const offsetX = (1000 - width * scale) / 2;
  const offsetY = (700 - height * scale) / 2;
  const points = route.route.map((point) => ({
    x: offsetX + (point.lng - minLng) * scale,
    y: offsetY + (maxLat - point.lat) * scale,
    distanceM: point.d,
  }));
  const discontinuities = [...route.provenance.discontinuities].sort((left, right) => left.startD - right.startD);
  const segmentPoints: typeof points[] = [];
  let currentSegment: typeof points = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const crossesGap = previous && discontinuities.some((gap) => previous.distanceM <= gap.endD && point.distanceM >= gap.startD);
    if (crossesGap && currentSegment.length > 0) {
      segmentPoints.push(currentSegment);
      currentSegment = [];
    }
    currentSegment.push(point);
  });
  if (currentSegment.length > 0) segmentPoints.push(currentSegment);
  const segments = segmentPoints
    .filter((segment) => segment.length > 1)
    .map((segment, index) => ({
      id: `segment-${index}`,
      startD: segment[0].distanceM,
      endD: segment.at(-1)!.distanceM,
      path: segment.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "),
    }));
  return {
    points,
    start: points[0],
    segments,
  };
}

export function prototypePremise(route: QuestRoute) {
  if (route.curation.vibe) return { label: "Editorial premise", text: route.curation.vibe };
  if (route.description) {
    return route.lifecycle === "completed"
      ? { label: "Recorded note", text: route.description }
      : { label: "Imported context", text: route.description };
  }
  return { label: "Generated route summary", text: route.completionRule };
}
