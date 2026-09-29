import { useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { buildRouteRegions } from "@/data/route-regions";
import { useRouteDetail } from "@/data/use-route-detail";
import {
  decodedRouteSlug,
  designSeedAtlasPath,
  designSeedStoryPath,
  replayPath,
} from "@/app/route-paths";
import { CONCEPTS, FIXTURE, SEED, SEED_SCRIPT_VERSION, type ConceptId } from "@/labs/design-seeds/seed-manifest";
import { resolveSeedTheme, resolveSeedTypeface } from "@/labs/design-seeds/concept-b-tokens";
import { journalReturnKey } from "@/labs/design-seeds/seed-return-context";
import { ConceptAAtlas, ConceptAStory } from "@/labs/design-seeds/concept-a";
import { ConceptBAtlas } from "@/labs/design-seeds/concept-b";
import { ConceptBStory } from "@/labs/design-seeds/concept-b-story";
import { ConceptDAtlas } from "@/labs/design-seeds/concept-d";
import { ConceptDStory } from "@/labs/design-seeds/concept-d-story";
import { ConceptCAtlas, ConceptCStory } from "@/labs/design-seeds/concept-c";

/**
 * Design-seed lab.
 *
 * Isolated local exploration that uses the application's real routing, so the
 * journey behaves like production: Atlas -> day -> Replay -> back.
 *
 *   /#/lab/design-seeds/:concept/atlas?region=<region>&route=<slug>
 *   /#/lab/design-seeds/:concept/story/:routeSlug?from=<atlas url>
 *
 * Reads the generated route data through the normal data layer and writes
 * nothing. Replay is the real product surface, not a copy.
 */

const ATLAS = { a: ConceptAAtlas, b: ConceptBAtlas, c: ConceptCAtlas, d: ConceptDAtlas } as const;
const STORY = { a: ConceptAStory, b: ConceptBStory, c: ConceptCStory, d: ConceptDStory } as const;

/**
 * Google's photorealistic 3D tiles need a browser key, which is absent in a
 * plain checkout. Entering Replay on an engine that cannot draw would put a
 * provider error where the geography should be, so the day deliberately enters
 * on the engine that is actually available. With a key present this is the
 * product default.
 */
const GOOGLE_3D_AVAILABLE = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

function isConcept(value: string | undefined): value is ConceptId {
  return value === "a" || value === "b" || value === "c" || value === "d";
}

export function DesignSeedsLabPage() {
  const params = useParams<{ concept?: string; view?: string; routeSlug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const concept = isConcept(params.concept) ? params.concept : "b";
  const isStory = Boolean(params.routeSlug) || params.view === "story";

  /* ------------------------------- The day ------------------------------- */
  if (isStory) {
    return (
      <StoryRoute
        concept={concept}
        slug={decodedRouteSlug(params.routeSlug) ?? searchParams.get("route") ?? FIXTURE.plainSlug}
        from={searchParams.get("from") ?? undefined}
        storyUrl={`${location.pathname}${location.search}`}
        themeParam={searchParams.get("theme")}
        typeParam={searchParams.get("type")}
        atParam={searchParams.get("at")}
      />
    );
  }

  /* ------------------------------ The Atlas ------------------------------ */
  const regionName = searchParams.get("region") ?? FIXTURE.region;
  const regions = buildRouteRegions(completedRoutes);
  const region = regions.find((candidate) => candidate.name === regionName) ?? regions[0];

  // Newest first for concept A's index; B re-sorts to chronological itself.
  const regionRoutes = [...(region?.routes ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const requested = searchParams.get("route") ?? undefined;
  const selected =
    regionRoutes.find((route) => route.slug === requested) ??
    regionRoutes.find((route) => route.slug === FIXTURE.plainSlug) ??
    regionRoutes[0];

  if (!region || !selected) {
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", fontSize: 13 }}>
        No recorded routes available for {regionName}.
      </div>
    );
  }

  // The Atlas URL is the return address, so the region, the selected day and
  // any other parameters survive the round trip.
  const atlasParams = new URLSearchParams(searchParams);
  atlasParams.set("region", region.name);
  atlasParams.set("route", selected.slug);
  const atlasUrl = designSeedAtlasPath(concept, atlasParams);

  const Atlas = ATLAS[concept];
  return (
    <>
      <Atlas
        region={region.name}
        routes={regionRoutes}
        selected={selected}
        /*
         * A day's own address, for any day in the region.
         *
         * The narrow composition opens a day by tapping its row, so every row
         * needs one - and each carries the same Atlas return address and
         * presentation the selected day's action does.
         */
        storyHrefFor={(slug: string) => {
          const path = designSeedStoryPath(concept, slug, atlasUrl);
          const carry = new URLSearchParams();
          const themeParam = searchParams.get("theme");
          const typeParam = searchParams.get("type");
          if (themeParam) carry.set("theme", themeParam);
          if (typeParam) carry.set("type", typeParam);
          const query = carry.toString();
          return query ? `${path}&${query}` : path;
        }}
        theme={resolveSeedTheme(searchParams.get("theme"))}
        typeface={resolveSeedTypeface(searchParams.get("type"))}
        returnKey={journalReturnKey({
          concept,
          region: region.name,
          theme: searchParams.get("theme"),
          typeface: searchParams.get("type"),
        })}
        onSelect={(slug) => {
          const next = new URLSearchParams(searchParams);
          next.set("region", region.name);
          next.set("route", slug);
          setSearchParams(next, { replace: true });
        }}
      />
      <span hidden data-seed-concept={concept} data-seed={SEED} data-seed-script={SEED_SCRIPT_VERSION}>
        {CONCEPTS[concept].label}
      </span>
    </>
  );
}

function StoryRoute({
  concept, slug, from, storyUrl, themeParam, typeParam, atParam,
}: {
  concept: ConceptId;
  slug: string;
  from?: string;
  storyUrl: string;
  themeParam: string | null;
  typeParam: string | null;
  /** Metres along the recorded route, so a held position survives the journey. */
  atParam: string | null;
}) {
  const summary = findRouteBySlug(slug);
  const detail = useRouteDetail(summary?.slug);

  /*
   * Only an Atlas URL for this lab is accepted as a return address; anything
   * else falls back to the concept's own Atlas.
   *
   * The fallback is what a directly opened day uses, so it names this route's
   * own region and selects this route - you land on the journal with the day
   * you were reading selected and framed, never on an unrelated region and
   * never on a dead end. It carries the presentation too, so returning does not
   * silently change the cast or the typeface.
   */
  const returnTo = useMemo(() => {
    const fallbackParams = new URLSearchParams({
      route: slug,
      ...(summary ? { region: summary.region } : {}),
    });
    if (themeParam) fallbackParams.set("theme", themeParam);
    if (typeParam) fallbackParams.set("type", typeParam);
    const fallback = designSeedAtlasPath(concept, fallbackParams);
    if (!from) return { path: fallback, fromAtlas: false };
    const expected = `/lab/design-seeds/${concept}/atlas`;
    const [pathname] = from.split("?");
    return pathname === expected
      ? { path: from, fromAtlas: true }
      : { path: fallback, fromAtlas: false };
  }, [concept, from, slug, summary, themeParam, typeParam]);

  if (!summary) {
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontSize: 13 }}>
        That route is not in the atlas.
      </div>
    );
  }
  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", fontSize: 13 }}>
        Opening the day…
      </div>
    );
  }
  if (detail.status !== "ready") {
    return (
      <div role="alert" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontSize: 13 }}>
        This day could not be opened.
      </div>
    );
  }

  const backLabel = summary.region.split(",")[0];
  // Replay stays dark, but it is entered with the journal's cast so the route's
  // identity does not change hands at the transition.
  const cast = resolveSeedTheme(themeParam).id === "journal" ? "&theme=journal" : "";
  const replayHref = `${replayPath(summary.slug, storyUrl)}${
    GOOGLE_3D_AVAILABLE ? "" : "&renderer=atlas"
  }${cast}`;

  if (concept === "b") {
    return (
      <ConceptBStory
        route={detail.route}
        backPath={returnTo.path}
        backLabel={backLabel}
        replayHref={replayHref}
        openFromAtlas={returnTo.fromAtlas}
        theme={resolveSeedTheme(themeParam)}
        typeface={resolveSeedTypeface(typeParam)}
      />
    );
  }
  if (concept === "d") {
    /*
     * The entry distance travels with the journey.
     *
     * Replay begins where the reader was holding the thread, and the day's own
     * address carries the same `at` so returning puts the handle back on the
     * ridge they left it on. A direct link without `at` simply opens unheld.
     */
    // An explicit at=0 holds the start (a chapter can sit there); no `at` holds nothing.
    const atMetres = atParam === null || atParam === "" ? Number.NaN : Number(atParam);
    const held = Number.isFinite(atMetres) && atMetres >= 0 ? atMetres : undefined;
    const total = detail.route.route.length
      ? (detail.route.route[detail.route.route.length - 1].d ?? 0)
      : 0;
    const storyWithAt = (metres?: number) => {
      const url = new URL(storyUrl, "http://local");
      if (metres && metres > 0) url.searchParams.set("at", String(Math.round(metres)));
      else url.searchParams.delete("at");
      return `${url.pathname}${url.search}`;
    };
    return (
      <ConceptDStory
        key={detail.route.slug}
        route={detail.route}
        regionRoutes={regionsFor(summary.region)}
        backPath={returnTo.path}
        backLabel={backLabel}
        initialProgress={held !== undefined && total > 0 ? Math.min(1, held / total) : undefined}
        /*
         * `at` twice, deliberately, because it answers two questions.
         *
         * Inside `from` it is the day's own address, so the visible return puts
         * the handle back on the ridge the reader left it on. At the top level
         * it is Replay's own entry distance, so playback begins there instead
         * of starting the day again. The first run only carried it inside
         * `from` and Replay opened at 0.
         */
        replayHref={(metres) =>
          `${replayPath(summary.slug, storyWithAt(metres))}&renderer=atlas&landscape=notebook${metres && metres > 0 ? `&at=${Math.round(metres)}` : ""}`
        }
      />
    );
  }

  const Story = STORY[concept];
  return <Story route={detail.route} />;
}

/** The neighbours in a region, for the landform behind a single day. */
function regionsFor(region: string) {
  return buildRouteRegions(completedRoutes).find((candidate) => candidate.name === region)?.routes ?? [];
}
