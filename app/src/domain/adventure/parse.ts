// Strict parser for adventure documents. Unknown fields are errors, so a pack
// schema change can never be silently half-read. Runtime-import free: the
// importer script loads this file directly under Node's type stripping.

import type {
  Adventure,
  AdventureAnchor,
  AdventureChapter,
  AdventureClip,
  AdventureFilm,
  AdventureFilmBeat,
  AdventureFootage,
  AdventureIndex,
  AdventureLeg,
  AdventureScene,
  AdventureSceneShot,
} from "@/domain/adventure/contract";

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`adventure ${path} ${message}`);
}

function object(value: unknown, path: string, allowed: string[]): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const unknown = Object.keys(value as Json).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(path, `has unknown field ${unknown.map((key) => `${path}.${key}`).join(", ")}`);
  return value as Json;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be a list");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail(path, "must be a non-empty string");
  return value.trim();
}

function optionalText(value: unknown, path: string) {
  return value === undefined ? undefined : text(value, path);
}

function finite(value: unknown, path: string, minimum = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    fail(path, `must be a number${minimum > -Infinity ? ` of at least ${minimum}` : ""}`);
  }
  return value;
}

function identifier(value: unknown, path: string) {
  const id = text(value, path);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) fail(path, "must be a lowercase identifier");
  return id;
}

/** Media stays inside the adventure's own directory: no scheme, no parent. */
function mediaPath(value: unknown, path: string) {
  const file = text(value, path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith("/") || file.split("/").includes("..")) {
    fail(path, "must be a path inside the adventure directory");
  }
  return file;
}

function sha256(value: unknown, path: string) {
  const digest = text(value, path);
  if (!/^[0-9a-f]{64}$/.test(digest)) fail(path, "must be a SHA-256 hex digest");
  return digest;
}

function httpsUrl(value: unknown, path: string, host?: string) {
  const raw = text(value, path);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(path, "must be a URL");
  }
  if (url.protocol !== "https:") fail(path, "must use https");
  if (host && url.hostname !== host && !url.hostname.endsWith(`.${host}`)) fail(path, `must be on ${host}`);
  return raw;
}

function unique<T extends { id: string }>(items: T[], path: string) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(path, `has duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return items;
}

function anchor(value: unknown, path: string, legs: Set<string>): AdventureAnchor {
  const source = object(value, path, ["slug", "atDistanceM", "source"]);
  const slug = text(source.slug, `${path}.slug`);
  if (!legs.has(slug)) fail(`${path}.slug`, `names ${slug}, which is not one of the adventure's legs`);
  const coordinate = object(source.source, `${path}.source`, ["lat", "lng"]);
  const lat = finite(coordinate.lat, `${path}.source.lat`);
  const lng = finite(coordinate.lng, `${path}.source.lng`);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(`${path}.source`, "is not a coordinate");
  return { slug, atDistanceM: finite(source.atDistanceM, `${path}.atDistanceM`, 0), source: { lat, lng } };
}

function leg(value: unknown, path: string): AdventureLeg {
  const source = object(value, path, ["slug", "label"]);
  return { slug: text(source.slug, `${path}.slug`), label: text(source.label, `${path}.label`) };
}

function footage(value: unknown, path: string): AdventureFootage {
  const source = object(value, path, ["id", "kind", "title", "description", "src", "poster", "sha256"]);
  if (source.kind !== "video") fail(`${path}.kind`, "must be video");
  return {
    id: identifier(source.id, `${path}.id`),
    kind: "video",
    title: text(source.title, `${path}.title`),
    description: optionalText(source.description, `${path}.description`),
    src: mediaPath(source.src, `${path}.src`),
    poster: source.poster === undefined ? undefined : mediaPath(source.poster, `${path}.poster`),
    sha256: sha256(source.sha256, `${path}.sha256`),
  };
}

function chapter(value: unknown, path: string, legs: Set<string>, clips: Set<string>): AdventureChapter {
  const source = object(value, path, ["id", "title", "note", "footageId", "anchor"]);
  const footageId = optionalText(source.footageId, `${path}.footageId`);
  if (footageId && !clips.has(footageId)) fail(`${path}.footageId`, `names missing footage ${footageId}`);
  return {
    id: identifier(source.id, `${path}.id`),
    title: text(source.title, `${path}.title`),
    note: optionalText(source.note, `${path}.note`),
    footageId,
    anchor: anchor(source.anchor, `${path}.anchor`, legs),
  };
}

