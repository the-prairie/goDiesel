import { describe, expect, it } from "vitest";

import { shouldWarmGoogle } from "@/labs/sketch/sketch-warmup";

const base = { chosen: "17636880071", realmOpen: false, mapReady: true, saveData: false, reducedData: false, hasKey: true };

describe("shouldWarmGoogle", () => {
  it("warms Google's 3D library once a route is chosen and the drawing is up", () => {
    expect(shouldWarmGoogle(base)).toBe(true);
  });

  it("does nothing before a route is chosen, before the drawing is up, or once the jump has begun", () => {
    expect(shouldWarmGoogle({ ...base, chosen: null })).toBe(false);
    expect(shouldWarmGoogle({ ...base, mapReady: false })).toBe(false);
    expect(shouldWarmGoogle({ ...base, realmOpen: true })).toBe(false);
  });

  it("respects saving data and reduced data, and needs a key", () => {
    expect(shouldWarmGoogle({ ...base, saveData: true })).toBe(false);
    expect(shouldWarmGoogle({ ...base, reducedData: true })).toBe(false);
    expect(shouldWarmGoogle({ ...base, hasKey: false })).toBe(false);
  });
});
