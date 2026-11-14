import { describe, expect, it } from "vitest";

import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import {
  entryBoxText,
  formatEntryDate,
  pageLines,
  realmBoxContent,
  routeNumberLabel,
  wrapText,
} from "@/labs/overland/model/text-box";

const entry = (overrides: Partial<OverlandEntry> = {}): OverlandEntry => ({
  number: 7,
  slug: "17665674778",
  title: "crosswalk sprints",
  note: "could not figure out how to cross the bridge 💀💀💀💀",
  place: "Tokyo, Japan",
  date: "2025-11-26",
  km: 21.8,
  climbM: 286,
  kind: "run",
  ...overrides,
});

// One unit per grapheme, so a test can count what fits.
const perGrapheme = (text: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;

describe("route facts and labels", () => {
  it("numbers a route with three digits", () => {
    expect(routeNumberLabel(7)).toBe("No. 007");
    expect(routeNumberLabel(66)).toBe("No. 066");
    expect(routeNumberLabel(1234)).toBe("No. 1234");
  });

  it("writes a date plainly, without a time zone shift", () => {
    expect(formatEntryDate("2025-11-26")).toBe("26 Nov 2025");
    expect(formatEntryDate("2021-06-05")).toBe("5 Jun 2021");
  });
});

describe("entryBoxText", () => {
  it("shows her note exactly when there is one", () => {
    expect(entryBoxText(entry())).toBe("could not figure out how to cross the bridge 💀💀💀💀");
  });

  it("shows the route's facts, and no sentence about a missing note, when there is none", () => {
    const text = entryBoxText(entry({ note: null }));
    expect(text).toBe("Tokyo, Japan · 26 Nov 2025 · 21.8 km");
    expect(text.toLowerCase()).not.toContain("note");
  });
});

describe("realmBoxContent", () => {
  it("carries the route number, her title, progress and her note", () => {
    expect(realmBoxContent(entry(), 3.42)).toEqual({
      heading: "No. 007",
      title: "crosswalk sprints",
      progress: "3.4 / 21.8 km",
      body: "could not figure out how to cross the bridge 💀💀💀💀",
    });
  });

  it("falls back to the facts for the body, and never shows more than the route's distance", () => {
    expect(realmBoxContent(entry({ note: null }), 99)).toMatchObject({
      progress: "21.8 / 21.8 km",
      body: "Tokyo, Japan · 26 Nov 2025 · 21.8 km",
    });
  });
});

describe("wrapText", () => {
  it("breaks between words to fit the width", () => {
    expect(wrapText("i love goooooooolddddddddd", 12, perGrapheme)).toEqual([
      "i love",
      "goooooooolddddddddd".slice(0, 12),
      "goooooooolddddddddd".slice(12),
    ]);
  });

  it("counts an emoji as one character and never splits it", () => {
    expect(wrapText("🍑🍑🍑🍑💦💦💦💦", 3, perGrapheme)).toEqual(["🍑🍑🍑", "🍑💦💦", "💦💦"]);
  });

  it("keeps every character of her words, in order", () => {
    const note = "could not figure out how to cross the bridge 💀💀💀💀";
    expect(wrapText(note, 10, perGrapheme).join(" ")).toBe(note);
  });

  it("returns no lines for empty text", () => {
    expect(wrapText("", 10, perGrapheme)).toEqual([]);
  });
});

describe("pageLines", () => {
  it("splits lines into pages of three", () => {
    expect(pageLines(["a", "b", "c", "d"], 3)).toEqual([["a", "b", "c"], ["d"]]);
    expect(pageLines([], 3)).toEqual([]);
  });
});