function vector(value: unknown, path: string): [number, number, number] {
  const items = list(value, path);
  if (items.length !== 3) fail(path, "must have three components");
  return [finite(items[0], `${path}[0]`), finite(items[1], `${path}[1]`), finite(items[2], `${path}[2]`)];
}

function shot(value: unknown, path: string): AdventureSceneShot {
  const source = object(value, path, ["atS", "title", "position", "target"]);
  return {
    atS: finite(source.atS, `${path}.atS`, 0),
    title: text(source.title, `${path}.title`),
    position: vector(source.position, `${path}.position`),
    target: vector(source.target, `${path}.target`),
  };
}

function scene(value: unknown, path: string, legs: Set<string>): AdventureScene {
  const source = object(value, path, [
    "id", "provider", "modelId", "title", "eyebrow", "description", "poster", "posterAlt", "attribution", "anchor", "tour",
  ]);
  if (source.provider !== "sketchfab") fail(`${path}.provider`, "must be sketchfab");
  const modelId = text(source.modelId, `${path}.modelId`);
  if (!/^[0-9a-f]{32}$/.test(modelId)) fail(`${path}.modelId`, "must be a Sketchfab model id");
  const attribution = object(source.attribution, `${path}.attribution`, ["author", "url"]);
  const tour = object(source.tour, `${path}.tour`, ["title", "fovDeg", "shots"]);
  const shots = list(tour.shots, `${path}.tour.shots`).map((item, index) => shot(item, `${path}.tour.shots[${index}]`));
  if (!shots.length) fail(`${path}.tour.shots`, "must not be empty");
  if (shots.some((item, index) => index > 0 && item.atS <= shots[index - 1].atS)) {
    fail(`${path}.tour.shots`, "must be in increasing time order");
  }
  return {
    id: identifier(source.id, `${path}.id`),
    provider: "sketchfab",
    modelId,
    title: text(source.title, `${path}.title`),
    eyebrow: optionalText(source.eyebrow, `${path}.eyebrow`),
    description: optionalText(source.description, `${path}.description`),
    poster: source.poster === undefined ? undefined : httpsUrl(source.poster, `${path}.poster`, "sketchfab.com"),
    posterAlt: text(source.posterAlt, `${path}.posterAlt`),
    attribution: {
      author: text(attribution.author, `${path}.attribution.author`),
      url: httpsUrl(attribution.url, `${path}.attribution.url`, "sketchfab.com"),
    },
    anchor: anchor(source.anchor, `${path}.anchor`, legs),
    tour: {
      title: text(tour.title, `${path}.tour.title`),
      fovDeg: tour.fovDeg === undefined ? undefined : finite(tour.fovDeg, `${path}.tour.fovDeg`, 1),
      shots,
    },
  };
}

function clip(value: Json, path: string, clips: Set<string>): AdventureClip {
  const footageId = text(value.footageId, `${path}.footageId`);
  if (!clips.has(footageId)) fail(`${path}.footageId`, `names missing footage ${footageId}`);
  const inS = finite(value.inS, `${path}.inS`, 0);
  const outS = finite(value.outS, `${path}.outS`, 0);
  if (outS <= inS) fail(path, "must end after it starts");
  return { footageId, inS, outS };
}

function beat(value: unknown, path: string, clips: Set<string>, scenes: Map<string, number>): AdventureFilmBeat {
  const kind = (value as Json | undefined)?.kind;
  if (kind === "footage") {
    const source = object(value, path, ["kind", "title", "footageId", "inS", "outS"]);
    return { kind, title: text(source.title, `${path}.title`), ...clip(source, path, clips) };
  }
  if (kind === "route") {
    const source = object(value, path, ["kind", "title", "durationS"]);
    return { kind, title: text(source.title, `${path}.title`), durationS: finite(source.durationS, `${path}.durationS`, 1) };
  }
  if (kind === "scene") {
    const source = object(value, path, ["kind", "title", "sceneId", "inS", "outS", "durationS", "fallback"]);
    const sceneId = text(source.sceneId, `${path}.sceneId`);
    const tourLength = scenes.get(sceneId);
    if (tourLength === undefined) fail(`${path}.sceneId`, `names missing scene ${sceneId}`);
    const inS = finite(source.inS, `${path}.inS`, 0);
    const outS = finite(source.outS, `${path}.outS`, 0);
    if (outS <= inS) fail(path, "must end after it starts");
    if (outS > tourLength) fail(path, `ends after its scene's tour (${tourLength} s)`);
    const durationS = finite(source.durationS, `${path}.durationS`, 1);
    const fallback = clip(object(source.fallback, `${path}.fallback`, ["footageId", "inS", "outS"]), `${path}.fallback`, clips);
    if (fallback.outS - fallback.inS < durationS) fail(`${path}.fallback`, "is shorter than the scene shot it replaces");
    return { kind, title: text(source.title, `${path}.title`), sceneId, inS, outS, durationS, fallback };
  }
  fail(`${path}.kind`, "must be footage, route or scene");
}

