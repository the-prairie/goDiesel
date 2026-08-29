import {
  ArrowRight,
  Bike,
  ChevronLeft,
  ChevronRight,
  Footprints,
  Globe2,
  Mountain,
  Route,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "react-router-dom";

import { Button } from "@/ui/button";
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";
import type { RouteRegion } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/route";
import {
  elevationRange,
  projectRouteGeometry,
  sampleElevationProfile,
  sampleRoutePoints,
} from "@/domain/geometry/route-visualization";
import { cn } from "@/ui/utils";
import type { AtlasLens } from "@/surfaces/atlas/atlas-regional-view";
import { deriveRouteTerrainDistinction } from "@/surfaces/atlas/atlas-regional-view";

export const ROUTE_CAROUSEL_SLIDE_CLASS =
  "min-w-0 flex-[0_0_84%] pl-3 sm:basis-[44%] sm:pl-4 xl:basis-[calc((100%-2rem)/3)]";

interface RegionRouteCarouselProps {
  region: RouteRegion;
  selectedRoute?: RouteSummary;
  onSelectRoute: (route: RouteSummary) => void;
  onPreviewRoute: (route?: RouteSummary) => void;
  onClear: () => void;
  replayPathForRoute: (route: RouteSummary) => string;
  presentationReady: boolean;
  lens: AtlasLens;
  onLensChange: (lens: AtlasLens) => void;
}

const traceWidth = 360;
const traceHeight = 112;
const profileWidth = 360;
const profileHeight = 62;

export function RegionRouteCarousel({
  region,
  selectedRoute,
  onSelectRoute,
  onPreviewRoute,
  onClear,
  replayPathForRoute,
  presentationReady,
  lens,
  onLensChange,
}: RegionRouteCarouselProps) {
  const effectiveSelectedRoute = selectedRoute ?? region.routes[0];
  const selectedIndex = Math.max(
    0,
    region.routes.findIndex(
      (route) => route.slug === effectiveSelectedRoute?.slug,
    ),
  );
  const [viewportRef, emblaApi] = useEmblaCarousel({
    align: "center",
    containScroll: false,
    dragFree: false,
    loop: false,
    skipSnaps: false,
    slidesToScroll: 1,
    startIndex: selectedIndex,
  });
  const [thumbnailIndexes, setThumbnailIndexes] = useState(() =>
    thumbnailIndexesForSlidesInView([selectedIndex], region.routes.length),
  );
  const [hoveredRoute, setHoveredRoute] = useState<RouteSummary>();
  const [focusedRoute, setFocusedRoute] = useState<RouteSummary>();
  const programmaticSelectionRef = useRef<string | undefined>(undefined);
  const commitCenteredRoute = useCallback(() => {
    if (!emblaApi) return;
    const route = region.routes[emblaApi.selectedScrollSnap()];
    if (route?.slug === programmaticSelectionRef.current) {
      programmaticSelectionRef.current = undefined;
      return;
    }
    if (route && route.slug !== effectiveSelectedRoute?.slug) onSelectRoute(route);
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
    if (index >= 0 && index !== emblaApi.selectedScrollSnap()) emblaApi.scrollTo(index);
  }, [effectiveSelectedRoute, emblaApi, region.routes]);

  useEffect(() => {
    onPreviewRoute(hoveredRoute ?? focusedRoute);
  }, [focusedRoute, hoveredRoute, onPreviewRoute]);

  useEffect(
    () => () => onPreviewRoute(undefined),
    [onPreviewRoute],
  );

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
        className="min-h-[9rem] border-t border-white/15 bg-[#07151c]/92 text-white backdrop-blur-sm"
      >
        <div className="mx-auto flex min-h-[9rem] max-w-[96rem] items-center gap-4 px-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-editorial text-xl font-semibold uppercase sm:text-2xl">
              {region.name}
            </p>
            <p role="status" aria-live="polite" className="mt-1 text-sm text-white/65">
              Fitting recorded routes to the terrain
            </p>
          </div>
          <div className="hidden w-[min(34rem,45vw)] grid-cols-3 gap-2 sm:grid" aria-hidden="true">
            <span className="h-16 animate-pulse rounded-sm bg-white/10" />
            <span className="h-16 animate-pulse rounded-sm bg-white/10" />
            <span className="h-16 animate-pulse rounded-sm bg-white/10" />
          </div>
        </div>
      </section>
    );
  }

  const hasMultipleRoutes = region.routes.length > 1;
  const canSelectPrevious = hasMultipleRoutes && selectedIndex > 0;
  const canSelectNext = hasMultipleRoutes && selectedIndex < region.routes.length - 1;
  const currentPosition = region.routes.length === 0 ? 0 : selectedIndex + 1;

  return (
    <section
      aria-label={`${region.name} routes`}
      className="min-h-[23rem] overflow-hidden border-t border-white/15 bg-[#07151c]/92 text-white backdrop-blur-sm sm:min-h-[22rem] [@media(max-height:500px)]:min-h-[13rem]"
    >
      <header className="mx-auto flex max-w-[96rem] items-center justify-between gap-3 px-3 py-3 sm:px-5 [@media(max-height:500px)]:py-1">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-editorial text-xl font-semibold uppercase sm:text-2xl">
            {region.name}
          </h2>
          <p className="flex flex-wrap gap-x-1 text-xs leading-4 text-white/65 sm:block sm:truncate sm:text-sm">
            <span>{region.routes.length} routes · {region.totalKm.toFixed(0)} km</span>
            <span>
              <span className="hidden sm:inline">· </span>
              {Math.round(region.totalClimbM).toLocaleString()} m climbed
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 hidden items-center rounded-sm border border-white/25 p-0.5 sm:flex" aria-label="Region lens">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Show routes"
              aria-pressed={lens === "routes"}
              onClick={() => onLensChange("routes")}
              className="h-11 rounded-md px-2 text-white hover:bg-white/10 hover:text-white aria-pressed:bg-[#f6f2e8] aria-pressed:text-[#24322d]"
            >
              <Route aria-hidden="true" /> Routes
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Explore terrain"
              aria-pressed={lens === "terrain"}
              onClick={() => onLensChange("terrain")}
              className="h-11 rounded-md px-2 text-white hover:bg-white/10 hover:text-white aria-pressed:bg-[#f6f2e8] aria-pressed:text-[#24322d]"
            >
              <Mountain aria-hidden="true" /> Terrain
            </Button>
          </div>
          <span className="mr-1 min-w-12 text-right text-xs tabular-nums text-white/65" aria-live="polite">
            {currentPosition} of {region.routes.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous route"
            title="Previous route"
            disabled={!canSelectPrevious}
            onClick={() => selectRouteAt(selectedIndex - 1)}
            className="size-11 rounded-md border border-white/35 text-white hover:bg-white/10 hover:text-white disabled:opacity-35"
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
            className="size-11 rounded-md border border-white/35 text-white hover:bg-white/10 hover:text-white disabled:opacity-35"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="All places"
            title="Return to all places"
            onClick={onClear}
            className="h-11 rounded-md border border-white/25 px-2 text-white hover:bg-white/10 hover:text-white"
          >
            <Globe2 aria-hidden="true" />
            <span className="hidden md:inline">All places</span>
          </Button>
        </div>
      </header>

      <div className="flex px-3 pb-2 sm:hidden">
        <div className="grid w-full grid-cols-2 rounded-sm border border-white/25 p-0.5" aria-label="Region lens">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Show routes"
            aria-pressed={lens === "routes"}
            onClick={() => onLensChange("routes")}
            className="rounded-sm text-white hover:bg-white/10 hover:text-white aria-pressed:bg-[#f6f2e8] aria-pressed:text-[#24322d]"
          >
            <Route aria-hidden="true" /> Routes
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Explore terrain"
            aria-pressed={lens === "terrain"}
            onClick={() => onLensChange("terrain")}
            className="rounded-sm text-white hover:bg-white/10 hover:text-white aria-pressed:bg-[#f6f2e8] aria-pressed:text-[#24322d]"
          >
            <Mountain aria-hidden="true" /> Terrain
          </Button>
        </div>
      </div>

      {region.routes.length === 0 ? (
        <div className="grid min-h-[17rem] place-items-center px-5 text-sm text-white/65" role="status">
          No recorded routes in this region.
        </div>
      ) : (
        <div
          ref={viewportRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${region.name} recorded routes`}
          onKeyDown={onCarouselKeyDown}
          className="overflow-hidden pb-4 outline-none [touch-action:pan-y_pinch-zoom] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#63d6cf] [@media(max-height:500px)]:pb-2"
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
                  onHover={(previewed) => setHoveredRoute(previewed ? route : undefined)}
                  onFocus={(focused) => setFocusedRoute(focused ? route : undefined)}
                />
              </div>
            ))}
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
  onHover,
  onFocus,
}: {
  route: RouteSummary;
  selected: boolean;
  position: number;
  total: number;
  replayPath: string;
  loadThumbnail: boolean;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  onFocus: (focused: boolean) => void;
}) {
  const reviewed =
    route.guide.reviewStatus === "reviewed" || route.guide.reviewStatus === "published";
  const trace = useMemo(() => routeTracePolyline(route.trace), [route.trace]);
  const profile = useMemo(() => elevationProfileGeometry(route.trace), [route.trace]);
  const terrainDistinction = useMemo(
    () => deriveRouteTerrainDistinction(route),
    [route],
  );

  return (
    <article
      aria-label={`${route.name}, slide ${position} of ${total}`}
      aria-current={selected ? "true" : undefined}
      data-route-slug={route.slug}
      data-selected={selected}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocusCapture={() => onFocus(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onFocus(false);
        }
      }}
      className={cn(
        "relative grid h-[17rem] min-w-0 grid-rows-[7rem_minmax(0,1fr)_3.75rem] overflow-hidden rounded-md border bg-[#0b2029] text-white shadow-sm transition-[border-color,opacity] [@media(max-height:500px)]:h-[9rem] [@media(max-height:500px)]:grid-rows-[3rem_minmax(0,1fr)_2.5rem]",
        selected
          ? "border-[#ff6b4a] before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 before:bg-[#ff6b4a]"
          : "border-white/20 opacity-75 hover:opacity-100",
      )}
    >
      <button
        type="button"
        aria-label={`Select ${route.name}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 z-10 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#63d6cf]"
      >
        <span className="sr-only">Select {route.name}</span>
      </button>
      <RouteTracePreview
        route={route}
        points={trace}
        selected={selected}
        loadThumbnail={loadThumbnail}
      />
      <div className="min-w-0 px-4 py-3 [@media(max-height:500px)]:py-1">
        <h3 className="truncate font-editorial text-xl font-semibold leading-6 [@media(max-height:500px)]:text-base [@media(max-height:500px)]:leading-5">{route.name}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-white/72">
          <span>{route.distanceKm.toFixed(1)} km</span>
          <span>{route.elevationGainM.toLocaleString()} m climb</span>
          <span className="inline-flex items-center gap-1">
            {route.type === "Ride" ? <Bike className="size-3.5" aria-hidden="true" /> : <Footprints className="size-3.5" aria-hidden="true" />}
            {route.type}
          </span>
        </p>
        <p className="mt-2 line-clamp-2 text-xs leading-4 text-white/65 [@media(max-height:500px)]:hidden">
          {terrainDistinction ? (
            <span
              className="mr-2 inline-flex items-center gap-1 font-medium text-[#9be7e1]"
              title="Derived from recorded elevation samples"
            >
              <Mountain className="size-3.5" aria-hidden="true" />
              {Math.round(terrainDistinction.valueM).toLocaleString()} m {terrainDistinction.label.toLowerCase()}
            </span>
          ) : null}
          {reviewed && route.guide.vibe ? route.guide.vibe : "Guide not yet reviewed"}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-white/10 px-3 py-2 [@media(max-height:500px)]:py-0">
        <ElevationProfilePreview route={route} geometry={profile} />
        <Link
          to={replayPath}
          onClick={(event) => event.stopPropagation()}
          className="relative z-20 inline-flex min-h-11 items-center gap-1.5 self-center whitespace-nowrap px-2 text-sm font-medium text-[#ff8065] outline-none hover:text-[#ff9a83] focus-visible:ring-2 focus-visible:ring-[#63d6cf]"
        >
          Open route
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
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
    <div className="relative overflow-hidden bg-[#102b33]">
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:24px_24px]" />
      {points ? (
        <svg viewBox={`0 0 ${traceWidth} ${traceHeight}`} role="img" aria-label={`${route.name} recorded route trace`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet">
          <polyline points={points} fill="none" stroke="rgba(3,12,17,0.8)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <polyline points={points} fill="none" stroke={selected ? "#ff6b4a" : "#63d6cf"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/55">Route trace unavailable</div>
      )}
      <RouteSatelliteThumbnail route={route} enabled={loadThumbnail} />
    </div>
  );
}

function ElevationProfilePreview({ route, geometry }: { route: RouteSummary; geometry: ElevationGeometry | null }) {
  if (!geometry) {
    return <span className="self-center text-xs text-white/45">Elevation unavailable</span>;
  }

  return (
    <svg viewBox={`0 0 ${profileWidth} ${profileHeight}`} role="img" aria-label={`${route.name} elevation profile, ${Math.round(geometry.minimum)} to ${Math.round(geometry.maximum)} metres`} className="h-10 min-w-0 w-full" preserveAspectRatio="none">
      <path d={geometry.area} fill="rgba(99,214,207,0.12)" />
      <polyline points={geometry.points} fill="none" stroke="#63d6cf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
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
  const padding = 18;
  const scale = Math.min((traceWidth - padding * 2) / width, (traceHeight - padding * 2) / height);
  const offsetX = (traceWidth - width * scale) / 2;
  const offsetY = (traceHeight - height * scale) / 2;

  return projected
    .map(({ x, y }) => `${(offsetX + (x - minimumX) * scale).toFixed(1)},${(offsetY + (maximumY - y) * scale).toFixed(1)}`)
    .join(" ");
}

interface ElevationGeometry {
  points: string;
  area: string;
  minimum: number;
  maximum: number;
}

export function elevationProfileGeometry(points: RoutePoint[]): ElevationGeometry | null {
  const valid = validRoutePoints(points);
  if (valid.length < 2) return null;
  const sampled = sampleElevationProfile(valid, 120);
  const { minimum, maximum } = elevationRange(valid);
  const elevationSpan = Math.max(1, maximum - minimum);
  const distanceSpan = Math.max(1, sampled.at(-1)!.d - sampled[0].d);
  const rendered = sampled.map((point) => ({
    x: ((point.d - sampled[0].d) / distanceSpan) * profileWidth,
    y: profileHeight - 4 - ((point.elev - minimum) / elevationSpan) * (profileHeight - 8),
  }));
  const polyline = rendered.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

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
