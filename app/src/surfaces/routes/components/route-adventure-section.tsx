import { ArrowRight, Clapperboard, Film, Box } from "lucide-react";
import { Link } from "react-router-dom";

import { findRouteBySlug } from "@/data/routes";
import { useRouteAdventure } from "@/data/use-route-adventure";
import { filmDuration, formatClock } from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";
import { chapterReplayHref } from "@/surfaces/routes/route-adventure";

const kilometres = (metres: number) => `${(metres / 1_000).toFixed(1)} km`;

/**
 * The adventure a route belongs to: its owner-placed chapters across every
 * recording, each entering Replay on its own recording at its own distance.
 * Shown only when a local adventure covers this route; builds without
 * adventure content render nothing here.
 */
export function RouteAdventureSection({ route }: { route: QuestRoute }) {
  const placed = useRouteAdventure(route);
  if (!placed) return null;
  const { adventure } = placed;
  const legOrder = new Map(adventure.legs.map((leg, index) => [leg.slug, index]));
  const chapters = [...adventure.chapters].sort(
    (a, b) => legOrder.get(a.anchor.slug)! - legOrder.get(b.anchor.slug)! || a.anchor.atDistanceM - b.anchor.atDistanceM,
  );
  const withheld = new Map(placed.withheld.map((item) => [item.id, item.reason]));
  const clips = adventure.chapters.filter((chapter) => chapter.footageId).length;

  return (
    <section
      aria-labelledby="route-adventure-heading"
      data-testid="route-adventure"
      className="bg-surface px-5 py-16 sm:px-10 lg:px-[max(4rem,calc((100vw-72rem)/2))] lg:py-24"
    >
      <div className="max-w-2xl">
        <h2 id="route-adventure-heading" className="font-editorial text-4xl sm:text-5xl">
          {adventure.title}
        </h2>
        {adventure.subtitle ? (
          <p className="mt-3 text-body leading-7 text-ink-secondary">{adventure.subtitle}</p>
        ) : null}
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-control text-ink-secondary">
          <span>
            {chapters.length} chapters across {adventure.legs.length === 1 ? "this recording" : `${adventure.legs.length} recordings`}
          </span>
          {clips ? <span className="inline-flex items-center gap-1.5"><Film className="size-4" aria-hidden="true" /> footage in {clips}</span> : null}
          {adventure.scenes.length ? (
            <span className="inline-flex items-center gap-1.5">
              <Box className="size-4" aria-hidden="true" /> {adventure.scenes.length === 1 ? "a captured scene" : `${adventure.scenes.length} captured scenes`}
            </span>
          ) : null}
          {adventure.film ? (
            <span className="inline-flex items-center gap-1.5">
              <Clapperboard className="size-4" aria-hidden="true" /> a {formatClock(filmDuration(adventure.film))} film
            </span>
          ) : null}
        </p>
      </div>

      <ol className="mt-10 grid border-t border-line" aria-label={`Chapters of ${adventure.title}`}>
        {chapters.map((chapter, index) => {
          const leg = adventure.legs.find((item) => item.slug === chapter.anchor.slug)!;
          const here = chapter.anchor.slug === route.slug;
          const reason = withheld.get(chapter.id);
          // A recording absent from this build (a single-route page) is named, not linked.
          const available = here || Boolean(findRouteBySlug(chapter.anchor.slug));
          return (
            <li
              key={chapter.id}
              data-chapter-id={chapter.id}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-line py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto]"
            >
              <span aria-hidden="true" className="font-editorial text-2xl leading-none text-route">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-semibold text-ink">{chapter.title}</span>
                <span className="block text-caption text-ink-secondary">
                  {reason
                    ? `Not shown: ${reason}`
                    : `${here ? kilometres(chapter.anchor.atDistanceM) : `${kilometres(chapter.anchor.atDistanceM)} on ${leg.label}`}${chapter.footageId ? " · footage" : ""}`}
                </span>
              </span>
              {!reason && available ? (
                <Link
                  to={chapterReplayHref(chapter.anchor.slug, chapter.anchor.atDistanceM)}
                  aria-label={`Replay from chapter ${index + 1}, ${chapter.title}${here ? "" : `, on ${leg.label}`}`}
                  className="col-start-2 inline-flex min-h-11 items-center gap-2 justify-self-start rounded-md border border-line px-3 text-control font-medium text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-start-3"
                >
                  Replay from here <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              ) : !reason ? (
                <span className="col-start-2 text-caption text-ink-muted sm:col-start-3">On a recording not in this page</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="mt-6 max-w-2xl text-caption leading-5 text-ink-secondary">
        Chapters are placed by the owner on the recorded line. Footage carries no position of its own; each clip is
        shown where the owner placed it. Captured scenes are other authors' 3D captures, credited in Replay.
      </p>
    </section>
  );
}
