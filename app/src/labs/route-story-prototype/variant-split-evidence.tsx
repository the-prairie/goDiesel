import {
  ArrowDown,
  ArrowRight,
  MapPinned,
  Mountain,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { replayPath, routeDetailPath } from "@/app/route-paths";
import {
  distanceLabel,
  highestPoint,
  routeStoryChapters,
} from "@/surfaces/routes/route-story";
import { cn } from "@/ui/utils";
import {
  EVIDENCE_LABEL,
  PrototypeHeader,
  PrototypeMetrics,
  PrototypeTerrain,
  prototypePremise,
  RouteChapterNodes,
  RouteIdentity,
  type RouteStoryPrototypeProps,
} from "@/labs/route-story-prototype/prototype-shared";

export function SplitEvidencePrototype({
  route,
  routesPath,
}: RouteStoryPrototypeProps) {
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const [activeIndex, setActiveIndex] = useState(0);
  const storyRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const totalDistanceM = Math.max(route.distanceKm * 1_000, 1);
  const activeChapter = chapters[activeIndex];
  const progress = activeChapter
    ? Math.min(1, activeChapter.distanceM / totalDistanceM)
    : 0;

  useEffect(() => {
    const root = storyRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible) return;
        const nextIndex = Number((visible.target as HTMLElement).dataset.chapterIndex);
        if (Number.isFinite(nextIndex)) setActiveIndex(nextIndex);
      },
      {
        root,
        rootMargin: "-18% 0px -42%",
        threshold: [0.25, 0.5, 0.75],
      },
    );
    chapterRefs.current.forEach((chapter) => {
      if (chapter) observer.observe(chapter);
    });
    return () => observer.disconnect();
  }, [chapters]);

  function selectChapter(index: number) {
    setActiveIndex(index);
    chapterRefs.current[index]?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      <PrototypeHeader
        route={route}
        routesPath={routesPath}
        concept="Split evidence"
      />

      <div className="grid min-h-0 flex-1 grid-rows-[36svh_minmax(0,1fr)] lg:grid-cols-[58%_42%] lg:grid-rows-1">
        <PrototypeTerrain
          route={route}
          progress={progress}
          className="sticky top-0 h-[36svh] min-h-0 lg:relative lg:h-full"
          routeClassName="opacity-95"
        >
          <div className="pointer-events-none absolute inset-0 z-[3] bg-[#0e2d29]/20" />
          <RouteChapterNodes
            route={route}
            activeIndex={activeIndex}
            onSelect={selectChapter}
          />
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex items-end justify-between gap-4 text-white sm:inset-x-6 sm:bottom-6">
            <div className="min-w-0 border-l border-white/55 pl-3">
              <p className="text-micro font-semibold uppercase text-white/60">
                Measured terrain · Recorded GPS
              </p>
              <p className="mt-1 truncate font-editorial text-xl sm:text-2xl">
                {activeChapter?.title ?? route.region}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-micro uppercase text-white/55">Position</p>
              <p className="mt-1 text-control font-semibold tabular-nums">
                {activeChapter ? distanceLabel(activeChapter.distanceM) : "Start"}
              </p>
            </div>
          </div>
        </PrototypeTerrain>

        <div
          ref={storyRef}
          data-testid="split-evidence-story-pane"
          className="min-h-0 overflow-y-auto border-t border-line bg-canvas lg:border-l lg:border-t-0"
        >
          <section className="flex min-h-full flex-col justify-between px-5 py-10 sm:px-9 sm:py-12 xl:px-14 xl:py-16">
            <div>
              <p className="mb-7 text-micro font-semibold uppercase text-forest">
                Recorded route · Field evidence
              </p>
              <RouteIdentity route={route} />
            </div>
            <div className="mt-14">
              <PrototypeMetrics route={route} />
              {chapters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => selectChapter(0)}
                  className="mt-7 inline-flex min-h-11 items-center gap-2 text-control font-semibold text-forest outline-none focus-visible:ring-2 focus-visible:ring-route"
                >
                  Begin at the line <ArrowDown aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </div>
          </section>

          <section className="border-y border-line px-5 py-14 sm:px-9 xl:px-14 xl:py-20">
            <p className="text-micro font-semibold uppercase text-coral">
              {route.curation.editorialNote ? "Editorial context" : prototypePremise(route).label}
            </p>
            <blockquote className="mt-5 max-w-[22ch] font-editorial text-3xl leading-tight sm:text-4xl">
              {route.curation.editorialNote || prototypePremise(route).text}
            </blockquote>
            <p className="mt-5 max-w-xl text-control leading-6 text-ink-muted">
              Interpretation is kept beside the recorded line, never presented as source truth.
            </p>
          </section>

          {chapters.length ? (
            <div aria-label="Route story chapters">
              {chapters.map((chapter, index) => (
                <section
                  key={chapter.id}
                  ref={(element) => {
                    chapterRefs.current[index] = element;
                  }}
                  data-chapter-index={index}
                  aria-current={activeIndex === index ? "step" : undefined}
                  className={cn(
                    "flex min-h-[72%] scroll-mt-10 flex-col justify-center border-b border-line px-5 py-16 sm:px-9 xl:px-14 xl:py-24",
                    activeIndex === index && "bg-surface-muted/45",
                  )}
                >
                  <div className="flex items-center justify-between gap-6 border-b border-line pb-4">
                    <p className="text-micro font-semibold uppercase text-coral">
                      {String(index + 1).padStart(2, "0")} · {EVIDENCE_LABEL[chapter.evidence]}
                    </p>
                    <p className="text-micro font-semibold tabular-nums text-ink-muted">
                      {distanceLabel(chapter.distanceM)}
                    </p>
                  </div>
                  {chapter.media ? (
                    <figure className="-mx-5 mt-7 sm:-mx-9 xl:-mx-14">
                      <img
                        src={chapter.media.url}
                        alt={chapter.title}
                        width={chapter.media.width}
                        height={chapter.media.height}
                        loading="lazy"
                        className="aspect-[16/9] w-full object-cover"
                      />
                    </figure>
                  ) : null}
                  <h2 className="mt-8 max-w-[14ch] font-editorial text-4xl leading-[0.98] sm:text-5xl">
                    {chapter.title}
                  </h2>
                  <p className="mt-5 max-w-[46ch] font-editorial text-xl leading-8 text-ink-secondary">
                    {chapter.body}
                  </p>
                  <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-4 text-control font-semibold">
                    <span className="inline-flex items-center gap-2">
                      <MapPinned aria-hidden="true" className="size-4 text-cobalt" />
                      {distanceLabel(chapter.distanceM)}
                    </span>
                    {chapter.elevationM === undefined ? null : (
                      <span className="inline-flex items-center gap-2">
                        <Mountain aria-hidden="true" className="size-4 text-cobalt" />
                        {Math.round(chapter.elevationM).toLocaleString()} m
                      </span>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="border-b border-line px-5 py-16 sm:px-9 xl:px-14">
              <p role="status" className="font-editorial text-2xl text-ink-secondary">
                Story chapters need recorded GPS geometry. The factual activity evidence remains available.
              </p>
            </section>
          )}

          <EvidenceLedger route={route} />

          <section className="bg-[#123b35] px-5 py-16 text-white sm:px-9 xl:px-14 xl:py-20">
            <p className="text-micro font-semibold uppercase text-[#ffd2e4]">
              The natural continuation
            </p>
            <h2 className="mt-4 max-w-[14ch] font-editorial text-4xl leading-none sm:text-5xl">
              Continue through the terrain.
            </h2>
            <p className="mt-5 max-w-lg text-body leading-7 text-white/70">
              Replay follows the recorded line through terrain, distance, elevation, and the chapters of the day.
            </p>
            {route.replay.replayEligible ? (
              <Link
                to={replayPath(route.slug, routeDetailPath(route.slug))}
                className="mt-9 inline-flex min-h-11 items-center gap-2 bg-canvas px-4 text-control font-semibold text-forest outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Play aria-hidden="true" className="size-4" />
                Enter cinematic replay
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : (
              <p className="mt-8 text-control text-white/65">Replay unavailable for this geometry.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function EvidenceLedger({ route }: { route: RouteStoryPrototypeProps["route"] }) {
  const summit = highestPoint(route);
  const guideStatus = route.curation.reviewStatus === "draft"
    ? "Guide not yet reviewed"
    : route.curation.reviewStatus === "published"
      ? "Published"
      : "Reviewed";
  const evidence = [
    ["Distance", `${route.distanceKm.toFixed(1)} km`, "Recorded"],
    ["Climb", `${route.elevationGainM.toLocaleString()} m`, "Recorded"],
    ["High point", summit ? `${Math.round(summit.elevationM).toLocaleString()} m` : "Unavailable", "Track derived"],
    ["Activity", route.type, "Recorded"],
  ];

  return (
    <section aria-labelledby="split-evidence-ledger" className="px-5 py-16 sm:px-9 xl:px-14 xl:py-20">
      <p className="text-micro font-semibold uppercase text-forest">Field evidence</p>
      <h2 id="split-evidence-ledger" className="mt-3 font-editorial text-4xl leading-none sm:text-5xl">
        What the recording can prove.
      </h2>
      <dl className="mt-10 border-t border-line">
        {evidence.map(([label, value, provenance]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-6 border-b border-line py-5">
            <div>
              <dt className="text-micro font-semibold uppercase text-ink-muted">{label}</dt>
              <dd className="mt-1 font-editorial text-2xl">{value}</dd>
            </div>
            <span className="text-micro font-semibold uppercase text-cobalt">{provenance}</span>
          </div>
        ))}
      </dl>
      <div className="mt-8 border-l border-coral pl-4">
        <p className="text-micro font-semibold uppercase text-coral">Editorial guide</p>
        <p className="mt-2 font-editorial text-xl text-ink-secondary">{guideStatus}</p>
      </div>
    </section>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
