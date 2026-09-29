// Expectations for the adventure verifiers, read from the local store at run
// time. Adventure copy is owner content, so none of it is written into these
// tracked scripts; they work for whichever adventure covers the given slug.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".adventures");

export function adventureExpectations(slug) {
  const index = JSON.parse(fs.readFileSync(path.join(STORE, "index.json"), "utf8"));
  const entry = index.adventures.find((item) => item.legs.includes(slug));
  if (!entry) throw new Error(`No local adventure covers ${slug}. Import one first (scripts/import-adventure.mjs).`);
  const adventure = JSON.parse(fs.readFileSync(path.join(STORE, entry.id, "adventure.json"), "utf8"));
  const legOrder = new Map(adventure.legs.map((leg, index) => [leg.slug, index]));
  const ordered = [...adventure.chapters].sort(
    (a, b) => legOrder.get(a.anchor.slug) - legOrder.get(b.anchor.slug) || a.anchor.atDistanceM - b.anchor.atDistanceM,
  ).map((chapter, index) => ({ ...chapter, ordinal: index + 1 }));
  const here = ordered.filter((chapter) => chapter.anchor.slug === slug);
  const elsewhere = ordered.filter((chapter) => chapter.anchor.slug !== slug);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    adventure,
    here,
    elsewhere,
    withFootage: here.filter((chapter) => chapter.footageId),
    scenesHere: adventure.scenes.filter((scene) => scene.anchor.slug === slug),
    filmCta: adventure.film ? new RegExp(escape(adventure.film.cta)) : undefined,
    escape,
  };
}
