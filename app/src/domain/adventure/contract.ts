// The adventure contract. Types only.
//
// An adventure is an editorial layer over canonical recordings: chapters,
// footage, captured scenes and a short film, each anchored to a distance on
// one route. It never carries geometry of its own. The route model stays the
// single source of where anything happened (CONTEXT.md sections 2 and 4).

export const ADVENTURE_SCHEMA_VERSION = 1;

export interface AdventureCoordinate {
  lat: number;
  lng: number;
}

/**
 * Where an item sits on one canonical recording.
 *
 * `source` is the prepared-pack coordinate the placement was derived from, so
 * a reader can confirm the distance still lands on the current geometry.
 */
export interface AdventureAnchor {
  slug: string;
  atDistanceM: number;
  source: AdventureCoordinate;
}

/** One canonical recording, in the order it was travelled. */
export interface AdventureLeg {
  slug: string;
  label: string;
}

export interface AdventureFootage {
  id: string;
  kind: "video";
  /**
   * `recorded`: the owner's own footage (the default). `rendered`: made from
   * someone else's imagery, such as an Earth Studio flyover; it carries a
   * credit and is never presented as footage of the day.
   */
  origin: "recorded" | "rendered";
  credit?: string;
  title: string;
  description?: string;
  /** Path relative to the adventure's own directory. */
  src: string;
  poster?: string;
  sha256: string;
}

/**
 * A chapter is placed by the owner. Its footage association is editorial:
 * the clips carry no position of their own.
 */
export interface AdventureChapter {
  id: string;
  title: string;
  note?: string;
  footageId?: string;
  anchor: AdventureAnchor;
}

export interface AdventureSceneShot {
  atS: number;
  title: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** A captured 3D scene hosted by its author. Never presented as terrain. */
export interface AdventureScene {
  id: string;
  provider: "sketchfab";
  modelId: string;
  title: string;
  eyebrow?: string;
  description?: string;
  poster?: string;
  posterAlt: string;
  attribution: { author: string; url: string };
  anchor: AdventureAnchor;
  tour: { title: string; fovDeg?: number; shots: AdventureSceneShot[] };
}

export interface AdventureClip {
  footageId: string;
  inS: number;
  outS: number;
}

export type AdventureFilmBeat =
  | ({ kind: "footage"; title: string } & AdventureClip)
  | { kind: "route"; title: string; durationS: number }
  | {
      kind: "scene";
      title: string;
      sceneId: string;
      inS: number;
      outS: number;
      durationS: number;
      fallback: AdventureClip;
    };

export interface AdventureFilm {
  title: string;
  cta: string;
  beats: AdventureFilmBeat[];
}

export interface AdventureSource {
  kind: "prepared-pack";
  packId: string;
  packSchemaVersion: number;
  sha256: string;
}

export interface Adventure {
  schemaVersion: typeof ADVENTURE_SCHEMA_VERSION;
  id: string;
  title: string;
  subtitle?: string;
  location?: string;
  source: AdventureSource;
  legs: AdventureLeg[];
  chapters: AdventureChapter[];
  footage: AdventureFootage[];
  scenes: AdventureScene[];
  film?: AdventureFilm;
}

/** The locally available adventures and the recordings each covers. */
export interface AdventureIndex {
  schemaVersion: typeof ADVENTURE_SCHEMA_VERSION;
  adventures: { id: string; title: string; legs: string[] }[];
}
