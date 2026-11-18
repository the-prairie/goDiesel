// The sketch world's and planted moments' budgets, by when each chunk loads
// (2026-11-14, round 14). Every sketch-*, moment-* and moments-* chunk must
// fall in exactly one bucket, so a new chunk cannot escape the budgets.

export const LAB_BUCKETS = [
  {
    id: "sketch-opening",
    // The hard one. Raise it only with an opening-time measurement alongside
    // (slow 4G + 4x CPU, the round 7 method): it is what every visit loads.
    label: "the sketch world at opening (page, edge worker, reveal)",
    match: /^sketch-(world-page|edge-worker|reveal)-[\w-]+\.js$/,
    kib: 84,
  },
  { id: "sketch-real-view", label: "the real-city view (?real=1, zoomed into a covered city)", match: /^sketch-real-view-[\w-]+\.js$/, kib: 9 },
  { id: "sketch-real-page", label: "the retired ink hand-over page (its own lab route)", match: /^sketch-real-page-[\w-]+\.js$/, kib: 4 },
  { id: "moments-world", label: "planted moments with the world (catalog, hand-over, layer and marker)", match: /^moment-(catalog|handover|layer)-[\w-]+\.js$/, kib: 15 },
  // Each kind's scene, loaded when she opens one: 8 KiB each. A second kind
  // gets its own 8 KiB (add it here), not a share of this one.
  { id: "moment-scene", label: "a moment's scene", match: /^moment-(tv-wall)-[\w-]+\.js$/, kib: 8, each: true },
  { id: "moment-review", label: "her review mode (?review=1)", match: /^moment-review-[\w-]+\.js$/, kib: 10 },
  { id: "moments-catalog-page", label: "her moments catalog page", match: /^moments-catalog-page-[\w-]+\.js$/, kib: 6 },
];

const FAMILY = /^(sketch|moment|moments)-[\w-]+\.js$/;

/** Each lab chunk's bucket; and those in none, or more than one. */
export function bucketChunks(names) {
  const buckets = new Map(LAB_BUCKETS.map((bucket) => [bucket.id, []]));
  const unassigned = [];
  const ambiguous = [];
  for (const name of names) {
    if (!FAMILY.test(name)) continue;
    const hits = LAB_BUCKETS.filter((bucket) => bucket.match.test(name));
    if (hits.length === 0) unassigned.push(name);
    else if (hits.length > 1) ambiguous.push(name);
    else buckets.get(hits[0].id).push(name);
  }
  return { buckets, unassigned, ambiguous };
}

/** The buckets over budget (a bucket marked `each` counts each chunk alone). */
export function overBudget(buckets, sizeOf) {
  const over = [];
  for (const bucket of LAB_BUCKETS) {
    const names = buckets.get(bucket.id) ?? [];
    const sizes = bucket.each ? names.map(sizeOf) : [names.reduce((sum, name) => sum + sizeOf(name), 0)];
    for (const bytes of sizes) if (bytes > bucket.kib * 1024) over.push({ id: bucket.id, label: bucket.label, kib: bucket.kib, bytes });
  }
  return over;
}
