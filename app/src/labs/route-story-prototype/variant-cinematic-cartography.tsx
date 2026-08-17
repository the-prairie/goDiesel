import { ArrowLeft, ArrowRight, MapPin, Play, Route as RouteIcon, Sparkles } from "lucide-react";
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
const REPLAY_REVEAL_MS = 680;

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
    <div className="daylight-excursion-atlas" data-arrived={arrived ? "true" : "false"} data-revealing-replay={revealingReplay ? "true" : "false"}>
      <header className="daylight-header">
        <Link to={routesPath} className="daylight-icon-link daylight-focus" aria-label="Back to route collection"><ArrowLeft aria-hidden="true" /></Link>
        <div className="daylight-brand">
          <span className="daylight-brand-mark" aria-hidden="true"><RouteIcon /></span>
          <span className="daylight-brand-name">goDiesel</span>
          <span className="daylight-brand-edition">Daylight Atlas</span>
        </div>
        {route.replay.replayEligible ? (
          <Link to={replayHref} onClick={beginReplay} className="daylight-replay daylight-focus" aria-label="Enter cinematic Replay">
            <Play aria-hidden="true" /><span>Enter Replay</span><ArrowRight aria-hidden="true" />
          </Link>
        ) : <span className="daylight-replay-unavailable">Replay unavailable</span>}
      </header>

      <main className="daylight-stage" aria-label="Daylight excursion route story">
        <div className="daylight-terrain" aria-hidden="true">
          <RouteSatelliteThumbnail route={summary} enabled cinematic priority showRoute={false} imageClassName="daylight-terrain-image" />
          <div className="daylight-map-wash" />
        </div>

        {trace ? (
          <svg viewBox="0 0 1000 700" role="img" aria-label={`${route.name} recorded route trace`} className="daylight-route-map" preserveAspectRatio="xMidYMid meet">
            <g className="daylight-route-shadow">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="daylight-route-casing">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="daylight-route-recorded">{trace.segments.map((segment) => <path key={segment.id} d={segment.path} pathLength="1" />)}</g>
            <g className="daylight-route-progress">
              {trace.segments.map((segment) => {
                const progress = Math.max(0, Math.min(1, (visibleDistanceM - segment.startD) / Math.max(segment.endD - segment.startD, 1)));
                return <path key={segment.id} d={segment.path} pathLength="1" style={{ strokeDasharray: `${progress} 1` }} />;
              })}
            </g>
            {activePoint ? (
              <g className="daylight-current-marker" transform={`translate(${activePoint.x} ${activePoint.y})`}>
                <circle className="daylight-current-halo" r="18" /><circle className="daylight-current-dot" r="10" />
              </g>
            ) : null}
          </svg>
        ) : null}

        <section className={cn("daylight-story", revealingReplay && "daylight-story-leaving")}>
          <p className="daylight-kicker"><MapPin aria-hidden="true" />{route.region} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${route.date}T00:00:00`))}</p>
          <h1>{title}</h1>
          <div className="daylight-premise"><span>{premise.label}</span><p>{premise.text}</p></div>
          <dl className="daylight-ticket" aria-label="Route summary">
            <div><dt>Distance</dt><dd>{route.distanceKm.toFixed(1)} km</dd></div>
            <div><dt>Climb</dt><dd>{route.elevationGainM.toLocaleString()} m</dd></div>
            <div><dt>Journey</dt><dd>{chapters.length} chapters</dd></div>
          </dl>
        </section>

        {activeChapter ? (
          <aside className={cn("daylight-position", revealingReplay && "daylight-position-leaving")} aria-live="polite">
            <span className="daylight-position-number">{String(activeIndex + 1).padStart(2, "0")}</span>
            <span className="daylight-position-rule" aria-hidden="true" />
            <span className="daylight-position-copy"><strong>{distanceLabel(activeChapter.distanceM)}</strong><small>{EVIDENCE_LABEL[activeChapter.evidence]}</small></span>
          </aside>
        ) : null}

        <nav className={cn("daylight-journey", revealingReplay && "daylight-journey-leaving")} aria-label="Story chapters">
          <div className="daylight-journey-intro"><span><Sparkles aria-hidden="true" /> Route journey</span><strong>{activeIndex + 1} of {chapters.length}</strong></div>
          <div className="daylight-journey-stops">
            {chapters.map((chapter, index) => {
              const selected = index === activeIndex;
              const visited = index <= activeIndex;
              return (
                <button ref={(node) => { chapterRefs.current[index] = node; }} key={chapter.id} type="button" aria-current={selected ? "step" : undefined} onClick={() => selectChapter(index)} className={cn("daylight-stop daylight-focus", selected && "is-active", visited && "is-visited")}>
                  <span className="daylight-stop-track" aria-hidden="true"><i /></span>
                  <span className="daylight-stop-copy"><small>{String(index + 1).padStart(2, "0")} · {EVIDENCE_LABEL[chapter.evidence]}</small><strong>{chapter.title}</strong><em>{distanceLabel(chapter.distanceM)}</em></span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="daylight-reveal" aria-live="polite">{revealingReplay ? <div><span>Recorded route</span><strong>Opening the terrain</strong></div> : null}</div>
      </main>
    </div>
  );
}
