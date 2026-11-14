import { describe, expect, it } from "vitest";

import { LAB_BUCKETS, bucketChunks, overBudget } from "../../../scripts/sketch-budgets.mjs";

const built = [
  "sketch-world-page-AbC123xy.js",
  "sketch-edge-worker-Def456gh.js",
  "sketch-reveal-Ghi789jk.js",
  "sketch-real-view-Jkl012mn.js",
  "sketch-real-page-Mno345pq.js",
  "moment-catalog-Pqr678st.js",
  "moment-handover-Stu901vw.js",
  "moment-layer-Vwx234yz.js",
  "moment-tv-wall-Yza567bc.js",
  "moment-review-Bcd890ef.js",
  "moments-catalog-page-Efg123hi.js",
  "index-Zzz999zz.js",
];

describe("the sketch world's and moments' budgets, by when they load", () => {
  it("puts every sketch and moment chunk in exactly one bucket, and leaves the rest alone", () => {
    const { buckets, unassigned, ambiguous } = bucketChunks(built);
    expect(unassigned).toEqual([]);
    expect(ambiguous).toEqual([]);
    expect(buckets.get("sketch-opening")).toEqual(["sketch-world-page-AbC123xy.js", "sketch-edge-worker-Def456gh.js", "sketch-reveal-Ghi789jk.js"]);
    expect(buckets.get("moment-scene")).toEqual(["moment-tv-wall-Yza567bc.js"]);
    expect([...buckets.values()].flat()).not.toContain("index-Zzz999zz.js");
  });

  it("names a new sketch or moment chunk that no bucket covers, so it cannot escape the budgets", () => {
    expect(bucketChunks([...built, "sketch-shared-Qqq111qq.js", "moment-new-kind-Rrr222rr.js"]).unassigned).toEqual(["sketch-shared-Qqq111qq.js", "moment-new-kind-Rrr222rr.js"]);
  });

  it("holds the opening to its own budget, and each scene to its own", () => {
    const kib = (n: number) => n * 1024;
    const sizes = new Map(built.map((name) => [name, kib(1)]));
    sizes.set("sketch-world-page-AbC123xy.js", kib(83));
    expect(overBudget(bucketChunks(built).buckets, (name) => sizes.get(name)!)).toEqual([expect.objectContaining({ id: "sketch-opening", kib: 84 })]);
    sizes.set("sketch-world-page-AbC123xy.js", kib(60));
    sizes.set("moment-tv-wall-Yza567bc.js", kib(8.5));
    expect(overBudget(bucketChunks(built).buckets, (name) => sizes.get(name)!).map((over) => over.id)).toEqual(["moment-scene"]);
    expect(LAB_BUCKETS.find((bucket) => bucket.id === "sketch-opening")?.kib).toBe(84);
  });
});
