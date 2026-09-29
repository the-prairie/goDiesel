#!/usr/bin/env node
// Stage one approved adventure into a built site (make-dist.sh's dist/).
//
//   GODIESEL_ADVENTURE_PUBLICATION_APPROVED=<id> \
//     node app/scripts/adventure-publication.mjs <id> <dist> [--dry-run] [--manifest <file>]
//
// Copies exactly: <id>/adventure.json, the media it references (each checked
// against its imported digest), and an index listing only this adventure.
// Import reports, publication plans and anything else in the store are never
// copied. Every leg's route must already be in the bundle, so an adventure is
// never published half-attached. Nothing is staged without the owner's
// approval for this exact adventure; choosing where the site is deployed, and
// for whom, stays outside this script.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseAdventure, parseAdventureIndex } from "../src/domain/adventure/parse.ts";

const DEFAULT_STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".adventures");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function stageAdventurePublication({ store = DEFAULT_STORE, id, dist, approval, dryRun = false }) {
  if (!id || approval !== id) {
    throw new Error(`Publishing adventure "${id}" needs the owner's approval for it: GODIESEL_ADVENTURE_PUBLICATION_APPROVED=${id}`);
  }
  const source = path.join(store, id);
  const adventure = parseAdventure(JSON.parse(fs.readFileSync(path.join(source, "adventure.json"), "utf8")));
  if (adventure.id !== id) throw new Error(`adventure.json in ${id} names ${adventure.id}`);

  for (const leg of adventure.legs) {
    if (!fs.existsSync(path.join(dist, "data", "routes", `${leg.slug}.json`))) {
      throw new Error(`Leg ${leg.slug} is not in this bundle; an adventure is published only with every recording it covers.`);
    }
  }

  const media = [...new Set(adventure.footage.flatMap((clip) => [clip.src, clip.poster].filter(Boolean)))];
  for (const clip of adventure.footage) {
    const file = path.join(source, clip.src);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== clip.sha256) {
      throw new Error(`Footage ${clip.id} (${clip.src}) is missing or no longer matches its imported digest.`);
    }
  }
  for (const relative of media) {
    if (!fs.existsSync(path.join(source, relative))) throw new Error(`Referenced media ${relative} is missing.`);
  }

  const index = parseAdventureIndex({ schemaVersion: 1, adventures: [{ id, title: adventure.title, legs: adventure.legs.map((leg) => leg.slug) }] });
  const outputs = [
    { relative: "index.json", bytes: Buffer.from(`${JSON.stringify(index, null, 2)}\n`) },
    { relative: `${id}/adventure.json`, bytes: Buffer.from(`${JSON.stringify(adventure, null, 2)}\n`) },
    ...media.map((relative) => ({ relative: `${id}/${relative}`, bytes: fs.readFileSync(path.join(source, relative)) })),
  ];
  const manifest = {
    adventure: id,
    legs: adventure.legs.map((leg) => leg.slug),
    sourceSha256: adventure.source.sha256,
    files: outputs.map(({ relative, bytes }) => ({ path: `adventures/${relative}`, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  if (dryRun) return manifest;

  const target = path.join(dist, "adventures");
  if (fs.existsSync(target)) throw new Error(`${target} already exists; stage into a fresh build.`);
  const staging = fs.mkdtempSync(path.join(dist, ".adventures-staging-"));
  try {
    for (const { relative, bytes } of outputs) {
      fs.mkdirSync(path.dirname(path.join(staging, relative)), { recursive: true });
      fs.writeFileSync(path.join(staging, relative), bytes);
    }
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const [id, dist] = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--manifest");
  const manifestFlag = args.indexOf("--manifest");
  try {
    const manifest = stageAdventurePublication({
      id,
      dist: path.resolve(dist ?? ""),
      approval: process.env.GODIESEL_ADVENTURE_PUBLICATION_APPROVED,
      dryRun: args.includes("--dry-run"),
    });
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    if (manifestFlag >= 0) fs.writeFileSync(args[manifestFlag + 1], text);
    process.stdout.write(text);
  } catch (error) {
    console.error(`Adventure publication failed: ${error.message}`);
    process.exit(1);
  }
}
