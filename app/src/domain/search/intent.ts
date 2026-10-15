import type { FinderIntent } from "../planning";

// These describe an experience, not a destination for the geocoder.
export const isExperienceQuery = (query: string) => /\b(beach|coast|coastal|seaside|shoreline|forest|woodland|waterfront|scenic|quiet|hilly|flat|mountain|trail)\b/i.test(query);

/** Deliberately bounded interpretation. Unrecognised prose remains a text query. */
export function interpretQuery(
  query: string,
  base: FinderIntent,
  regions: string[],
): FinderIntent {
  const q = query.trim().slice(0, 300);
  const number = "(\\d+(?:\\.\\d+)?)";
  const range = q.match(
    new RegExp(
      `${number}\\s*(?:-|–|to)\\s*${number}\\s*(?:km|kilomet(?:er|re)s?)`,
      "i",
    ),
  );
  const distance = q.match(
    new RegExp(`${number}\\s*(?:km|kilomet(?:er|re)s?)`, "i"),
  );
  const minimum = q.match(
    new RegExp(
      `(?:over|at least|more than)\\s*${number}\\s*(?:km|kilomet(?:er|re)s?)`,
      "i",
    ),
  );
  const maximum = q.match(
    new RegExp(
      `(?:under|less than|below|at most)\\s*${number}\\s*(?:km|kilomet(?:er|re)s?)`,
      "i",
    ),
  );
  const climb = q.match(
    new RegExp(
      `(?:under|less than|below|at most|maximum|max)\\s*${number}\\s*(?:m|met(?:er|re)s)\\b`,
      "i",
    ),
  );
  const cities = [
    ...new Set(regions.flatMap((r) => [r, r.split(",")[0]])),
  ].sort((a, b) => b.length - a.length);
  const city = cities.find((r) =>
    ` ${q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(
      ` ${r.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `,
    ),
  );
  const near = q
    .match(
      /\b(?:near|around|in)\s+([\p{L}][\p{L}\s,.'’-]*?)(?=\s+(?:with|under|between|for|around|less|about|\d)|[.;]|$)/iu,
    )?.[1]
    .trim();
  const similar = /\b(?:like|similar to)\b/i.test(q);
  const isProse =
    /\b(run|ride|trail|coastal|near|with|like|km|climb|hiking|cycling|running)\b/i.test(
      q,
    );
  const target = distance ? Number(distance[1]) : isProse ? 0 : base.distanceKm;
  return {
    ...base,
    query: q,
    place: similar ? "" : (city ?? near ?? (isProse || isExperienceQuery(q) ? "" : q)),
    activity: /\b(ride|cycling|cycle|bike)\b/i.test(q)
      ? "Ride"
      : /\b(run|running|hike|hiking)\b/i.test(q)
        ? "Run"
        : base.activity,
    distanceKm: range ? (Number(range[1]) + Number(range[2])) / 2 : target,
    minDistanceKm: range
      ? Math.min(Number(range[1]), Number(range[2]))
      : minimum
        ? Number(minimum[1])
        : undefined,
    maxDistanceKm: range
      ? Math.max(Number(range[1]), Number(range[2]))
      : maximum
        ? Number(maximum[1])
        : undefined,
    maxElevationM: climb ? Number(climb[1]) : undefined,
    terrain: /\btrail\b/i.test(q)
      ? "trail"
      : /\broad\b/i.test(q)
        ? "road"
        : /\bmountain\b/i.test(q)
          ? "mountain"
          : base.terrain,
    similarPlace: similar ? city : undefined,
  };
}

export function distanceBounds(intent: FinderIntent): [number, number] {
  if (intent.minDistanceKm != null || intent.maxDistanceKm != null)
    return [intent.minDistanceKm ?? 0, intent.maxDistanceKm ?? Infinity];
  if (!intent.distanceKm) return [0, Infinity];
  const tolerance = Math.max(3, intent.distanceKm * 0.3);
  return [
    Math.max(0, intent.distanceKm - tolerance),
    intent.distanceKm + tolerance,
  ];
}
