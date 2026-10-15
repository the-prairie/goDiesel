import {
  ArrowRight,
  Bike,
  ChevronLeft,
  ChevronRight,
  Footprints,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "react-router-dom";
import { routeDetailPath } from "@/app/route-paths";

import { Button } from "@/ui/button";
import { RouteSatelliteThumbnail } from "@/surfaces/atlas/components/route-satellite-thumbnail";
import type { RouteRegion } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/route";
import {
  elevationRange,
  projectRouteGeometry,
  sampleElevationProfile,
  sampleRoutePoints,
} from "@/domain/geometry/route-visualization";
import { cn } from "@/ui/utils";

export const ROUTE_CAROUSEL_SLIDE_CLASS =
  "min-w-0 flex-[0_0_84%] pl-3 sm:basis-[44%] sm:pl-4 xl:basis-1/3";

interface RegionRouteCarouselProps {
  region: RouteRegion;
  selectedRoute?: RouteSummary;
  onSelectRoute: (route: RouteSummary) => void;
  onClear: () => void;
  replayPathForRoute: (route: RouteSummary) => string;
  presentationReady: boolean;
}

const traceWidth = 112;
const traceHeight = 112;
const profileWidth = 360;
const profileHeight = 62;

export function RegionRouteCarousel({
  region,
  selectedRoute,
  onSelectRoute,
  onClear,
  replayPathForRoute,
  presentationReady,
}: RegionRouteCarouselProps) {
  const effectiveSelectedRoute = selectedRoute ?? region.routes[0];
  const selectedIndex = Math.max(
    0,
    region.routes.findIndex(
      (route) => route.slug === effectiveSelectedRoute?.slug,
    ),
  );
  const [viewportRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "keepSnaps",
    inViewThreshold: 0.1,
    dragFree: false,
    loop: false,
    skipSnaps: false,
    slidesToScroll: 1,
    startIndex: selectedIndex,
  });
  const [thumbnailIndexes, setThumbnailIndexes] = useState(() =>
    thumbnailIndexesForSlidesInView([selectedIndex], region.routes.length),
  );
  const programmaticSelectionRef = useRef<string | undefined>(undefined);
  const commitCenteredRoute = useCallback(() => {
    if (!emblaApi) return;
    const route = region.routes[emblaApi.selectedScrollSnap()];
    if (route?.slug === programmaticSelectionRef.current) {
      programmaticSelectionRef.current = undefined;
      return;
    }
    if (route && route.slug !== effectiveSelectedRoute?.slug)
      onSelectRoute(route);
  }, [effectiveSelectedRoute?.slug, emblaApi, onSelectRoute, region.routes]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", commitCenteredRoute);
    return () => {
      emblaApi.off("select", commitCenteredRoute);
    };
  }, [commitCenteredRoute, emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const synchronizeThumbnailWindow = () => {
      setThumbnailIndexes(
        thumbnailIndexesForSlidesInView(
          emblaApi.slidesInView(),
          region.routes.length,
        ),
      );
    };
    synchronizeThumbnailWindow();
    emblaApi.on("slidesInView", synchronizeThumbnailWindow);
    emblaApi.on("reInit", synchronizeThumbnailWindow);
    return () => {
      emblaApi.off("slidesInView", synchronizeThumbnailWindow);
      emblaApi.off("reInit", synchronizeThumbnailWindow);
    };
  }, [emblaApi, region.routes.length]);

  useEffect(() => {
    if (!emblaApi || !effectiveSelectedRoute) return;
    const index = region.routes.findIndex(
      (route) => route.slug === effectiveSelectedRoute.slug,
    );
    if (index >= 0 && index !== emblaApi.selectedScrollSnap())
      emblaApi.scrollTo(index);
    const restoreSelectionAfterResize = () => {
      if (index >= 0) emblaApi.scrollTo(index, true);
    };
    emblaApi.on("reInit", restoreSelectionAfterResize);
    return () => {
      emblaApi.off("reInit", restoreSelectionAfterResize);
    };
  }, [effectiveSelectedRoute, emblaApi, region.routes]);

  const selectRoute = useCallback(
    (route: RouteSummary, index: number) => {
      programmaticSelectionRef.current = route.slug;
      emblaApi?.scrollTo(index);
      queueMicrotask(() => {
        if (programmaticSelectionRef.current === route.slug) {
          programmaticSelectionRef.current = undefined;
        }
      });
      if (route.slug !== selectedRoute?.slug) onSelectRoute(route);
    },
    [emblaApi, onSelectRoute, selectedRoute?.slug],
  );

  const selectRouteAt = useCallback(
    (index: number) => {
      const route = region.routes[index];
      if (route) selectRoute(route, index);
    },
    [region.routes, selectRoute],
  );

  const onCarouselKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectRouteAt(selectedIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectRouteAt(selectedIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectRouteAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectRouteAt(region.routes.length - 1);
    }
  };

  if (!presentationReady) {
    return (
      <section
        aria-label={`${region.name} routes`}
        className="atlas-route-carousel text-white"
      >
        <div className="atlas-route-loading grid place-items-center">
          <p role="status" aria-live="polite" className="text-sm text-white/70">
            Loading {region.name} terrain
          </p>
        </div>
      </section>
    );
  }

  const hasMultipleRoutes = region.routes.length > 1;
  const canSelectPrevious = hasMultipleRoutes && selectedIndex > 0;
  const canSelectNext =
    hasMultipleRoutes && selectedIndex < region.routes.length - 1;
  const currentPosition = region.routes.length === 0 ? 0 : selectedIndex + 1;

  return (
    <section
      aria-label={`${region.name} routes`}
      className="atlas-route-carousel overflow-hidden text-white"
    >
      <header className="atlas-route-header flex items-center justify-between gap-2 px-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="truncate text-sm font-medium tracking-[-0.01em]">
            {region.name}
          </h2>
          <span className="hidden shrink-0 font-mono text-xs text-white/60 sm:inline">
            {region.routes.length} {region.routes.length === 1 ? "route" : "routes"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className="mr-1 min-w-8 text-right font-mono text-xs tabular-nums text-white/65"
            aria-live="polite"
          >
            {currentPosition} / {region.routes.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous route"
            title="Previous route"
            disabled={!canSelectPrevious}
            onClick={() => selectRouteAt(selectedIndex - 1)}
            className="size-11 border-0 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-25"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next route"
            title="Next route"
            disabled={!canSelectNext}
            onClick={() => selectRouteAt(selectedIndex + 1)}
            className="size-11 border-0 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-25"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${region.name} routes`}
            title="Close region"
            onClick={onClear}
            className="size-10 text-white hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>

      {region.routes.length === 0 ? (
        <div
          className="grid min-h-[8.25rem] place-items-center px-5 text-sm text-white/65"
          role="status"
        >
          No recorded routes in this region.
        </div>
      ) : (
        <div className="px-3 sm:px-5">
          <div
            ref={viewportRef}
            tabIndex={0}
            role="region"
            aria-roledescription="carousel"
            aria-label={`${region.name} recorded routes`}
            onKeyDown={onCarouselKeyDown}
            className="atlas-route-viewport overflow-hidden pb-3 outline-none [touch-action:pan-y_pinch-zoom] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="-ml-3 flex sm:-ml-4">
              {region.routes.map((route, index) => (
                <div key={route.slug} className={ROUTE_CAROUSEL_SLIDE_CLASS}>
                  <RegionalRouteCard
                    route={route}
                    selected={route.slug === effectiveSelectedRoute?.slug}
                    position={index + 1}
                    total={region.routes.length}
                    replayPath={replayPathForRoute(route)}
                    loadThumbnail={thumbnailIndexes.has(index)}
                    onSelect={() => selectRoute(route, index)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function thumbnailIndexesForSlidesInView(
  visibleIndexes: number[],
  routeCount: number,
) {
  const indexes = new Set<number>();
  for (const visibleIndex of visibleIndexes) {
    for (const index of [visibleIndex - 1, visibleIndex, visibleIndex + 1]) {
      if (index >= 0 && index < routeCount) indexes.add(index);
    }
  }
  return indexes;
}

function RegionalRouteCard({
  route,
  selected,
  position,
  total,
  replayPath,
  loadThumbnail,
  onSelect,
}: {
  route: RouteSummary;
  selected: boolean;
  position: number;
  total: number;
  replayPath: string;
  loadThumbnail: boolean;
  onSelect: () => void;
}) {
  const reviewed =
    route.guide.reviewStatus === "reviewed" ||
    route.guide.reviewStatus === "published";
  const trace = useMemo(() => routeTracePolyline(route.trace), [route.trace]);

  return (
    <article
      aria-label={`${route.name}, slide ${position} of ${total}`}
      aria-current={selected ? "true" : undefined}
      data-route-slug={route.slug}
      data-selected={selected}
      className={cn(
        "atlas-route-card relative grid min-w-0 overflow-hidden text-white transition-colors",
        selected ? "is-selected" : "hover:bg-white/[0.03]",
      )}
    >
      <button
        type="button"
        aria-label={`Select ${route.name}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="sr-only">Select {route.name}</span>
      </button>
      <RouteTracePreview
        route={route}
        points={trace}
        selected={selected}
        loadThumbnail={loadThumbnail}
      />
      <div className="atlas-route-summary min-w-0 px-3 py-2">
        <h3 className="truncate text-sm font-medium leading-5 tracking-[-0.01em]">
          {route.name}
        </h3>
        <p className="mt-1 flex items-center gap-2 whitespace-nowrap text-xs text-white/75">
          <span>{route.distanceKm.toFixed(1)} km</span>
          <span>{route.elevationGainM.toLocaleString()} m up</span>
          <span className="inline-flex items-center gap-1">
            {route.type === "Ride" ? <Bike className="size-3" aria-hidden="true" /> : <Footprints className="size-3" aria-hidden="true" />}
            {route.type}
          </span>
        </p>
        <p className="atlas-route-note mt-1 truncate text-xs text-white/55">
          {reviewed ? "Reviewed guide" : "Guide not yet reviewed"}
        </p>
      </div>
      <div className="atlas-route-actions col-span-2 flex items-center justify-between gap-2 border-t border-white/10 px-2">
        <span className="atlas-route-date pl-1 font-mono text-[11px] text-white/60">
          {route.date ? route.date.slice(0, 10) : "Recorded route"}
        </span>
        <div className="flex items-center">
          <Link
            to={`${routeDetailPath(route.slug)}?${replayPath.split("?")[1] ?? ""}`}
            className="relative z-20 inline-flex min-h-11 items-center rounded-lg px-2 text-xs text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Route guide
          </Link>
          <Link
            to={replayPath}
            onClick={(event) => event.stopPropagation()}
            className="atlas-route-replay relative z-20 inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open replay
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function RouteTracePreview({
  route,
  points,
  selected,
  loadThumbnail,
}: {
  route: RouteSummary;
  points: string | null;
  selected: boolean;
  loadThumbnail: boolean;
}) {
  return (
    <div className="atlas-route-preview relative overflow-hidden bg-surface-muted">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:24px_24px]" />
      {points ? (
        <svg
          viewBox={`0 0 ${traceWidth} ${traceHeight}`}
          role="img"
          aria-label={`${route.name} recorded route trace`}
          className="absolute inset-0 size-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <polyline
            points={points}
            fill="none"
            stroke="rgba(24,34,31,0.5)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points}
            fill="none"
            stroke={selected ? "#f5f5f5" : "#b8c4c0"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/55">
          Route trace unavailable
        </div>
      )}
      <RouteSatelliteThumbnail route={route} enabled={loadThumbnail} />
    </div>
  );
}

export function routeTracePolyline(points: RoutePoint[]) {
  const sampled = sampleRoutePoints(validRoutePoints(points));
  if (sampled.length < 2) return null;
  const projected = projectRouteGeometry(sampled);
  const xs = projected.map(({ x }) => x);
  const ys = projected.map(({ y }) => y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const width = Math.max(maximumX - minimumX, 0.00001);
  const height = Math.max(maximumY - minimumY, 0.00001);
  const padding = 12;
  const scale = Math.min(
    (traceWidth - padding * 2) / width,
    (traceHeight - padding * 2) / height,
  );
  const offsetX = (traceWidth - width * scale) / 2;
  const offsetY = (traceHeight - height * scale) / 2;

  return projected
    .map(
      ({ x, y }) =>
        `${(offsetX + (x - minimumX) * scale).toFixed(1)},${(offsetY + (maximumY - y) * scale).toFixed(1)}`,
    )
    .join(" ");
}

interface ElevationGeometry {
  points: string;
  area: string;
  minimum: number;
  maximum: number;
}

export function elevationProfileGeometry(
  points: RoutePoint[],
): ElevationGeometry | null {
  const valid = validRoutePoints(points);
  if (valid.length < 2) return null;
  const sampled = sampleElevationProfile(valid, 120);
  const { minimum, maximum } = elevationRange(valid);
  const elevationSpan = Math.max(1, maximum - minimum);
  const distanceSpan = Math.max(1, sampled.at(-1)!.d - sampled[0].d);
  const rendered = sampled.map((point) => ({
    x: ((point.d - sampled[0].d) / distanceSpan) * profileWidth,
    y:
      profileHeight -
      4 -
      ((point.elev - minimum) / elevationSpan) * (profileHeight - 8),
  }));
  const polyline = rendered
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return {
    points: polyline,
    area: `M 0 ${profileHeight} L ${polyline.replaceAll(",", " ")} L ${profileWidth} ${profileHeight} Z`,
    minimum,
    maximum,
  };
}

function validRoutePoints(points: RoutePoint[]) {
  return points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Number.isFinite(point.elev) &&
      Number.isFinite(point.d) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lng >= -180 &&
      point.lng <= 180,
  );
}
