import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

// The comparison module is a Node renderer tool, intentionally outside the app bundle.
// @ts-expect-error JavaScript tool module has no generated declarations.
import { comparePngBuffers, rendererPromotionDecision } from "../../../scripts/route-film-frame-comparison.mjs";

function image(pixels: Array<[number, number, number]>) {
  const png = new PNG({ height: 1, width: pixels.length });
  pixels.forEach(([red, green, blue], index) => {
    const offset = index * 4;
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = 255;
  });
  return PNG.sync.write(png);
}

describe("route film frame comparison", () => {
  it("compares identical renderer frames without error", () => {
    const frame = image([
      [0, 0, 0],
      [255, 255, 255],
    ]);
    const comparison = comparePngBuffers(frame, frame);

    expect(comparison.luminanceMae).toBe(0);
    expect(comparison.browser.blank).toBe(false);
    expect(comparison.unreal.blank).toBe(false);
  });

  it("blocks promotion for incomplete or insufficiently repeated renders", () => {
    expect(
      rendererPromotionDecision({
        comparisons: [{ browser: { blank: false }, unreal: { blank: true } }],
        repeatedRuns: 3,
      }),
    ).toMatchObject({ promoteUnreal: false });
    expect(
      rendererPromotionDecision({
        comparisons: [{ browser: { blank: false }, unreal: { blank: false } }],
        repeatedRuns: 2,
      }),
    ).toMatchObject({ promoteUnreal: false });
  });

  it("requires human quality review after the technical gates pass", () => {
    expect(
      rendererPromotionDecision({
        comparisons: [{ browser: { blank: false }, unreal: { blank: false } }],
        repeatedRuns: 3,
      }),
    ).toEqual({
      promoteUnreal: null,
      reason:
        "Technical gates passed. A human must confirm an unmistakable visual improvement at identical frames.",
    });
  });
});
