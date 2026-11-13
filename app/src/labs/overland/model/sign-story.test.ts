import { describe, expect, it } from "vitest";

import type { RouteAnnotation } from "@/domain/route";
import { SIGN_STORY_LINES, signPolaroids, signStoryPages } from "@/labs/overland/model/sign-story";

// One unit per grapheme keeps the arithmetic readable.
const measure = (text: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;

const SIGN = { number: 65, title: "🍑🍑🍑🍑💦💦💦💦", km: 21.3, date: "2025-11-24" };

function image(id: string, atDistanceM: number, media = true): RouteAnnotation {
  return {
    id,
    atDistanceM,
    kind: "image",
    evidence: "recorded",
    body: `body ${id}`,
    title: `title ${id}`,
    ...(media ? { media: { url: `media/${id}.jpg`, thumbUrl: `media/${id}-thumb.jpg`, width: 900, height: 1600 } } : {}),
  };
}

describe("signStoryPages", () => {
  it("is one clean page without a note: her title exactly, the distance and the date", () => {
    const pages = signStoryPages({ ...SIGN, note: null }, 40, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual({ kind: "facts", heading: "No. 065", lines: ["🍑🍑🍑🍑💦💦💦💦"], facts: "21.3 km · 24 Nov 2025" });
  });

  it("treats an empty or blank note as no note, never an empty page", () => {
    expect(signStoryPages({ ...SIGN, note: "" }, 40, measure)).toHaveLength(1);
    expect(signStoryPages({ ...SIGN, note: "   \n " }, 40, measure)).toHaveLength(1);
  });

  it("puts her note on the pages after, every word kept, in order, broken only between words", () => {
    const note = "too busy weeping to notice my camera was shooting upside down??????? and then the long way home through the hills";
    const pages = signStoryPages({ ...SIGN, note }, 16, measure);
    const noteLines = pages.slice(1).flatMap((page) => page.lines);
    expect(pages.slice(1).every((page) => page.kind === "note" && page.lines.length <= SIGN_STORY_LINES)).toBe(true);
    expect(noteLines.join(" ")).toBe(note);
    for (const line of noteLines) expect(note.split(" ")).toEqual(expect.arrayContaining(line.split(" ")));
  });

  it("keeps her line breaks as breaks", () => {
    const pages = signStoryPages({ ...SIGN, note: "first line\nsecond line" }, 40, measure);
    expect(pages[1].lines).toEqual(["first line", "second line"]);
  });

  it("wraps a long title over several lines of the first page rather than cutting it", () => {
    const title = "i love goooooooolddddddddd and the hills";
    const pages = signStoryPages({ ...SIGN, title, note: null }, 12, measure);
    expect(pages[0].lines.length).toBeGreaterThan(1);
    expect(pages[0].lines.join("").replace(/ /g, "")).toBe(title.replace(/ /g, ""));
  });
});

describe("signPolaroids", () => {
  it("hangs up to three photos, in the order they are met along the route", () => {
    const annotations = [image("c", 300), image("a", 100), image("b", 200), image("d", 400)].sort((x, y) => x.atDistanceM - y.atDistanceM);
    expect(signPolaroids(annotations).map((annotation) => annotation.id)).toEqual(["a", "b", "c"]);
  });

  it("skips written annotations and images without media", () => {
    const note: RouteAnnotation = { id: "n", atDistanceM: 50, kind: "note", evidence: "hypothesis", body: "x" };
    expect(signPolaroids([note, image("x", 60, false), image("y", 70)]).map((annotation) => annotation.id)).toEqual(["y"]);
    expect(signPolaroids([])).toEqual([]);
  });
});
