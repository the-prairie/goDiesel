import { describe, expect, it } from "vitest";

import { FRAME_BUDGET_MS, FRAME_WINDOW, initialTier, judgeFrames, qualitySettings, treesKept } from "@/labs/overland/model/town-quality";

describe("initialTier", () => {
  it("starts a capable device high, a small one lower, and honours an explicit choice", () => {
    expect(initialTier({ deviceMemory: 16, cores: 10 })).toBe("high");
    expect(initialTier({ deviceMemory: 4, cores: 8 })).toBe("medium");
    expect(initialTier({ deviceMemory: 2, cores: 4 })).toBe("low");
    expect(initialTier({ cores: 4 })).toBe("medium");
    expect(initialTier({})).toBe("high");
    expect(initialTier({ deviceMemory: 2, override: "high" })).toBe("high");
    expect(initialTier({ deviceMemory: 16, override: "low" })).toBe("low");
    expect(initialTier({ deviceMemory: 16, override: "nonsense" })).toBe("high");
  });
});

describe("qualitySettings", () => {
  it("trades pixel ratio, shadows and trees down the tiers", () => {
    const high = qualitySettings("high", 3);
    const medium = qualitySettings("medium", 3);
    const low = qualitySettings("low", 3);
    expect(high.pixelRatio).toBe(2);
    expect(qualitySettings("high", 1).pixelRatio).toBe(1);
    expect(medium.pixelRatio).toBeLessThan(high.pixelRatio);
    expect(low.pixelRatio).toBeLessThan(1);
    expect(high.shadowMapSize).toBeGreaterThan(medium.shadowMapSize);
    expect(low.shadowMapSize).toBe(0);
    expect(high.treeShare).toBe(1);
    expect(low.treeShare).toBeLessThan(medium.treeShare);
  });
});

describe("treesKept", () => {
  it("keeps every feature tree and a share of the rest, nearest first", () => {
    expect(treesKept(1000, 20, 1)).toBe(1000);
    expect(treesKept(1000, 20, 0.5)).toBe(20 + 490);
    expect(treesKept(1000, 20, 0)).toBe(20);
  });
});

describe("judgeFrames", () => {
  const frames = (ms: number, count = FRAME_WINDOW) => Array.from({ length: count }, () => ms);

  it("waits for a full window before judging", () => {
    expect(judgeFrames(frames(80, FRAME_WINDOW - 1), "high")).toEqual({ tier: "high", judged: false });
  });

  it("steps down one tier when frames are slow, and never below low", () => {
    expect(judgeFrames(frames(45), "high")).toEqual({ tier: "medium", judged: true });
    expect(judgeFrames(frames(45), "medium")).toEqual({ tier: "low", judged: true });
    expect(judgeFrames(frames(45), "low")).toEqual({ tier: "low", judged: true });
  });

  it("keeps a steady frame rate the display caps at 30 Hz, as headless browsers and low-power phones do", () => {
    expect(judgeFrames(frames(33.3), "high")).toEqual({ tier: "high", judged: true });
  });

  it("steps down when frames stutter between the refresh and twice it", () => {
    const stutter = Array.from({ length: FRAME_WINDOW }, (_, index) => (index % 2 ? 16.7 : 33.4));
    expect(FRAME_BUDGET_MS).toBeLessThan(33.4);
    expect(judgeFrames(stutter, "high")).toEqual({ tier: "medium", judged: true });
  });

  it("keeps the tier when frames are on time, and is not moved by a few long ones", () => {
    const mostlyFast = [...frames(9, FRAME_WINDOW - 5), ...frames(200, 5)];
    expect(judgeFrames(mostlyFast, "high")).toEqual({ tier: "high", judged: true });
  });
});
