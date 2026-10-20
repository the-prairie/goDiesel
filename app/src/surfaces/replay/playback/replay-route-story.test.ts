import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseRouteDetail } from "@/domain/route";
import { buildReplayChapterModel, replayChapterAt } from "./replay-chapter-model";
import { replayRouteStory } from "./replay-route-story";

const source = JSON.parse(readFileSync(new URL("../../../../public/data/routes/14736711660.json", import.meta.url), "utf8"));
const route = parseRouteDetail(source);

describe("place-led replay story", () => {
  it("takes the San Francisco route from Polk Gulch to Fisherman's Wharf in recorded order", () => {
    const model = buildReplayChapterModel(route);
    expect(model.chapters.map(chapter => chapter.label)).toEqual([
      "Polk Gulch to Presidio Heights", "The Richmond zipper", "Out to Ocean Beach",
      "Across Golden Gate Park", "Panhandle to Japantown", "Finish at Fisherman's Wharf",
    ]);
    expect(model.chapters[0].startM).toBe(0);
    expect(model.chapters.at(-1)?.endM).toBe(model.totalDistanceM);
    for (const [index, chapter] of model.chapters.entries()) {
      expect(chapter.story?.summary).toBeTruthy();
      expect(chapter.endM).toBeGreaterThan(chapter.startM);
      expect(replayChapterAt(model, chapter.startM)).toBe(chapter);
      if (index > 0) expect(chapter.startM).toBe(model.chapters[index - 1].endM);
    }
  });

  it("anchors sourced nearby places to actual samples inside their chapter", () => {
    const model = buildReplayChapterModel(route);
    for (const chapter of model.chapters) {
      expect(chapter.story!.places.length).toBeGreaterThan(0);
      let previous = chapter.startM;
      for (const place of chapter.story!.places) {
        expect(place.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);
        expect(place.atDistanceM).toBeGreaterThanOrEqual(previous);
        expect(place.atDistanceM).toBeLessThan(chapter.endM);
        const sample = route.route.find(point => point.d === place.atDistanceM)!;
        expect(sample).toBeDefined();
        const distanceM = Math.hypot((sample.lat - place.latitude) * 111_195,
          (sample.lng - place.longitude) * 111_195 * Math.cos(place.latitude * Math.PI / 180));
        expect(distanceM).toBeLessThan(250);
        previous = place.atDistanceM;
      }
    }
  });

  it("rejects stale story data after a change to any recorded coordinate or distance", () => {
    for (const field of ["lat", "lng", "d"] as const) {
      const changed = structuredClone(route);
      changed.route[100][field] += 0.001;
      expect(replayRouteStory(changed)).toBeUndefined();
      expect(buildReplayChapterModel(changed).chapters.every(chapter => !chapter.story)).toBe(true);
    }
    expect(replayRouteStory({ ...route, distanceKm: route.distanceKm + 1 })).toBeUndefined();
    const changedGaps = structuredClone(route);
    changedGaps.provenance.discontinuities = [];
    expect(replayRouteStory(changedGaps)).toBeUndefined();
  });

  it("does not assign San Francisco places to an unknown route", () => {
    expect(replayRouteStory({ ...route, activityId: "another-route" })).toBeUndefined();
    expect(buildReplayChapterModel({ ...route, activityId: "another-route" }).chapters).toHaveLength(4);
  });

  it("keeps story geography when only the activity title or elevation changes", () => {
    const changed = structuredClone(route);
    changed.activityName = "My renamed run";
    changed.route[100].elev += 2;
    expect(replayRouteStory(changed)).toEqual(replayRouteStory(route));
  });

  it("preserves the elevation moments when story chapters replace distance quarters", () => {
    const model = buildReplayChapterModel(route);
    const fallback = buildReplayChapterModel({ ...route, activityId: "another-route" });
    expect(model.moments).toEqual(fallback.moments);
    expect(model.segments).toEqual(fallback.segments);
    expect(model.chapters.reduce((sum, chapter) => sum + chapter.ascentM, 0))
      .toBeCloseTo(fallback.chapters.reduce((sum, chapter) => sum + chapter.ascentM, 0), 6);
  });
});
