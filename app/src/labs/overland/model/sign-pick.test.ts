import { describe, expect, it } from "vitest";

import { chipTap, signAtPoint } from "@/labs/overland/model/sign-pick";

const SIGNS = [
  { slug: "a", x: 100, y: 500, width: 60, height: 44, visible: true },
  { slug: "b", x: 150, y: 505, width: 60, height: 44, visible: true },
  { slug: "c", x: 300, y: 500, width: 60, height: 44, visible: false },
];

describe("signAtPoint", () => {
  it("finds the board under a tap, the nearest where two overlap", () => {
    expect(signAtPoint(SIGNS, 95, 500)).toBe("a");
    expect(signAtPoint(SIGNS, 140, 505)).toBe("b");
  });

  it("forgives a thumb a few pixels off the board", () => {
    expect(signAtPoint(SIGNS, 100, 529)).toBe("a");
  });

  it("finds nothing on open ground, or on a board off screen", () => {
    expect(signAtPoint(SIGNS, 100, 300)).toBeNull();
    expect(signAtPoint(SIGNS, 300, 500)).toBeNull();
  });
});

describe("chipTap", () => {
  it("chooses a route on the first tap and enters it on the second", () => {
    expect(chipTap(null, "a")).toBe("choose");
    expect(chipTap("b", "a")).toBe("choose");
    expect(chipTap("a", "a")).toBe("enter");
  });
});
