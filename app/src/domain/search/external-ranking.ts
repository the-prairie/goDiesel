import type { FinderIntent } from "../planning";
import type { ExternalRoute } from "./external";
import { words } from "./ranking";
export function externalSearchText(r: ExternalRoute) {
  return `${r.name}. ${r.description ?? ""} ${r.surface ? `Surface: ${r.surface}.` : ""}`;
}
export function rankExternalRoutes(
  routes: ExternalRoute[],
  query: string,
  vectors?: number[][],
) {
  const terms = [...new Set(words(query))];
  return routes
    .map((route, i) => {
      const text = words(externalSearchText(route));
      const hits = terms.filter((t) => text.includes(t));
      const semantic =
        vectors?.[0] && vectors[i + 1]?.length === vectors[0].length
          ? vectors[0].reduce((n, v, j) => n + v * vectors[i + 1][j], 0)
          : 0;
      // A bare place/trail name is weak evidence for an experiential theme.
      // Exact name matches still retain their full lexical score.
      const evidenceWeight = route.description?.trim() ? 1 : 0.45;
      const score =
        (terms.length ? hits.length / terms.length : 0) * 0.55 +
        Math.max(0, semantic) * 0.45 * evidenceWeight;
      const reason = hits.length
        ? `Source mentions ${hits.slice(0, 3).join(", ")}`
        : semantic >= 0.3 && route.description?.trim()
          ? "Related to your description"
          : "";
      return { route, score, reason };
    })
    .sort(
      (a, b) => b.score - a.score || a.route.name.localeCompare(b.route.name),
    );
}

export function discoveryPreference(intent: FinderIntent) {
  let query = intent.query ?? "";
  if (intent.place)
    query = query.replace(
      new RegExp(intent.place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      " ",
    );
  // Ranking considers the experience requested; geography and numeric limits
  // are already enforced separately and would otherwise dominate embeddings.
  query = query.replace(
    /\b(?:under|over|at least|at most|around|about|between|max(?:imum)?)?\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:km|kilomet(?:er|re)s?|m|met(?:er|re)s?)(?:\s*(?:climb(?:ing)?|ascent))?\b/gi,
    " ",
  );
  return words(`${query} ${intent.vibe}`).join(" ");
}
