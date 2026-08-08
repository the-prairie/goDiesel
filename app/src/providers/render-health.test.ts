import { describe, expect, it } from "vitest";

import { recordTileFailure, rgbaPixelsLookBlank } from "@/providers/render-health";

describe("recordTileFailure", () => {
  it("keeps interleaved failures inside the rolling window", () => {
    expect(recordTileFailure([1_000, 4_000, 9_000], 15_000)).toEqual([
      1_000, 4_000, 9_000, 15_000,
    ]);
  });

  it("drops transient failures outside the rolling window", () => {
    expect(recordTileFailure([1_000, 10_000, 14_000], 20_000)).toEqual([
      10_000, 14_000, 20_000,
    ]);
  });
});

describe("rgbaPixelsLookBlank", () => {
  it("classifies an all-black sample as blank", () => {
    expect(rgbaPixelsLookBlank(new Uint8Array(100 * 4))).toBe(true);
  });

  it("keeps a scene with visible sampled pixels available", () => {
    const pixels = new Uint8Array(100 * 4);
    for (let index = 0; index < 10; index += 1) {
      pixels[index * 4] = 40;
      pixels[index * 4 + 1] = 80;
      pixels[index * 4 + 2] = 120;
    }
    expect(rgbaPixelsLookBlank(pixels)).toBe(false);
  });
});
