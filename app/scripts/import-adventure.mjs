#!/usr/bin/env node
// Import a prepared adventure pack into the local, ignored adventure store.
//
//   node scripts/import-adventure.mjs <pack-dir> [--legs slug,slug] [--rendered id=credit] [--dry-run]
//
// --rendered marks a clip made from someone else's imagery (an Earth Studio
// flyover, say). A pack cannot tell the importer that, so the owner does.
//
// The pack's own track is used only to locate its editorial anchors. Every
// chapter and scene is projected onto the canonical goDiesel recordings, the
// only route model the product has. Media is copied and digested; nothing is
// written inside the repository's tracked tree.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAdventure, parseAdventureIndex } from "../src/domain/adventure/parse.ts";
import { placeOnLegs } from "../src/domain/adventure/projection.ts";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = path.resolve(APP, "..", ".adventures");
const ROUTES = path.join(APP, "public", "data", "routes");
/** A prepared anchor must land this close to the canonical recording. */
const PLACEMENT_LIMIT_M = 75;

function usage(message) {
  if (message) console.error(`import-adventure: ${message}`);
  console.error("usage: node scripts/import-adventure.mjs <pack-dir> [--legs slug,slug] [--rendered id=credit] [--dry-run]");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const legsFlag = args.indexOf("--legs");
const explicitLegs = legsFlag >= 0 ? args[legsFlag + 1]?.split(",").filter(Boolean) : undefined;
const valueIndexes = new Set(args.flatMap((arg, index) => (arg === "--legs" || arg === "--rendered" ? [index + 1] : [])));
const rendered = new Map(args.flatMap((arg, index) => {
  if (arg !== "--rendered") return [];
  const [id, ...credit] = (args[index + 1] ?? "").split("=");
  if (!id || !credit.join("=").trim()) usage("--rendered needs id=credit");
  return [[id, credit.join("=").trim()]];
}));
const packDir = args.find((arg, index) => !arg.startsWith("--") && !valueIndexes.has(index));
if (!packDir) usage("a pack directory is required");

const packFile = path.resolve(packDir, "adventure.json");
if (!existsSync(packFile)) usage(`${packFile} does not exist`);
const packBytes = readFileSync(packFile);
const pack = JSON.parse(packBytes.toString("utf8"));
if (pack.schemaVersion !== 1) usage(`pack schemaVersion ${pack.schemaVersion} is not supported`);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function loadRecording(slug) {
  const file = path.join(ROUTES, `${slug}.json`);
  if (!existsSync(file)) usage(`canonical route ${slug} has no generated detail`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (raw.lifecycle === "planned") usage(`${slug} is planned; adventures attach to replayable recordings`);
  return {
    slug,
    name: raw.activity_name || raw.name,
    startTimeUtc: raw.provenance?.temporal?.start_time_utc,
    trace: raw.route.map((point) => ({ lat: point.lat, lng: point.lng, elev: point.elev, d: point.d })),
    gaps: (raw.provenance?.discontinuities ?? []).map((gap) => ({ kind: gap.kind, source: gap.source, startD: gap.start_d, endD: gap.end_d })),
  };
}

// The pack track, split into its recorded segments.
const ride = pack.rides[pack.defaultRideId];
const segments = [];
for (const point of ride.track.points) {
  const last = segments.at(-1);
  if (!last || last.index !== point.segment) segments.push({ index: point.segment, points: [point] });
  else last.points.push(point);
}

// Each pack segment is one canonical recording. Match by recorded start time
// unless the owner names the recordings explicitly.
function matchLegs() {
  if (explicitLegs) {
    if (explicitLegs.length !== segments.length) {
      usage(`--legs names ${explicitLegs.length} recordings but the pack has ${segments.length} segments`);
    }
    return explicitLegs.map(loadRecording);
  }
  const manifest = JSON.parse(readFileSync(path.join(APP, "src", "data", "generated", "routes.manifest.json"), "utf8"));
  return segments.map((segment) => {
    const time = segment.points[0].time;
    if (!time) usage(`segment ${segment.index} is untimed; name its recording with --legs`);
    const candidates = manifest.routes.map((route) => route.slug).map(loadRecordingQuiet).filter(Boolean)
      .filter((recording) => recording.startTimeUtc && Math.abs(Date.parse(recording.startTimeUtc) - Date.parse(time)) <= 120_000);
    if (candidates.length !== 1) usage(`segment ${segment.index} starting ${time} matched ${candidates.length} recordings; name them with --legs`);
    return loadRecording(candidates[0].slug);
  });
}

function loadRecordingQuiet(slug) {
  const file = path.join(ROUTES, `${slug}.json`);
  if (!existsSync(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (raw.lifecycle === "planned") return undefined;
  return { slug, startTimeUtc: raw.provenance?.temporal?.start_time_utc };
}

const legs = matchLegs();

/** The pack coordinate at a pack distance, and which segment holds it. */
function packCoordinate(m) {
  for (const [index, segment] of segments.entries()) {
    const points = segment.points;
    if (m < points[0].m - 0.5 || m > points.at(-1).m + 0.5) continue;
    let low = 0;
    while (low < points.length - 2 && points[low + 1].m <= m) low += 1;
    const a = points[low], b = points[Math.min(low + 1, points.length - 1)];
    const t = b.m > a.m ? Math.max(0, Math.min(1, (m - a.m) / (b.m - a.m))) : 0;
    return {
      segment: index,
      hintM: m - points[0].m,
      coordinate: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
    };
  }
  return undefined;
}

const report = [];

function place(kind, id, coordinate, hintM, legIndex) {
  const best = placeOnLegs(legs, coordinate, hintM, legIndex);
  const entry = {
    kind,
    id,
    slug: best && legs[best.legIndex].slug,
    atDistanceM: best && Math.round(best.hit.atDistanceM * 10) / 10,
    offsetM: best && Math.round(best.hit.offsetM * 10) / 10,
  };
  report.push(entry);
  if (!best || best.hit.offsetM > PLACEMENT_LIMIT_M) {
    throw new Error(`${kind} ${id} does not lie on the recordings (nearest ${entry.offsetM ?? "none"} m)`);
  }
  return { slug: entry.slug, atDistanceM: entry.atDistanceM, source: {
    lat: Math.round(coordinate.lat * 1e6) / 1e6,
    lng: Math.round(coordinate.lng * 1e6) / 1e6,
  } };
}

const identifier = (value) => String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const packMedia = (url) => path.resolve(packDir, url.replace(`/adventures/${pack.id}/`, ""));

for (const id of rendered.keys()) {
  if (!pack.footage.some((clip) => clip.id === id)) usage(`--rendered names ${id}, which the pack does not have`);
}
const footage = pack.footage.map((clip) => {
  const file = packMedia(clip.url);
  if (!existsSync(file)) throw new Error(`footage ${clip.id} is missing ${file}`);
  const poster = clip.poster ? packMedia(clip.poster) : undefined;
  return {
    entry: {
      id: identifier(clip.id),
      kind: "video",
      origin: rendered.has(clip.id) ? "rendered" : "recorded",
      credit: rendered.get(clip.id),
      title: clip.title,
      description: clip.description || undefined,
      src: `media/${path.basename(file)}`,
      poster: poster && existsSync(poster) ? `media/${path.basename(poster)}` : undefined,
      sha256: sha256(readFileSync(file)),
    },
    files: [file, poster].filter((item) => item && existsSync(item)),
  };
});

const chapters = ride.chapters.map((chapter) => {
  const located = packCoordinate(chapter.m);
  if (!located) throw new Error(`chapter ${chapter.id} at ${chapter.m} m is outside the pack track`);
  return {
    id: identifier(chapter.id),
    title: chapter.name,
    note: chapter.note || undefined,
    footageId: chapter.video ? identifier(chapter.video) : undefined,
    anchor: place("chapter", chapter.id, located.coordinate, located.hintM, located.segment),
  };
});

const scenes = (pack.worlds ?? []).filter((world) => world.approved && world.kind === "sketchfab").map((world) => {
  const place_ = pack.places?.[world.id] ?? {};
  const located = world.anchor.routeM === undefined ? undefined : packCoordinate(world.anchor.routeM);
  return {
    id: identifier(world.id),
    provider: "sketchfab",
    modelId: world.modelId,
    title: place_.name ?? world.tour.title,
    eyebrow: place_.eyebrow,
    description: place_.description,
    poster: world.photo ?? place_.photo,
    posterAlt: place_.alt ?? `Captured 3D scene: ${world.tour.title}`,
    attribution: { author: world.attribution.author, url: world.attribution.url },
    // A pack distance names the recording, as for chapters; without one the
    // nearest recording is used (see placeOnLegs).
    anchor: place("scene", world.id, { lat: world.anchor.lat, lng: world.anchor.lng }, located?.hintM, located?.segment),
    tour: {
      title: world.tour.title,
      fovDeg: world.tour.fov,
      shots: world.tour.shots.map((shot) => ({ atS: shot.at, title: shot.title, position: shot.position, target: shot.target })),
    },
  };
});

const beat = (source) => {
  if (source.kind === "video") return { kind: "footage", title: source.title, footageId: identifier(source.footageId), inS: source.in, outS: source.out };
  if (source.kind === "route") return { kind: "route", title: source.title, durationS: source.duration };
  if (source.kind === "scene") {
    return {
      kind: "scene", title: source.title, sceneId: identifier(source.sceneId), inS: source.in, outS: source.out, durationS: source.duration,
      fallback: { footageId: identifier(source.fallback.footageId), inS: source.fallback.in, outS: source.fallback.out },
    };
  }
  throw new Error(`film beat kind ${source.kind} is not supported`);
};

const adventure = parseAdventure(JSON.parse(JSON.stringify({
  schemaVersion: 1,
  id: identifier(pack.id),
  title: pack.title,
  subtitle: pack.copy?.intro || undefined,
  location: pack.copy?.location || undefined,
  source: { kind: "prepared-pack", packId: pack.id, packSchemaVersion: pack.schemaVersion, sha256: sha256(packBytes) },
  legs: legs.map((leg, index) => ({ slug: leg.slug, label: leg.name ?? `Recording ${index + 1}` })),
  chapters,
  footage: footage.map((clip) => clip.entry),
  scenes,
  film: pack.film ? { title: pack.film.title, cta: pack.film.cta, beats: pack.film.beats.map(beat) } : undefined,
})));

console.log(JSON.stringify({ adventure: adventure.id, legs: adventure.legs, placements: report }, null, 2));
if (dryRun) process.exit(0);

const target = path.join(STORE, adventure.id);
mkdirSync(path.join(target, "media"), { recursive: true });
for (const clip of footage) for (const file of clip.files) copyFileSync(file, path.join(target, "media", path.basename(file)));
for (const clip of adventure.footage) {
  if (sha256(readFileSync(path.join(target, clip.src))) !== clip.sha256) throw new Error(`copied ${clip.src} does not match its digest`);
}
writeFileSync(path.join(target, "adventure.json"), `${JSON.stringify(adventure, null, 2)}\n`);
writeFileSync(path.join(target, "import-report.json"), `${JSON.stringify({ importedFrom: packFile, placements: report }, null, 2)}\n`);

const index = parseAdventureIndex({
  schemaVersion: 1,
  adventures: readdirSync(STORE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(STORE, entry.name, "adventure.json")))
    .map((entry) => parseAdventure(JSON.parse(readFileSync(path.join(STORE, entry.name, "adventure.json"), "utf8"))))
    .map((item) => ({ id: item.id, title: item.title, legs: item.legs.map((leg) => leg.slug) })),
});
writeFileSync(path.join(STORE, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${path.relative(path.resolve(APP, ".."), target)}`);
