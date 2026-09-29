import { describe, expect, it } from "vitest";

import {
  JOURNAL_REPLAY_THREAD_STYLE,
  ROUTE_THREAD_STYLE,
} from "@/domain/geometry/route-thread-style";

describe("ROUTE_THREAD_STYLE", () => {
  it("uses the Weathered Atlas cartographic palette", () => {
    expect(ROUTE_THREAD_STYLE).toEqual({
      color: "#3379df",
      halo: "#f6f2e8",
      marker: "#d95737",
    });
    expect(Object.values(ROUTE_THREAD_STYLE)).not.toContain("#00f19f");
  });
});

describe("JOURNAL_REPLAY_THREAD_STYLE", () => {
  it("carries the journal's terracotta route identity into Replay", () => {
    expect(JOURNAL_REPLAY_THREAD_STYLE).toEqual({
      color: "#e2673c",
      halo: "#f2e4d2",
      marker: "#f7dcc7",
    });
  });

  it("does not alter the shared default for surfaces outside the journal", () => {
    expect(JOURNAL_REPLAY_THREAD_STYLE.color).not.toBe(ROUTE_THREAD_STYLE.color);
    expect(ROUTE_THREAD_STYLE.color).toBe("#3379df");
  });

  it("keeps the thread readable against dark replay terrain", () => {
    // openfreemap "fiord" terrain spans roughly #1e2630 to #333d4a. A line
    // needs 3:1 to read as a boundary; the journal terracotta clears it, and
    // the story's lighter #c34a24 does not, which is why the value is lifted.
    const luminance = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
        .map((channel) => {
          const part = channel / 255;
          return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
        })
        .reduce((total, part, index) => total + part * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const ratio = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };

    for (const terrain of ["#1e2630", "#2a3340", "#333d4a"]) {
      expect(ratio(JOURNAL_REPLAY_THREAD_STYLE.color, terrain)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(JOURNAL_REPLAY_THREAD_STYLE.halo, "#2a3340")).toBeGreaterThanOrEqual(4.5);
  });
});
