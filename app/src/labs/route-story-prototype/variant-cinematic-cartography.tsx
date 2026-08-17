import { ArrowRight, BookOpen, MapPinned, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { replayPath, routeDetailPath } from "@/app/route-paths";
import {
  EVIDENCE_LABEL,
  PrototypeHeader,
  PrototypeMetrics,
  PrototypeTerrain,
  RouteIdentity,
  type RouteStoryPrototypeProps,
} from "@/labs/route-story-prototype/prototype-shared";
import {
  distanceLabel,
  routeStoryChapters,
} from "@/surfaces/routes/route-story";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import { cn } from "@/ui/utils";

const ARRIVAL_DELAY_MS = 80;
const REPLAY_REVEAL_MS = 720;

export function CinematicCartographyPrototype({
  route,
  routesPath,
}: RouteStoryPrototypeProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [arrived, setArrived] = useState(reducedMotion);
  const [revealingReplay, setRevealingReplay] = useState(false);
  const replayTimer = useRef<number | undefined>(undefined);
  const activeChapter = chapters[activeIndex] ?? chapters[0];
  const replayHref = replayPath(route.slug, routeDetailPath(route.slug));
  const routeDistanceM = Math.max(route.distanceKm * 1_000, 1);
  const chapterProgress = activeChapter
    ? Math.max(0.025, Math.min(activeChapter.distanceM / routeDistanceM, 1))
    : 0.025;
  const visibleProgress = revealingReplay ? 1 : arrived ? chapterProgress : 0.015;
  const terrainPosition = [
    "translate-x-0 translate-y-0",
    "-translate-x-[0.8%] translate-y-[0.4%]",
    "translate-x-[0.6%] -translate-y-[0.5%]",
    "-translate-x-[0.35%] -translate-y-[0.75%]",
  ][activeIndex % 4];

  useEffect(() => {
    if (reducedMotion) {
      setArrived(true);
      return;
    }
    setArrived(false);
    const arrivalTimer = window.setTimeout(() => setArrived(true), ARRIVAL_DELAY_MS);
    return () => window.clearTimeout(arrivalTimer);
  }, [reducedMotion, route.slug]);

  useEffect(
    () => () => {
      if (replayTimer.current !== undefined) window.clearTimeout(replayTimer.current);
    },
    [],
  );

  const beginReplay = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (reducedMotion || revealingReplay || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setRevealingReplay(true);
    replayTimer.current = window.setTimeout(() => {
      navigate(replayHref);
    }, REPLAY_REVEAL_MS);
  };

  const selectChapter = (index: number) => {
    if (revealingReplay) return;
    setArrived(true);
    setActiveIndex(index);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#102a27] text-white">
      <PrototypeHeader
        route={route}
        routesPath={routesPath}
        concept="Cinematic cartography"
      />

      <section
        aria-label="Cinematic route story"
        className="relative min-h-0 flex-1 overflow-hidden bg-[#102a27]"
        data-arrived={arrived ? "true" : "false"}
        data-revealing-replay={revealingReplay ? "true" : "false"}
      >
        <div
          className={cn(
            "absolute -inset-3 transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none",
            arrived ? cn("scale-100 opacity-100", terrainPosition) : "translate-y-3 scale-[1.025] opacity-80",
            revealingReplay && "scale-[1.035] opacity-90",
          )}
        >
          <PrototypeTerrain
            route={route}
            progress={visibleProgress}
            className="size-full"
            routeClassName={cn(
              "opacity-90 transition-opacity duration-500 motion-reduce:transition-none",
              "[&>path:nth-of-type(3)]:transition-all [&>path:nth-of-type(3)]:duration-700 [&>path:nth-of-type(3)]:ease-out motion-reduce:[&>path:nth-of-type(3)]:transition-none",
              revealingReplay && "opacity-100",
            )}
          />
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-[3] w-full bg-[linear-gradient(90deg,rgba(10,31,29,0.96)_0%,rgba(10,31,29,0.78)_34%,rgba(10,31,29,0.18)_67%,transparent_84%)] sm:w-[68%]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-52 bg-[linear-gradient(0deg,rgba(9,28,26,0.82),transparent)] sm:hidden"
        />

        <div
          className={cn(
            "absolute inset-x-0 bottom-0 top-0 z-20 overflow-y-auto px-5 pb-44 pt-7 transition-[opacity,transform] duration-300 motion-reduce:transition-none sm:inset-y-0 sm:right-auto sm:flex sm:w-[48%] sm:items-end sm:overflow-visible sm:px-10 sm:pb-10 sm:pt-20 lg:px-[max(3.5rem,calc((100vw-84rem)/2))] lg:pb-14",
            revealingReplay && "-translate-y-2 opacity-0",
          )}
        >
          <div className="w-full max-w-xl">
            <RouteIdentity route={route} light />
            <div className="mt-7 max-w-md">
              <PrototypeMetrics route={route} light />
            </div>

            {activeChapter ? (
              <div
                aria-live="polite"
                className="mt-5 max-w-lg border-l border-coral pl-4"
              >
                <p className="text-micro font-semibold uppercase text-[#ffd2e4]">
                  {String(activeIndex + 1).padStart(2, "0")} · {EVIDENCE_LABEL[activeChapter.evidence]}
                </p>
                <p className="mt-1 font-editorial text-xl leading-tight text-white">
                  {activeChapter.title}
                </p>
                <p className="mt-1 line-clamp-2 text-caption leading-5 text-white/70">
                  {activeChapter.body}
                </p>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {route.replay.replayEligible ? (
                <Link
                  to={replayHref}
                  onClick={beginReplay}
                  className="inline-flex min-h-12 items-center gap-2 bg-canvas px-5 text-control font-semibold text-forest outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-forest"
                >
                  <Play aria-hidden="true" className="size-4" />
                  Reveal the route in Replay
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              ) : (
                <span className="inline-flex min-h-12 items-center gap-2 border border-white/30 px-4 text-control text-white/60">
                  Replay unavailable
                </span>
              )}
              <span className="hidden items-center gap-2 text-caption text-white/60 lg:inline-flex">
                <BookOpen aria-hidden="true" className="size-4" />
                Choose a chapter on the recorded line
              </span>
            </div>
          </div>
        </div>

        <nav
          aria-label="Story chapters"
          className={cn(
            "absolute inset-x-3 bottom-20 z-30 overflow-x-auto border-y border-white/20 bg-[#102a27] px-1 py-1 transition-opacity duration-300 motion-reduce:transition-none sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-1/2 sm:w-[19rem] sm:-translate-y-1/2 sm:overflow-visible sm:border-x sm:px-2 sm:py-2 lg:right-8",
            revealingReplay && "opacity-0",
          )}
        >
          <div className="flex min-w-max sm:block sm:min-w-0">
            {chapters.map((chapter, index) => {
              const selected = index === activeIndex;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  aria-current={selected ? "step" : undefined}
                  onClick={() => selectChapter(index)}
                  className={cn(
                    "group relative flex min-h-14 w-[13rem] shrink-0 items-center gap-3 border-l border-white/15 px-3 text-left outline-none transition-colors first:border-l-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white sm:w-full sm:border-l-0 sm:border-t sm:first:border-t-0",
                    selected ? "bg-white/12 text-white" : "text-white/62 hover:bg-white/8 hover:text-white",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full border text-micro font-bold tabular-nums transition-colors",
                      selected
                        ? "border-white bg-coral text-white"
                        : "border-white/35 bg-[#173f39]/80 text-white/80",
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-semibold">
                      {chapter.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-micro uppercase text-white/48">
                      <MapPinned aria-hidden="true" className="size-3" />
                      {distanceLabel(chapter.distanceM)} · {EVIDENCE_LABEL[chapter.evidence]}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-2 left-0 w-0.5 bg-coral transition-opacity sm:inset-x-2 sm:inset-y-auto sm:bottom-0 sm:h-0.5 sm:w-auto",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </nav>

        <div
          aria-live="polite"
          className={cn(
            "pointer-events-none absolute inset-0 z-40 grid place-items-center bg-[#0b2522]/0 px-6 text-center opacity-0 transition-[background-color,opacity] duration-500 motion-reduce:hidden",
            revealingReplay && "bg-[#0b2522]/42 opacity-100",
          )}
        >
          {revealingReplay ? (
            <div>
              <p className="text-micro font-semibold uppercase text-white/62">Recorded line</p>
              <p className="mt-2 font-editorial text-3xl text-white sm:text-5xl">
                Continue through the terrain.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