/** The adventure player's editorial limit: a film is a chapter, not a feature. */
const FILM_LIMIT_S = 180;

function film(value: unknown, path: string, clips: Set<string>, scenes: Map<string, number>): AdventureFilm {
  const source = object(value, path, ["title", "cta", "beats"]);
  const beats = list(source.beats, `${path}.beats`).map((item, index) => beat(item, `${path}.beats[${index}]`, clips, scenes));
  if (!beats.length) fail(`${path}.beats`, "must not be empty");
  const total = beats.reduce((sum, item) => sum + (item.kind === "footage" ? item.outS - item.inS : item.durationS), 0);
  if (total > FILM_LIMIT_S) fail(path, `runs ${Math.round(total)} s, longer than three minutes`);
  return { title: text(source.title, `${path}.title`), cta: text(source.cta, `${path}.cta`), beats };
}

export function parseAdventure(value: unknown): Adventure {
  const source = object(value, "document", [
    "schemaVersion", "id", "title", "subtitle", "location", "source", "legs", "chapters", "footage", "scenes", "film",
  ]);
  if (source.schemaVersion !== 1) fail("schemaVersion", "must be 1");
  const origin = object(source.source, "source", ["kind", "packId", "packSchemaVersion", "sha256"]);
  if (origin.kind !== "prepared-pack") fail("source.kind", "must be prepared-pack");

  const legs = list(source.legs, "legs").map((item, index) => leg(item, `legs[${index}]`));
  if (!legs.length) fail("legs", "must not be empty");
  const legSlugs = new Set(legs.map((item) => item.slug));
  if (legSlugs.size !== legs.length) fail("legs", "has a duplicate recording");

  const clips = unique(list(source.footage, "footage").map((item, index) => footage(item, `footage[${index}]`)), "footage");
  const clipIds = new Set(clips.map((item) => item.id));
  const scenes = unique(list(source.scenes, "scenes").map((item, index) => scene(item, `scenes[${index}]`, legSlugs)), "scenes");
  const chapters = unique(
    list(source.chapters, "chapters").map((item, index) => chapter(item, `chapters[${index}]`, legSlugs, clipIds)),
    "chapters",
  );

  return {
    schemaVersion: 1,
    id: identifier(source.id, "id"),
    title: text(source.title, "title"),
    subtitle: optionalText(source.subtitle, "subtitle"),
    location: optionalText(source.location, "location"),
    source: {
      kind: "prepared-pack",
      packId: text(origin.packId, "source.packId"),
      packSchemaVersion: finite(origin.packSchemaVersion, "source.packSchemaVersion", 1),
      sha256: sha256(origin.sha256, "source.sha256"),
    },
    legs,
    chapters,
    footage: clips,
    scenes,
    film: source.film === undefined ? undefined : film(source.film, "film", clipIds, new Map(scenes.map((item) => [item.id, item.tour.shots.at(-1)!.atS]))),
  };
}

export function parseAdventureIndex(value: unknown): AdventureIndex {
  const source = object(value, "index", ["schemaVersion", "adventures"]);
  if (source.schemaVersion !== 1) fail("index.schemaVersion", "must be 1");
  const adventures = list(source.adventures, "index.adventures").map((item, index) => {
    const path = `index.adventures[${index}]`;
    const entry = object(item, path, ["id", "title", "legs"]);
    const legs = list(entry.legs, `${path}.legs`).map((slug, legIndex) => text(slug, `${path}.legs[${legIndex}]`));
    if (!legs.length) fail(`${path}.legs`, "must not be empty");
    return { id: identifier(entry.id, `${path}.id`), title: text(entry.title, `${path}.title`), legs };
  });
  return { schemaVersion: 1, adventures: unique(adventures, "index.adventures") };
}
