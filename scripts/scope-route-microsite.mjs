#!/usr/bin/env node
// Prune a single-route dist to the shared route's own static files (ADR-0011).
// make-dist.sh already reduces dist/data to the route's detail file. Media and
// cover artwork are named per route, so everything the route does not
// reference is removed and only referenced files are copied back.

import fs from "node:fs";
import path from "node:path";

const [routeSlug] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`Route microsite scoping failed: ${message}`);
  process.exit(1);
}

function collectMediaReferences(value, references = new Set()) {
  if (typeof value === "string" && value.startsWith("media/")) {
    references.add(value);
    return references;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaReferences(item, references);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMediaReferences(item, references);
  }
  return references;
}

if (!routeSlug || !/^[A-Za-z0-9._-]+$/.test(routeSlug)) {
  fail("provide a safe route slug");
}

const routePath = path.join(root, "dist/data/routes", `${routeSlug}.json`);
let route;
try {
  route = JSON.parse(fs.readFileSync(routePath, "utf8"));
} catch (error) {
  fail(`could not read ${routeSlug}.json (${error.name})`);
}

const media = collectMediaReferences(route);
for (const reference of media) {
  if (
    path.posix.normalize(reference) !== reference ||
    !reference.startsWith(`media/${routeSlug}/`)
  ) {
    fail(`route media reference is outside media/${routeSlug}: ${reference}`);
  }
  if (!fs.existsSync(path.join(root, "app/dist", reference))) {
    fail(`referenced media is missing from the app build: ${reference}`);
  }
}

// Cover artwork lives at route-covers/<slug>.webp and <slug>-ai.webp.
const coverDirectory = path.join(root, "app/dist/route-covers");
const covers = fs.existsSync(coverDirectory)
  ? fs
      .readdirSync(coverDirectory)
      .filter((name) => name.startsWith(`${routeSlug}.`) || name.startsWith(`${routeSlug}-`))
      .map((name) => `route-covers/${name}`)
  : [];

const keep = [...media, ...covers];
for (const directory of ["media", "route-covers"]) {
  fs.rmSync(path.join(root, "dist", directory), { recursive: true, force: true });
}
for (const reference of keep) {
  const destination = path.join(root, "dist", reference);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, "app/dist", reference), destination);
}

// The Vite single-route plugin filters the search index while writing the
// bundle. Refuse to continue if it did not.
const indexPath = path.join(root, "dist/search/collection.json");
if (fs.existsSync(indexPath)) {
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if ((index.documents ?? []).some((document) => document?.slug !== routeSlug)) {
    fail("the search index contains another route");
  }
}

console.log(`Scoped route media and covers to ${keep.length} referenced files.`);
