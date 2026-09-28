// Place an adventure's editorial anchors on one canonical recording.
//
// Distances are stored, then confirmed against the current geometry: an anchor
// that no longer lands where it was prepared is withheld with a reason rather
// than drawn somewhere it did not happen.

import type {
  Adventure,
  AdventureAnchor,
  AdventureChapter,
  AdventureFilm,
  AdventureFootage,
  AdventureLeg,
  AdventureScene,
} from "@/domain/adventure/contract";
import { haversineM } from "@/domain/adventure/projection";
import { recordedPointAt } from "@/domain/geometry/recorded-thread";
import type { QuestRoute } from "@/domain/route";

/** How far a stored distance may land from its prepared coordinate. */
export const ANCHOR_TOLERANCE_M = 75;

export interface PlacedChapter extends AdventureChapter {
  /** 1-based position across the whole adventure, legs in travelled order. */
  ordinal: number;
  atDistanceM: number;
  footage?: AdventureFootage;
}

export interface PlacedScene extends AdventureScene {
  atDistanceM: number;
}

export interface WithheldAnchor {
  id: string;
  kind: "chapter" | "scene";
  title: string;
  reason: string;
}

export interface RouteAdventure {
  adventure: Adventure;
  legIndex: number;
  leg: AdventureLeg;
  previousLeg?: AdventureLeg;
  nextLeg?: AdventureLeg;
  chapters: PlacedChapter[];
  chapterCount: number;
  scenes: PlacedScene[];
  film?: AdventureFilm;
  footage: Map<string, AdventureFootage>;
  withheld: WithheldAnchor[];
}

export function confirmAnchor(route: QuestRoute, anchor: AdventureAnchor): string | undefined {
  const gaps = route.provenance.discontinuities;
  const end = route.route.at(-1)?.d ?? 0;
  if (anchor.atDistanceM > end + 1) return "Its distance is beyond the end of this recording.";
  if (gaps.some((gap) => anchor.atDistanceM > gap.startD && anchor.atDistanceM < gap.endD)) {
    return "Its distance falls inside a recording gap.";
  }
  const point = recordedPointAt(route.route, anchor.atDistanceM, gaps);
  if (!point) return "This recording has no geometry.";
  const offset = haversineM(point, anchor.source);
  if (offset > ANCHOR_TOLERANCE_M) {
    return `Its prepared location does not match this recording (${Math.round(offset)} m away).`;
  }
  return undefined;
}

export function placeAdventureOnRoute(adventure: Adventure, route: QuestRoute): RouteAdventure | undefined {
  const legIndex = adventure.legs.findIndex((leg) => leg.slug === route.slug);
  if (legIndex < 0) return undefined;

  const legOrder = new Map(adventure.legs.map((leg, index) => [leg.slug, index]));
  const ordered = [...adventure.chapters].sort(
    (a, b) => legOrder.get(a.anchor.slug)! - legOrder.get(b.anchor.slug)! || a.anchor.atDistanceM - b.anchor.atDistanceM,
  );
  const footage = new Map(adventure.footage.map((clip) => [clip.id, clip]));
  const withheld: WithheldAnchor[] = [];

  const chapters: PlacedChapter[] = [];
  ordered.forEach((chapter, index) => {
    if (chapter.anchor.slug !== route.slug) return;
    const reason = confirmAnchor(route, chapter.anchor);
    if (reason) {
      withheld.push({ id: chapter.id, kind: "chapter", title: chapter.title, reason });
      return;
    }
    chapters.push({
      ...chapter,
      ordinal: index + 1,
      atDistanceM: chapter.anchor.atDistanceM,
      footage: chapter.footageId ? footage.get(chapter.footageId) : undefined,
    });
  });

  const scenes: PlacedScene[] = [];
  for (const scene of adventure.scenes) {
    if (scene.anchor.slug !== route.slug) continue;
    const reason = confirmAnchor(route, scene.anchor);
    if (reason) withheld.push({ id: scene.id, kind: "scene", title: scene.title, reason });
    else scenes.push({ ...scene, atDistanceM: scene.anchor.atDistanceM });
  }
  scenes.sort((a, b) => a.atDistanceM - b.atDistanceM);

  return {
    adventure,
    legIndex,
    leg: adventure.legs[legIndex],
    previousLeg: adventure.legs[legIndex - 1],
    nextLeg: adventure.legs[legIndex + 1],
    chapters,
    chapterCount: adventure.chapters.length,
    scenes,
    film: adventure.film,
    footage,
    withheld,
  };
}

/** The chapter the reader is in: the last one at or behind the held distance. */
export function chapterAt(chapters: PlacedChapter[], progressM: number) {
  let current: PlacedChapter | undefined;
  for (const chapter of chapters) {
    if (chapter.atDistanceM <= progressM + 0.5) current = chapter;
    else break;
  }
  return current;
}
