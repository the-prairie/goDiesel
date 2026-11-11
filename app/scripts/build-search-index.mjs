// Derived search cache only. Canonical route records remain owned by build.py.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { routeMetadata } from "../src/domain/search/metadata.ts";
import { pipeline } from "@huggingface/transformers";
const manifest = JSON.parse(
  await fs.readFile(
    new URL("../src/data/generated/routes.manifest.json", import.meta.url),
  ),
);
const model = "Xenova/all-MiniLM-L6-v2";
let embed;
const previous = JSON.parse(await fs.readFile(new URL("../public/search/collection.json", import.meta.url))).documents;
const documents = [];
for (const summary of manifest.routes) {
  const route = JSON.parse(
    await fs.readFile(
      new URL(`../public/data/routes/${summary.slug}.json`, import.meta.url),
    ),
  );
  const c = route.curation ?? {};
  // Exclude caveats/seasonality: matching negated claims would imply unsupported qualities.
  const sections = [
    route.region,
    route.activity_name,
    c.vibe,
    c.ideal_use,
    ...(c.terrain ?? []),
    ...(c.highlights ?? []),
  ].filter(Boolean);
  const text = sections.join(". ");
  const hash = createHash("sha256").update(text).digest("hex");
  const cached = previous.find(doc => doc.slug === route.slug && doc.hash === hash && doc.vector.length === 384 && doc.vector.every(Number.isFinite));
  if (!cached) embed ??= await pipeline("feature-extraction", model, { dtype: "q8" });
  const vector = cached?.vector ?? Array.from((await embed(text, { pooling: "mean", normalize: true })).data, x => Math.round(x * 1e6) / 1e6);
  documents.push({
    slug: route.slug,
    text,
    metadata: routeMetadata(route),
    terrain: c.terrain ?? [],
    highlights: c.highlights ?? [],
    hash,
    vector,
  });
}
await fs.writeFile(
  new URL("../public/search/collection.json", import.meta.url),
  JSON.stringify({ version: 1, model, documents }),
);
console.log(`Indexed ${documents.length} route guides with ${model}.`);
