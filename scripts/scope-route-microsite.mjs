#!/usr/bin/env node

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
  fail(`could not read ${routePath} (${error.message})`);
}

const expected = collectMediaReferences(route);
for (const reference of expected) {
  if (
    path.posix.normalize(reference) !== reference ||
    !reference.startsWith(`media/${routeSlug}/`)
  ) {
    fail(`route media reference is outside media/${routeSlug}: ${reference}`);
  }
}

const mediaRoot = path.join(root, "dist/media");
for (const reference of expected) {
  if (!fs.existsSync(path.join(root, "app/dist", reference))) {
    fail(`referenced media is missing from the app build: ${reference}`);
  }
}

fs.rmSync(mediaRoot, { recursive: true, force: true });
for (const reference of expected) {
  const source = path.join(root, "app/dist", reference);
  const destination = path.join(root, "dist", reference);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

console.log(`Scoped route media to ${expected.size} referenced files.`);
