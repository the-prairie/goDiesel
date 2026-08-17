import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Compass,
  MapPinned,
  Mountain,
  Play,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { replayPath, routeDetailPath } from "@/app/route-paths";
import { useNavigationScrollRegion } from "@/app/navigation-continuity";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import {
  formatRouteDate,
  type QuestRoute,
  type RouteAnnotationEvidence,
  type RouteSummary,
} from "@/domain/route";
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";
import { ElevationProfile } from "@/surfaces/routes/components/route-briefing";
import { RouteGuide } from "@/surfaces/routes/components/route-guide";
import { RouteLeafMap } from "@/surfaces/routes/components/route-leaf-map";
import {
  distanceLabel,
  highestPoint,
  routeStoryChapters,
  routeStoryPremise,
  routeStoryTitle,
  type RouteStoryChapter,
} from "@/surfaces/routes/route-story";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";

const EVIDENCE_LABEL: Record<RouteAnnotationEvidence, string> = {
  recorded: "Recorded",
  derived: "Track derived",
  measured: "Measured",
  hypothesis: "Editorial",
};

export function RouteStoryView({
  route,
  routesPath,
}: {
  route: QuestRoute;
  routesPath: string;
}) {
  const storyRef = useRef<HTMLElement>(null);
  useNavigationScrollRegion("route-story", storyRef);
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const [activeChapter, setActiveChapter] = useState(chapters[0]?.id);
  const heroChapter = chapters.find((chapter) => chapter.media);
  const title = routeStoryTitle(route);
  const premise = routeStoryPremise(route);
  const summit = highestPoint(route);
  const satelliteRoute = useMemo<RouteSummary>(() => ({
    ...route,
    trace: route.route,
    guide: {
      vibe: route.curation.vibe,
      reviewStatus: route.curation.reviewStatus,
    },
  }), [route]);
  const replayHref = singleRouteMicrosite
    ? replayPath(route.slug)
    : replayPath(route.slug, routeDetailPath(route.slug));

  useLayoutEffect(() => {
    storyRef.current?.scrollTo({ behavior: "auto", left: 0, top: 0 });
  }, [route.slug]);

  useEffect(() => {
    const elements = chapters
      .map((chapter) => document.getElementById(`story-${chapter.id}`))
      .filter((element): element is HTMLElement => Boolean(element));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible) setActiveChapter(visible.target.id.replace("story-", ""));
      },
      { threshold: [0.3, 0.55], rootMargin: "-20% 0px -45%" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [chapters]);

  return (
    <article
      ref={storyRef}
      data-navigation-scroll="route-story"
      role="region"
      aria-label="Route story"
      className="h-full overflow-y-auto bg-canvas text-ink motion-safe:scroll-smooth"
    >
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-white/20 bg-[#163b36]/95 px-3 text-white backdrop-blur-md sm:px-5">
        {singleRouteMicrosite ? (
          <span className="text-control font-semibold">goDiesel field story</span>
        ) : (
          <Button asChild variant="ghost" className="text-white hover:bg-white/12 hover:text-white">
            <Link to={routesPath}>
              <ArrowLeft aria-hidden="true" />
              <span className="hidden sm:inline">Route collection</span>
              <span className="sm:hidden">Routes</span>
            </Link>
          </Button>
        )}
        <div className="min-w-0 text-center">
          <p className="text-micro font-semibold uppercase text-white/60">Field story</p>
          <p className="max-w-[42vw] truncate font-editorial text-lg leading-none">{title}</p>
        </div>
        {route.replay.replayEligible ? (
          <Button asChild className="bg-coral text-white hover:bg-coral-hover">
            <Link to={replayHref}>
              <Play aria-hidden="true" />
              <span className="hidden sm:inline">Cinematic replay</span>
              <span className="sm:hidden">Replay</span>
            </Link>
          </Button>
        ) : (
          <Button disabled>
            <Play aria-hidden="true" /> Replay
          </Button>
        )}
      </header>

      <section className="relative flex min-h-[calc(100dvh-10rem)] items-end overflow-hidden bg-[#244f49] text-white md:min-h-[min(46rem,calc(100dvh-6rem))]">
        {heroChapter?.media ? (
          <img
            src={heroChapter.media.url}
            alt={heroChapter.title}
            width={heroChapter.media.width}
            height={heroChapter.media.height}
            className="absolute inset-0 size-full object-cover"
            fetchPriority="high"
          />
        ) : (
          <div data-testid="route-story-satellite-preview" className="absolute inset-0 overflow-hidden bg-[#163b36]">
            <RouteSatelliteThumbnail
              route={satelliteRoute}
              enabled
              cinematic
              showRoute={false}
              imageClassName="planned-route-preview-camera saturate-[0.78] contrast-[1.08] brightness-[0.72]"
            />
            <RouteStoryTrace route={route} distanceM={route.distanceKm * 620} hero overlay />
          </div>
        )}
        <div className="absolute inset-0 bg-[#102c29]/58" aria-hidden="true" />
        <div className="relative z-10 w-full px-5 pb-16 pt-20 sm:px-10 lg:px-[max(4rem,calc((100vw-76rem)/2))]">
          <p className="text-caption font-semibold uppercase text-white/75">
            {route.region} · {formatRouteDate(route.date)}
          </p>
          <h1 className="mt-3 max-w-5xl font-editorial text-5xl font-medium leading-[0.92] sm:text-6xl lg:text-7xl">
            {title}
          </h1>
          <p className="mt-5 text-micro font-semibold uppercase text-[#ffd8e8]">
            Editorial premise
          </p>
          <p className="mt-2 max-w-2xl font-editorial text-xl italic leading-7 text-[#ffd8e8] sm:text-2xl">
            {premise}
          </p>
          <dl className="mt-7 flex flex-wrap gap-x-7 gap-y-3 text-control font-semibold">
            <HeroMetric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
            <HeroMetric label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
          <HeroMetric
            label="Story"
            value={chapters.length ? `${chapters.length} chapters` : "No GPS chapters"}
          />
          </dl>
          <Button
            type="button"
            variant="outline"
            className="mt-8 border-white/55 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => document.getElementById("route-story-intro")?.scrollIntoView()}
          >
            <BookOpen aria-hidden="true" /> Begin the story <ChevronDown aria-hidden="true" />
          </Button>
        </div>
      </section>

      <section
        id="route-story-intro"
        className="grid gap-8 border-b border-line px-5 py-14 sm:px-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)] lg:gap-16 lg:px-[max(4rem,calc((100vw-72rem)/2))] lg:py-20"
      >
        <div>
          <p className="text-caption font-semibold uppercase text-coral">The route memory</p>
          <blockquote className="mt-4 max-w-3xl font-editorial text-3xl leading-tight text-ink sm:text-4xl">
            {route.curation.editorialNote || premise}
          </blockquote>
          <p className="mt-4 text-caption text-ink-muted">
            Editorial context
          </p>
        </div>
        <dl className="grid grid-cols-3 self-center border-y border-line">
          <StoryMetric label="High point" value={summit ? `${Math.round(summit.elevationM)} m` : "Unknown"} />
          <StoryMetric label="Activity" value={route.type} />
          <StoryMetric label="Guide" value={reviewLabel(route.curation.reviewStatus)} />
        </dl>
      </section>

      {chapters.length ? (
        <>
          <StoryChapterRail
            chapters={chapters}
            activeChapter={activeChapter}
            onSelect={(chapter) => {
              setActiveChapter(chapter.id);
              document.getElementById(`story-${chapter.id}`)?.scrollIntoView({
                behavior: prefersReducedMotion() ? "auto" : "smooth",
                block: "center",
              });
            }}
          />

          <section aria-label="Route story chapters" className="mx-auto grid max-w-7xl gap-24 px-5 py-20 sm:px-10 lg:gap-32 lg:py-28">
            {chapters.map((chapter, index) => (
              <StoryChapter
                key={chapter.id}
                route={route}
                chapter={chapter}
                index={index}
                reverse={index % 2 === 1}
              />
            ))}
          </section>
        </>
      ) : (
        <section aria-label="Route story chapters" className="mx-auto max-w-3xl px-5 py-16 sm:px-10">
          <p role="status" className="border-y border-line py-8 font-editorial text-2xl text-ink-secondary">
            Story chapters need recorded GPS geometry. The activity summary and factual guide remain available below.
          </p>
        </section>
      )}

      <section aria-labelledby="recorded-line-heading" className="bg-[#dfe9e4] px-5 py-16 sm:px-10 lg:px-[max(4rem,calc((100vw-78rem)/2))] lg:py-24">
        <div className="mb-8 max-w-2xl">
          <p className="text-caption font-semibold uppercase text-forest">Recorded geography</p>
          <h2 id="recorded-line-heading" className="mt-2 font-editorial text-4xl sm:text-5xl">
            The line underneath the story.
          </h2>
          <p className="mt-3 text-body leading-7 text-ink-secondary">
            Explore the actual route, then open the factual briefing for terrain, guidance, and conditions.
          </p>
        </div>
        <div className="grid overflow-hidden border border-line bg-surface shadow-panel lg:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
          <div className="h-[28rem] min-h-0 lg:h-[42rem] [&>section]:h-full">
            <RouteLeafMap route={route} />
          </div>
          <aside aria-label="Factual route briefing" className="min-w-0 border-t border-line p-5 lg:max-h-[42rem] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-7">
            <div className="border-b border-line pb-6">
              <p className="text-caption font-semibold uppercase text-cobalt">Terrain profile</p>
              {route.route.length > 1 ? (
                <div className="mt-3 overflow-hidden border border-line bg-surface-muted">
                  <ElevationProfile route={route} />
                </div>
              ) : (
                <p role="status" className="mt-3 text-control text-ink-muted">
                  Elevation profile unavailable. Climb distribution needs recorded route points.
                </p>
              )}
            </div>
            <div className="pt-6">
              <RouteGuide curation={route.curation} compact />
            </div>
          </aside>
        </div>
      </section>

      <section className="grid items-center gap-8 bg-[#163b36] px-5 py-16 text-white sm:px-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-[max(4rem,calc((100vw-72rem)/2))] lg:py-24">
        <div>
          <p className="text-caption font-semibold uppercase text-[#ffd0e3]">Leave the page behind</p>
          <h2 className="mt-3 font-editorial text-4xl sm:text-5xl">Fly the route as it happened.</h2>
          <p className="mt-4 max-w-2xl text-body leading-7 text-white/70">
            Follow the recorded line through terrain, time, elevation, and the chapters of the day.
          </p>
        </div>
        {route.replay.replayEligible ? (
          <Button asChild size="lg" className="bg-coral text-white hover:bg-coral-hover">
            <Link to={replayHref}>
              <Compass aria-hidden="true" /> Enter cinematic replay <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button disabled size="lg">
            <Compass aria-hidden="true" /> Replay unavailable
          </Button>
        )}
      </section>
    </article>
  );
}

function StoryChapter({
  route,
  chapter,
  index,
  reverse,
}: {
  route: QuestRoute;
  chapter: RouteStoryChapter;
  index: number;
  reverse: boolean;
}) {
  return (
    <section
      id={`story-${chapter.id}`}
      className="grid scroll-mt-36 items-center gap-8 lg:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.88fr)] lg:gap-16"
    >
      <figure className={cn("relative overflow-hidden border border-line bg-surface-muted shadow-panel", reverse && "lg:order-2")}>
        {chapter.media ? (
          <img
            src={chapter.media.url}
            alt={chapter.title}
            width={chapter.media.width}
            height={chapter.media.height}
            loading="lazy"
            className="aspect-[4/3] size-full object-cover"
          />
        ) : (
          <RouteStoryTrace route={route} distanceM={chapter.distanceM} />
        )}
        <span className="absolute left-4 top-4 grid size-11 place-items-center rounded-full border border-white/70 bg-[#163b36]/70 text-control font-semibold text-white backdrop-blur">
          {String(index + 1).padStart(2, "0")}
        </span>
      </figure>
      <div className="max-w-xl">
        <p className="text-caption font-semibold uppercase text-coral">
          {String(index + 1).padStart(2, "0")} · {EVIDENCE_LABEL[chapter.evidence]}
        </p>
        <h2 className="mt-3 font-editorial text-4xl leading-none sm:text-5xl">{chapter.title}</h2>
        <p className="mt-5 font-editorial text-xl leading-8 text-ink-secondary">{chapter.body}</p>
        <div className="mt-6 flex flex-wrap gap-5 border-t border-line pt-4 text-control font-semibold text-ink">
          <span className="inline-flex items-center gap-2">
            <MapPinned className="size-4 text-cobalt" aria-hidden="true" />
            {distanceLabel(chapter.distanceM)}
          </span>
          {chapter.elevationM === undefined ? null : (
            <span className="inline-flex items-center gap-2">
              <Mountain className="size-4 text-cobalt" aria-hidden="true" />
              {Math.round(chapter.elevationM).toLocaleString()} m
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function StoryChapterRail({
  chapters,
  activeChapter,
  onSelect,
}: {
  chapters: RouteStoryChapter[];
  activeChapter?: string;
  onSelect: (chapter: RouteStoryChapter) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    active?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeChapter]);

  return (
    <nav aria-label="Story chapters" className="sticky top-14 z-30 border-b border-line bg-surface/96 backdrop-blur-md">
      <div ref={railRef} className="mx-auto flex max-w-7xl items-stretch overflow-x-auto px-3 sm:px-6">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            type="button"
            aria-current={activeChapter === chapter.id ? "step" : undefined}
            onClick={() => onSelect(chapter)}
            className={cn(
              "relative flex min-h-20 min-w-[12rem] flex-1 items-center gap-3 border-b-2 border-l border-line px-3 text-left outline-none transition-colors first:border-l-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-route",
              activeChapter === chapter.id
                ? "border-coral bg-surface-muted text-ink"
                : "border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            {chapter.media ? (
              <img
                src={chapter.media.url}
                alt=""
                width={chapter.media.width}
                height={chapter.media.height}
                className="size-11 shrink-0 object-cover"
              />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center border border-line bg-surface text-micro font-semibold text-coral">
                {String(index + 1).padStart(2, "0")}
              </span>
            )}
            <span className="min-w-0">
              <span className="block text-micro font-semibold uppercase text-coral">
                {EVIDENCE_LABEL[chapter.evidence]}
              </span>
              <span className="mt-1 line-clamp-2 block text-caption font-semibold leading-4">
                {chapter.title}
              </span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function RouteStoryTrace({
  route,
  distanceM,
  hero = false,
  overlay = false,
}: {
  route: QuestRoute;
  distanceM: number;
  hero?: boolean;
  overlay?: boolean;
}) {
  const trace = routeTrace(route);
  if (!trace) {
    return (
      <div className="grid aspect-[4/3] place-items-center p-6 text-center text-control text-ink-muted">
        Recorded route geometry unavailable
      </div>
    );
  }
  const point = trace.points.reduce((closest, candidate) =>
    Math.abs(candidate.distanceM - distanceM) < Math.abs(closest.distanceM - distanceM)
      ? candidate
      : closest,
  );

  return (
    <svg
      viewBox="0 0 800 600"
      role="img"
      aria-label={`${route.name} route trace at ${distanceLabel(distanceM)}`}
      className={cn(
        "aspect-[4/3] size-full",
        hero ? "text-white" : "text-cobalt",
        overlay && "absolute inset-0 z-[2]",
      )}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width="800" height="600" fill={overlay ? "transparent" : hero ? "#244f49" : "#e7ece8"} />
      <path d={trace.path} fill="none" stroke={hero ? "rgb(255 255 255 / 38%)" : "#ffffff"} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d={trace.path} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={point.x} cy={point.y} r="17" fill="#d95737" stroke="#fff" strokeWidth="7" />
    </svg>
  );
}

function routeTrace(route: QuestRoute) {
  if (route.route.length < 2) return undefined;
  const lngs = route.route.map((point) => point.lng);
  const lats = route.route.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = Math.max(maxLng - minLng, 0.00001);
  const height = Math.max(maxLat - minLat, 0.00001);
  const scale = Math.min(680 / width, 480 / height);
  const offsetX = (800 - width * scale) / 2;
  const offsetY = (600 - height * scale) / 2;
  const points = route.route.map((point) => ({
    x: offsetX + (point.lng - minLng) * scale,
    y: offsetY + (maxLat - point.lat) * scale,
    distanceM: point.d,
  }));
  return {
    points,
    path: points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "),
  };
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-white/60">{label}</dt>
      <dd className="mt-1 text-control text-white">{value}</dd>
    </div>
  );
}

function StoryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-line px-3 py-4 last:border-r-0">
      <dt className="text-micro uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words font-editorial text-lg leading-snug text-ink">
        {value}
      </dd>
    </div>
  );
}

function reviewLabel(status: QuestRoute["curation"]["reviewStatus"]) {
  if (status === "published") return "Published";
  if (status === "reviewed") return "Reviewed";
  return "Guide not yet reviewed";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
