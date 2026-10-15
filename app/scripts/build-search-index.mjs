// Derived search cache only. Canonical route records remain owned by build.py.
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "@huggingface/transformers";
const manifest = JSON.parse(
  await fs.readFile(
    new URL("../src/data/generated/routes.manifest.json", import.meta.url),
  ),
);
const model = "Xenova/all-MiniLM-L6-v2";
const embed = await pipeline("feature-extraction", model, { dtype: "q8" });
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
  const output = await embed(text, { pooling: "mean", normalize: true });
  documents.push({
    slug: route.slug,
    text,
    terrain: c.terrain ?? [],
    highlights: c.highlights ?? [],
    hash: createHash("sha256").update(text).digest("hex"),
    vector: Array.from(output.data, (x) => Math.round(x * 1e6) / 1e6),
  });
}
await fs.writeFile(
  new URL("../public/search/collection.json", import.meta.url),
  JSON.stringify({ version: 1, model, documents }),
);
console.log(`Indexed ${documents.length} route guides with ${model}.`);
