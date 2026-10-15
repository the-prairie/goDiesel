import type { DiscoveryCandidate, FinderIntent } from "../planning";
import { distanceBounds } from "./intent";
export interface SearchDocument {
  slug: string;
  text: string;
  terrain: string[];
  highlights: string[];
  vector: number[];
}
export const tokens = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
const stop = new Set(
  "a an the my me i want would something like similar to with and or of in near around past through along some find please for less than under at most km m run running ride cycling route routes".split(
    " ",
  ),
);
export const words = (text: string) =>
  tokens(text).filter((w) => !stop.has(w) && !/^\d+$/.test(w));
export function rankCollection(
  candidates: DiscoveryCandidate[],
  intent: FinderIntent,
  docs: SearchDocument[] = [],
  vector?: number[],
) {
  const [min, max] = distanceBounds(intent);
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  const query = words(
    intent.similarPlace ? intent.vibe : `${intent.query ?? ""} ${intent.vibe}`,
  );
  // A negative comparison in a guide is not evidence for that experience.
  const positiveText = (text: string) => text.split(/(?<=[.!?])\s+/).map(sentence =>
    sentence.replace(/\b(?:rather than|instead of|not|without|no)\b[^.!?]*/gi, "")
  ).join(" ");
  const df = new Map<string, number>();
  const texts = candidates.map((c) =>
    words(
      positiveText(bySlug.get(c.sourceRouteSlug)?.text ??
        `${c.route.region} ${c.route.guide.vibe ?? ""} ${c.vibes.join(" ")}`),
    ),
  );
  for (const text of texts)
    for (const word of new Set(text)) df.set(word, (df.get(word) ?? 0) + 1);
  const avg =
    texts.reduce((n, t) => n + t.length, 0) / Math.max(1, texts.length);
  const seed = intent.similarPlace
    ? candidates.find(
        (c) =>
          c.route.type === intent.activity &&
          c.route.region
            .toLowerCase()
            .includes(intent.similarPlace!.toLowerCase()),
      )
    : undefined;
  if (
    intent.similarPlace &&
    (!seed || !bySlug.get(seed.sourceRouteSlug)?.vector)
  )
    return [];
  const semantic = seed ? bySlug.get(seed.sourceRouteSlug)?.vector : vector;
  return candidates
    .flatMap((candidate, i) => {
      const r = candidate.route;
      const doc = bySlug.get(candidate.sourceRouteSlug);
      if (
        r.type !== intent.activity ||
        r.distanceKm < min ||
        r.distanceKm > max ||
        (intent.maxElevationM != null &&
          r.elevationGainM > intent.maxElevationM)
      )
        return [];
      if (
        intent.place &&
        !` ${tokens(`${r.region} ${doc?.text ?? r.guide.vibe ?? ""}`).join(" ")} `.includes(
          ` ${tokens(intent.place).join(" ")} `,
        )
      )
        return [];
      if (seed?.sourceRouteSlug === candidate.sourceRouteSlug) return [];
      // Terrain can be editorial evidence, but never inferred from model similarity.
      const terrainText =
        `${candidate.terrain.join(" ")} ${doc?.terrain.join(" ") ?? ""}`.toLowerCase();
      if (intent.terrain !== "any" && !terrainText.includes(intent.terrain))
        return [];
      const text = texts[i];
      const beachRequest = query.includes("beach");
      if (beachRequest && !text.includes("beach") && !text.includes("beaches")) return [];
      let lexical = 0;
      const hits = query.filter((w) => text.includes(w));
      for (const word of new Set(query)) {
        const tf = text.filter((w) => w === word).length;
        const idf = Math.log(
          1 +
            (candidates.length - (df.get(word) ?? 0) + 0.5) /
              ((df.get(word) ?? 0) + 0.5),
        );
        lexical +=
          (idf * tf * 2.2) /
          (tf + 1.2 * (0.25 + (0.75 * text.length) / Math.max(1, avg)));
      }
      const cosine =
        semantic && doc?.vector.length === semantic.length
          ? doc.vector.reduce((sum, v, j) => sum + v * semantic[j], 0)
          : 0;
      // Never fill an unrelated search with arbitrary nearest neighbours.
      if (query.length && !hits.length && cosine < 0.38) return [];
      const evidence = [
        ...(seed
          ? [
              `Related to your ${seed.route.distanceKm.toFixed(1)} km ${seed.route.region} route`,
            ]
          : []),
        `${r.distanceKm.toFixed(1)} km`,
        `${Math.round(r.elevationGainM)} m climbing`,
        r.region,
      ];
      if (intent.terrain !== "any")
        evidence.push(`${intent.terrain} terrain in the guide`);
      const excerpt = doc?.highlights.find((h) =>
        hits.some((w) => words(positiveText(h)).includes(w)) || (beachRequest && /coast|shoreline/i.test(h)),
      );
      if (excerpt) evidence.push(`Guide: ${excerpt}`);
      else if (hits.length)
        evidence.push(
          `Guide mentions ${[...new Set(hits)].slice(0, 3).join(", ")}`,
        );
      else if (cosine >= 0.38) evidence.push("Related guide themes");
      return [
        {
          candidate: { ...candidate, displayTitle: doc?.highlights[0], matchEvidence: excerpt ? `Guide: ${excerpt}` : evidence.join(" · ") },
          score:
            (lexical / (lexical + 4)) * 0.6 +
            Math.max(0, cosine) * 0.4 +
            (intent.distanceKm
              ? 0.05 / (1 + Math.abs(r.distanceKm - intent.distanceKm))
              : 0),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.route.slug.localeCompare(b.candidate.route.slug),
    )
    .map((x) => x.candidate);
}
