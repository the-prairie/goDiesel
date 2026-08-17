import { MapPinned, Mountain } from "lucide-react";
import { useMemo, useState } from "react";

import { formatRouteDate } from "@/domain/route";
import {
  EVIDENCE_LABEL,
  PrototypeHeader,
  PrototypeTerrain,
  prototypePremise,
  RouteChapterNodes,
  type RouteStoryPrototypeProps,
} from "@/labs/route-story-prototype/prototype-shared";
import {
  distanceLabel,
  routeStoryChapters,
  routeStoryTitle,
} from "@/surfaces/routes/route-story";

export function MapAsIndexPrototype({ route, routesPath }: RouteStoryPrototypeProps) {
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeChapter = chapters[activeIndex];
  const totalDistanceM = Math.max(route.distanceKm * 1_000, route.route.at(-1)?.d ?? 0, 1);
  const progress = activeChapter ? activeChapter.distanceM / totalDistanceM : 0;
  const title = routeStoryTitle(route);
  const premise = prototypePremise(route);

  const selectChapter = (index: number) => {
    if (!chapters.length) return;
    setActiveIndex(Math.max(0, Math.min(index, chapters.length - 1)));
  };

  const handleChapterKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest("button")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      selectChapter(activeIndex + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectChapter(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectChapter(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectChapter(chapters.length - 1);
    } else {
      return;
    }
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[aria-label="Route chapter index"] [aria-current="step"]')?.focus();
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      <PrototypeHeader
        route={route}
        routesPath={routesPath}
        concept="Map as index"
      />

      <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(0,58%)_minmax(0,42%)] overflow-hidden md:block">
        <PrototypeTerrain
          route={route}
          progress={progress}
          className="min-h-0 md:absolute md:inset-0"
          routeClassName="[&_path:nth-of-type(3)]:transition-[stroke-dasharray] [&_path:nth-of-type(3)]:duration-300 [&_path:nth-of-type(3)]:ease-out motion-reduce:[&_path:nth-of-type(3)]:transition-none"
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 z-[3] bg-[linear-gradient(180deg,rgba(9,32,29,0.30),rgba(9,32,29,0.04)_42%,rgba(9,32,29,0.34))] md:bg-[linear-gradient(90deg,rgba(9,32,29,0.90)_0%,rgba(9,32,29,0.72)_31%,rgba(9,32,29,0.10)_58%,rgba(9,32,29,0.22)_100%)]"
          />

          {chapters.length ? (
            <nav
              aria-label="Route chapter index"
              onKeyDown={handleChapterKeyDown}
              className="absolute inset-0 z-10"
            >
              <RouteChapterNodes
                route={route}
                activeIndex={activeIndex}
                onSelect={selectChapter}
              />
            </nav>
          ) : null}

          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 max-w-[min(72%,24rem)] text-white md:hidden">
            <p className="text-micro font-semibold uppercase text-white/70">
              {route.region} · {formatRouteDate(route.date)}
            </p>
            <h1 className="mt-1 line-clamp-2 text-balance font-editorial text-3xl font-medium leading-[0.9]">
              {title}
            </h1>
          </div>
        </PrototypeTerrain>

        <section
          aria-live="polite"
          aria-atomic="true"
          className="relative z-20 min-h-0 overflow-y-auto border-t border-line bg-canvas px-5 pb-24 pt-5 md:pointer-events-none md:absolute md:inset-y-0 md:left-0 md:flex md:w-[min(43rem,46vw)] md:flex-col md:justify-between md:overflow-hidden md:border-0 md:bg-transparent md:px-[clamp(2.5rem,5vw,5.5rem)] md:pb-12 md:pt-12 md:text-white"
        >
          <div className="hidden md:block">
            <p className="text-caption font-semibold uppercase text-white/70">
              {route.region} · {formatRouteDate(route.date)}
            </p>
            <h1 className="mt-3 max-w-[17ch] text-balance font-editorial text-5xl font-medium leading-[0.88] lg:text-6xl">
              {title}
            </h1>
            <p className="mt-5 text-micro font-semibold uppercase text-[#ffd2e4]">{premise.label}</p>
            <p className="mt-2 max-w-[42ch] font-editorial text-xl italic leading-7 text-[#ffdbea]">
              {premise.text}
            </p>
            <dl className="mt-6 flex gap-8 border-t border-white/25 pt-4 text-control font-semibold tabular-nums">
              <RouteFact label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
              <RouteFact label="Climb" value={`${route.elevationGainM.toLocaleString()} m`} />
              <RouteFact label="Story" value={`${chapters.length} chapters`} />
            </dl>
          </div>

          {activeChapter ? (
            <div
              key={activeChapter.id}
              className="max-w-xl border-t border-line pt-4 md:border-white/30"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-micro font-semibold uppercase text-coral md:text-[#ffd2e4]">
                  {String(activeIndex + 1).padStart(2, "0")} · {EVIDENCE_LABEL[activeChapter.evidence]}
                </p>
                <p className="text-micro font-semibold uppercase text-ink-muted md:text-white/55">
                  {activeIndex + 1} of {chapters.length}
                </p>
              </div>
              <h2 className="mt-2 text-balance font-editorial text-3xl leading-none sm:text-4xl md:text-5xl">
                {activeChapter.title}
              </h2>
              <p className="mt-3 max-w-[46ch] font-editorial text-lg leading-6 text-ink-secondary md:text-xl md:leading-7 md:text-white/78">
                {activeChapter.body}
              </p>
              <div className="mt-4 flex flex-wrap gap-5 text-control font-semibold">
                <span className="inline-flex items-center gap-2">
                  <MapPinned className="size-4 text-route md:text-[#9ec5ff]" aria-hidden="true" />
                  {distanceLabel(activeChapter.distanceM)}
                </span>
                {activeChapter.elevationM === undefined ? null : (
                  <span className="inline-flex items-center gap-2">
                    <Mountain className="size-4 text-route md:text-[#9ec5ff]" aria-hidden="true" />
                    {Math.round(activeChapter.elevationM).toLocaleString()} m
                  </span>
                )}
              </div>
              <p className="mt-4 text-micro leading-4 text-ink-muted md:text-white/48">
                Select a numbered point on the recorded line to move through the story.
              </p>
            </div>
          ) : (
            <div className="border-t border-line pt-5 md:border-white/30">
              <p className="font-editorial text-2xl md:text-white">Recorded route geometry unavailable.</p>
              <p className="mt-2 text-control text-ink-muted md:text-white/60">
                The activity facts remain intact, but there is no route line to use as a chapter index.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RouteFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-white/50">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
