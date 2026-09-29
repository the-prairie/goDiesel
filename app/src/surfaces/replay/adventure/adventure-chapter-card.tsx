import { Box, ChevronLeft, ChevronRight, Clapperboard, ListOrdered, Play, Undo2, X } from "lucide-react";
import { Link } from "react-router-dom";

import {
  chapterAt,
  filmDuration,
  formatClock,
  type PlacedChapter,
  type PlacedScene,
  type RouteAdventure,
} from "@/domain/adventure";
import { kilometres } from "@/surfaces/replay/adventure/adventure-format";
import type { AdventureHold } from "@/surfaces/replay/playback/replay-hold";
import { cn } from "@/ui/utils";

/** The scene that belongs to a chapter: the first one before the next chapter. */
export function sceneInChapter(adventure: RouteAdventure, chapter: PlacedChapter | undefined) {
  const start = chapter?.atDistanceM ?? 0;
  const next = adventure.chapters.find((item) => item.atDistanceM > start)?.atDistanceM ?? Infinity;
  return adventure.scenes.find((scene) => scene.atDistanceM >= start && scene.atDistanceM < next);
}

export function AdventureChapterCard({
  adventure,
  progressM,
  compact,
  listOpen,
  resume,
  titleHidden = false,
  legPath,
  onToggleList,
  onSeek,
  onResume,
  onDismissResume,
  onWatch,
  onScene,
  onFilm,
}: {
  adventure: RouteAdventure;
  progressM: number;
  compact: boolean;
  listOpen: boolean;
  resume?: AdventureHold;
  titleHidden?: boolean;
  legPath: (slug: string, atM?: number) => string;
  onToggleList: () => void;
  onSeek: (distanceM: number) => void;
  onResume: () => void;
  onDismissResume: () => void;
  onWatch: (chapter: PlacedChapter) => void;
  onScene: (scene: PlacedScene) => void;
  onFilm: () => void;
}) {
  const current = chapterAt(adventure.chapters, progressM);
  const index = current ? adventure.chapters.indexOf(current) : -1;
  const previous = index > 0 ? adventure.chapters[index - 1] : undefined;
  const next = adventure.chapters[index + 1];
  const scene = sceneInChapter(adventure, current);
  const film = adventure.film;
  const lastHere = !next;

  return (
    <article
      data-testid="adventure-chapter-card"
      data-chapter-id={current?.id ?? "introduction"}
      data-compact={compact}
      aria-labelledby="adventure-chapter-title"
      className="adv-card pointer-events-auto"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="adventure-chapter-title" className={titleHidden ? "sr-only" : "adv-card-title"} aria-live="polite">
            {current ? current.title : adventure.adventure.title}
          </h2>
          <p className="adv-card-meta">
            {current
              ? `Chapter ${current.ordinal} of ${adventure.chapterCount} · ${kilometres(current.atDistanceM)}`
              : `${adventure.chapterCount} chapters across ${adventure.adventure.legs.length === 1 ? "one recording" : `${adventure.adventure.legs.length} recordings`}`}
          </p>
        </div>
        {!compact ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="adv-icon-button"
              disabled={!previous && (!current || progressM < 1)}
              aria-label={previous ? `Previous chapter: ${previous.title}` : "Back to the start of this recording"}
              onClick={() => onSeek(previous?.atDistanceM ?? 0)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              className="adv-icon-button"
              disabled={!next}
              aria-label={next ? `Next chapter: ${next.title}` : "No later chapter on this recording"}
              onClick={() => next && onSeek(next.atDistanceM)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {!compact ? (
        <p className="adv-card-note">
          {current ? current.note : adventure.adventure.subtitle}
        </p>
      ) : null}

      {resume && !compact ? (
        <div className="adv-resume" role="status">
          <button type="button" className="adv-button adv-button-primary" onClick={onResume}>
            <Undo2 aria-hidden="true" />
            Resume at {kilometres(resume.progressM)}
          </button>
          <button type="button" className="adv-icon-button" aria-label="Stay here instead" onClick={onDismissResume}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className={cn("adv-card-actions", compact && "adv-card-actions-compact")}>
        {current?.footage ? (
          <button type="button" className="adv-button adv-button-primary" onClick={() => onWatch(current)}>
            <Play aria-hidden="true" />
            {current.footage.origin === "rendered" ? "Watch the flyover" : "Watch this moment"}
          </button>
        ) : null}
        {!compact && scene ? (
          <button type="button" className="adv-button" onClick={() => onScene(scene)}>
            <Box aria-hidden="true" />
            Step inside the scene
          </button>
        ) : null}
        {!compact && !current && film ? (
          <button type="button" className="adv-button adv-button-primary" onClick={onFilm}>
            <Clapperboard aria-hidden="true" />
            {film.cta} · {formatClock(filmDuration(film))}
          </button>
        ) : null}
        {!compact ? (
          <button
            type="button"
            className="adv-button"
            aria-expanded={listOpen}
            aria-controls="adventure-chapter-list"
            onClick={onToggleList}
          >
            <ListOrdered aria-hidden="true" />
            {listOpen ? "Hide chapters" : "All chapters"}
          </button>
        ) : null}
      </div>

      {!compact && lastHere && adventure.nextLeg ? (
        <Link className="adv-leg-link" to={legPath(adventure.nextLeg.slug)}>
          Continue on the next recording: {adventure.nextLeg.label}
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : null}
      {!compact && !current && adventure.previousLeg ? (
        <Link className="adv-leg-link" to={legPath(adventure.previousLeg.slug)}>
          <ChevronLeft aria-hidden="true" />
          Begin with the first recording: {adventure.previousLeg.label}
        </Link>
      ) : null}

      {listOpen && !compact ? (
        <AdventureChapterList
          adventure={adventure}
          current={current}
          legPath={legPath}
          onSeek={onSeek}
          onFilm={onFilm}
        />
      ) : null}
    </article>
  );
}

function AdventureChapterList({
  adventure,
  current,
  legPath,
  onSeek,
  onFilm,
}: {
  adventure: RouteAdventure;
  current?: PlacedChapter;
  legPath: (slug: string, atM?: number) => string;
  onSeek: (distanceM: number) => void;
  onFilm: () => void;
}) {
  const legs = adventure.adventure.legs;
  const placedHere = new Map(adventure.chapters.map((chapter) => [chapter.id, chapter]));
  const withheld = new Set(adventure.withheld.map((item) => item.id));
  const ordered = [...adventure.adventure.chapters].sort(
    (a, b) =>
      legs.findIndex((leg) => leg.slug === a.anchor.slug) - legs.findIndex((leg) => leg.slug === b.anchor.slug) ||
      a.anchor.atDistanceM - b.anchor.atDistanceM,
  );

  return (
    <div id="adventure-chapter-list" className="adv-list">
      <ol>
        {ordered.map((chapter, index) => {
          const here = placedHere.get(chapter.id);
          const leg = legs.find((item) => item.slug === chapter.anchor.slug)!;
          const label = (
            <>
              <span className="adv-list-ordinal" aria-hidden="true">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="adv-list-title">{chapter.title}</span>
                <span className="adv-list-meta">
                  {here
                    ? kilometres(here.atDistanceM)
                    : withheld.has(chapter.id)
                      ? "Not shown: its placement no longer matches this recording"
                      : `On ${leg.label}`}
                  {chapter.footageId ? " · footage" : ""}
                </span>
              </span>
            </>
          );
          return (
            <li key={chapter.id}>
              {here ? (
                <button
                  type="button"
                  className="adv-list-row"
                  aria-current={current?.id === chapter.id ? "step" : undefined}
                  onClick={() => onSeek(here.atDistanceM)}
                >
                  {label}
                </button>
              ) : withheld.has(chapter.id) ? (
                <div className="adv-list-row" aria-disabled="true">{label}</div>
              ) : (
                <Link className="adv-list-row" to={legPath(chapter.anchor.slug, chapter.anchor.atDistanceM)}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {adventure.film ? (
        <button type="button" className="adv-button mt-2 w-full" onClick={onFilm}>
          <Clapperboard aria-hidden="true" />
          {adventure.film.cta} · {formatClock(filmDuration(adventure.film))}
        </button>
      ) : null}
      <p className="adv-provenance">
        Chapters are placed by the owner on the recorded line. Footage carries no position of its own; each clip is
        shown where the owner placed it.
      </p>
    </div>
  );
}
