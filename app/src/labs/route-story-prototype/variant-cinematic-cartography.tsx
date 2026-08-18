import { ArrowLeft, ArrowRight, MapPin, Mountain, Play, Route as RouteIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { replayPath, routeDetailPath } from "@/app/route-paths";
import type { RouteSummary } from "@/domain/route";
import { EVIDENCE_LABEL, prototypePremise, prototypeTrace, type RouteStoryPrototypeProps } from "@/labs/route-story-prototype/prototype-shared";
import { distanceLabel, routeStoryChapters, routeStoryTitle } from "@/surfaces/routes/route-story";
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import { cn } from "@/ui/utils";

import "./variant-cinematic-cartography.css";

const ARRIVAL_DELAY_MS = 80;
const REPLAY_REVEAL_MS = 620;

export function CinematicCartographyPrototype({ route, routesPath }: RouteStoryPrototypeProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const chapters = useMemo(() => routeStoryChapters(route), [route]);
  const trace = useMemo(() => prototypeTrace(route), [route]);
  const premise = prototypePremise(route);
  const title = routeStoryTitle(route);
  const [activeIndex, setActiveIndex] = useState(0);
  const [arrived, setArrived] = useState(reducedMotion);
  const [revealingReplay, setRevealingReplay] = useState(false);
  const replayTimer = useRef<number | undefined>(undefined);
  const chapterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeChapter = chapters[activeIndex] ?? chapters[0];
  const replayHref = replayPath(route.slug, routeDetailPath(route.slug));
  const routeDistanceM = Math.max(route.route.at(-1)?.d ?? route.distanceKm * 1_000, 1);
  const chapterDistanceM = activeChapter?.distanceM ?? 0;
  const visibleDistanceM = revealingReplay ? routeDistanceM : arrived ? chapterDistanceM : Math.min(routeDistanceM * 0.018, 120);
  const activePoint = trace?.points.reduce((closest, point) =>
    Math.abs(point.distanceM - chapterDistanceM) < Math.abs(closest.distanceM - chapterDistanceM) ? point : closest,
  );
  const summary: RouteSummary = {
    ...route,
    trace: route.route,
    guide: { vibe: route.curation.vibe, reviewStatus: route.curation.reviewStatus },
  };

  useEffect(() => {
    if (reducedMotion) {
      setArrived(true);
      return;
    }
    setArrived(false);
    const timer = window.setTimeout(() => setArrived(true), ARRIVAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, route.slug]);

  useEffect(() => () => {
    if (replayTimer.current !== undefined) window.clearTimeout(replayTimer.current);
  }, []);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    chapterRefs.current[activeIndex]?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex, reducedMotion]);

  const beginReplay = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (reducedMotion || revealingReplay || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setRevealingReplay(true);
    replayTimer.current = window.setTimeout(() => navigate(replayHref), REPLAY_REVEAL_MS);
  };

  const selectChapter = (index: number) => {
    if (revealingReplay) return;
    setArrived(true);
    setActiveIndex(index);
  };

  return (
    <div className="luminous-route-story" data-arrived={arrived ? "true" : "false"} data-revealing-replay={revealingReplay ? "true" : "false"}>
      <header className="luminous-header">
        <Link to={routesPath} className="luminous-back luminous-focus" aria-label="Back to route collection"><ArrowLeft aria-hidden="true" /></Link>
        <div className="luminous-identity">
          <span className="luminous-wordmark">goDiesel</span>
          <span className="luminous-route-context"><RouteIcon aria-hidden="true" /> Route story</span>
        </div>
        {route.replay.replayEligible ? (
          <Link to={replayHref} onClick={beginReplay} className="luminous-replay luminous-focus" aria-label="Enter cinematic Replay">
            <Play aria-hidden="true" /><span>Enter Replay</span><ArrowRight aria-hidden="true" />
          </Link>
        ) : <span className="luminous-replay-unavailable">Replay unavailable</span>}
      </header>

      <main className="luminous-stage" aria-label="Cinematic route story">
        <div className="luminous-terrain" aria-hidden="true">
          <RouteSatelliteThumbnail route={summary} enabled cinematic priority showRoute={false} imageClassName="luminous-terrain-image" />
          <div className="luminous-atmosphere" />
        </div>

        {trace ? (
          <svg viewBox="0 0 1000 700" role="img" aria-label={`${route.name} recorded route trace`} className="luminous-route-map" preserveAspectRatio="xMidYMid meet">
            <g className="luminous-route-shadow">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="luminous-route-casing">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="luminous-route-recorded">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="luminous-route-progress">
              {trace.segments.map((segment) => {
                const progress = Math.max(0, Math.min(1, (visibleDistanceM - segment.startD) / Math.max(segment.endD - segment.startD, 1)));
                return <path key={segment.id} d={segment.path} pathLength="1" style={{ strokeDasharray: `${progress} 1` }} />;
              })}
            </g>
            {activePoint ? (
              <g className="luminous-current-marker" transform={`translate(${activePoint.x} ${activePoint.y})`}>
                <circle className="luminous-current-ring" r="13" /><circle className="luminous-current-dot" r="6" />
              </g>
            ) : null}
          </svg>
        ) : null}

        <section className={cn("luminous-story", revealingReplay && "is-leaving")}>
          <p className="luminous-place"><MapPin aria-hidden="true" />{route.region}<span aria-hidden="true">/</span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${route.date}T00:00:00`))}</p>
          <h1>{title}</h1>
          <div className="luminous-wave" aria-hidden="true"><i /><i /><i /></div>
          <div className="luminous-premise"><span>{premise.label}</span><p>{premise.text}</p></div>
          <dl className="luminous-facts" aria-label="Route facts">
            <div><dt><RouteIcon aria-hidden="true" />Distance</dt><dd>{route.distanceKm.toFixed(1)} km</dd></div>
            <div><dt><Mountain aria-hidden="true" />Climb</dt><dd>{route.elevationGainM.toLocaleString()} m</dd></div>
            <div><dt>Story</dt><dd>{chapters.length} chapters</dd></div>
          </dl>
        </section>

        {activeChapter ? (
          <aside className={cn("luminous-position", revealingReplay && "is-leaving")} aria-live="polite">
            <span className="luminous-position-dot" aria-hidden="true" />
            <span><strong>{distanceLabel(activeChapter.distanceM)}</strong><small>{EVIDENCE_LABEL[activeChapter.evidence]}</small></span>
          </aside>
        ) : null}

        <nav className={cn("luminous-chapters", revealingReplay && "is-leaving")} aria-label="Story chapters">
          <div className="luminous-chapter-line" aria-hidden="true"><i style={{ transform: `scaleX(${chapters.length > 1 ? activeIndex / (chapters.length - 1) : 1})` }} /></div>
          <div className="luminous-chapter-list">
            {chapters.map((chapter, index) => {
              const selected = index === activeIndex;
              return (
                <button ref={(node) => { chapterRefs.current[index] = node; }} key={chapter.id} type="button" aria-current={selected ? "step" : undefined} onClick={() => selectChapter(index)} className={cn("luminous-chapter luminous-focus", selected && "is-active")}>
                  <span className="luminous-chapter-marker" aria-hidden="true" />
                  <span className="luminous-chapter-copy"><small>{distanceLabel(chapter.distanceM)} · {EVIDENCE_LABEL[chapter.evidence]}</small><strong>{chapter.title}</strong></span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="luminous-reveal" aria-live="polite">{revealingReplay ? <div><span>Recorded route</span><strong>Enter the replay</strong></div> : null}</div>
      </main>
    </div>
  );
}
