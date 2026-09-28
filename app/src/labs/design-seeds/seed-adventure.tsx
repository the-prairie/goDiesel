import { Link, useLocation } from "react-router-dom";

import { useRouteAdventure } from "@/data/use-route-adventure";
import { filmDuration, formatClock } from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";

/**
 * The adventure this day belongs to, on the leaf. Each chapter holds the
 * thread at its recorded distance, so "Enter at 2.9 km" opens Replay at that
 * chapter. Chapters on the other recording open that day instead.
 */
export function SeedAdventure({
  route,
  heldM,
  onHold,
}: {
  route: QuestRoute;
  heldM?: number;
  onHold: (distanceM: number) => void;
}) {
  const adventure = useRouteAdventure(route);
  const location = useLocation();
  if (!adventure) return null;
  const { adventure: source } = adventure;
  const legs = source.legs;
  const ordered = [...source.chapters].sort(
    (a, b) =>
      legs.findIndex((leg) => leg.slug === a.anchor.slug) - legs.findIndex((leg) => leg.slug === b.anchor.slug) ||
      a.anchor.atDistanceM - b.anchor.atDistanceM,
  );
  const placed = new Set(adventure.chapters.map((chapter) => chapter.id));
  const withheld = new Map(adventure.withheld.map((item) => [item.id, item.reason]));
  const clips = source.chapters.filter((chapter) => chapter.footageId).length;
  const storyOf = (slug: string) => `${location.pathname.replace(/[^/]+$/, encodeURIComponent(slug))}${location.search}`;

  return (
    <section className="seed-adventure" aria-labelledby="seed-adventure-title" data-testid="seed-adventure">
      <h2 id="seed-adventure-title">{source.title}</h2>
      <p className="seed-adventure-meta">
        {ordered.length} chapters across {legs.length === 1 ? "this recording" : `${legs.length} recordings`}
        {clips ? ` · footage in ${clips}` : ""}
        {source.scenes.length ? ` · ${source.scenes.length === 1 ? "a captured scene" : `${source.scenes.length} captured scenes`}` : ""}
        {source.film ? ` · a ${formatClock(filmDuration(source.film))} film` : ""}
      </p>
      <ol>
        {ordered.map((chapter, index) => {
          const here = placed.has(chapter.id);
          const held = here && heldM !== undefined && Math.abs(heldM - chapter.anchor.atDistanceM) < 1;
          const leg = legs.find((item) => item.slug === chapter.anchor.slug)!;
          const body = (
            <>
              <span className="seed-adventure-km" aria-hidden="true">{index + 1}</span>
              <span className="seed-adventure-name">
                {chapter.title}
                {!here ? <small>{withheld.has(chapter.id) ? "Not shown: its placement no longer matches this recording" : `On ${leg.label}`}</small> : null}
              </span>
              <span className="seed-adventure-at">
                {here ? `${(chapter.anchor.atDistanceM / 1_000).toFixed(1)} km` : null}
              </span>
            </>
          );
          return (
            <li key={chapter.id}>
              {here ? (
                <button
                  type="button"
                  className="seed-adventure-row seed-focus"
                  aria-pressed={held}
                  aria-label={`Hold the thread at chapter ${index + 1}, ${chapter.title}, ${(chapter.anchor.atDistanceM / 1_000).toFixed(1)} km`}
                  onClick={() => onHold(chapter.anchor.atDistanceM)}
                >
                  {body}
                </button>
              ) : withheld.has(chapter.id) ? (
                <div className="seed-adventure-row" title={withheld.get(chapter.id)} aria-disabled="true">{body}</div>
              ) : (
                <Link className="seed-adventure-row seed-focus" to={storyOf(chapter.anchor.slug)}>{body}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
