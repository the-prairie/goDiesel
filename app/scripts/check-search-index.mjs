import { routeMetadata } from "../src/domain/search/metadata.ts";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const manifest = JSON.parse(
  await fs.readFile(
    new URL("../src/data/generated/routes.manifest.json", import.meta.url),
  ),
);
const index = JSON.parse(
  await fs.readFile(
    new URL("../public/search/collection.json", import.meta.url),
  ),
);
if (index.documents.length !== manifest.routes.length)
  throw Error("Search index needs rebuilding: npm run search:index");
for (const summary of manifest.routes) {
  const route = JSON.parse(
    await fs.readFile(
      new URL(`../public/data/routes/${summary.slug}.json`, import.meta.url),
    ),
  );
  const c = route.curation ?? {};
  const text = [
    route.region,
    route.activity_name,
    c.vibe,
    c.ideal_use,
    ...(c.terrain ?? []),
    ...(c.highlights ?? []),
  ]
    .filter(Boolean)
    .join(". ");
  const doc = index.documents.find((d) => d.slug === summary.slug);
  if (
    !doc ||
    JSON.stringify(doc.metadata) !== JSON.stringify(routeMetadata(route)) ||
    doc.hash !== createHash("sha256").update(text).digest("hex") ||
    doc.vector.length !== 384 ||
    doc.vector.some((v) => !Number.isFinite(v))
  )
    throw Error(`Stale search index for ${summary.slug}: npm run search:index`);
}
console.log(
  `Search index fresh: ${index.documents.length} guides, 384-dimensional embeddings.`,
);
