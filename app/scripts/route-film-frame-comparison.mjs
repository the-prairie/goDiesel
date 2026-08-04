import { PNG } from "pngjs";

function luminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function comparePngBuffers(browserBuffer, unrealBuffer) {
  const browser = PNG.sync.read(browserBuffer);
  const unreal = PNG.sync.read(unrealBuffer);
  if (browser.width !== unreal.width || browser.height !== unreal.height) {
    throw new Error(
      `Frame dimensions differ: browser ${browser.width}x${browser.height}, Unreal ${unreal.width}x${unreal.height}`,
    );
  }

  let absoluteError = 0;
  let browserLuminanceSquared = 0;
  let unrealLuminanceSquared = 0;
  let browserLuminanceTotal = 0;
  let unrealLuminanceTotal = 0;
  const pixels = browser.width * browser.height;
  for (let offset = 0; offset < browser.data.length; offset += 4) {
    const browserLuma = luminance(
      browser.data[offset],
      browser.data[offset + 1],
      browser.data[offset + 2],
    );
    const unrealLuma = luminance(
      unreal.data[offset],
      unreal.data[offset + 1],
      unreal.data[offset + 2],
    );
    absoluteError += Math.abs(browserLuma - unrealLuma);
    browserLuminanceTotal += browserLuma;
    unrealLuminanceTotal += unrealLuma;
    browserLuminanceSquared += browserLuma ** 2;
    unrealLuminanceSquared += unrealLuma ** 2;
  }

  const browserMean = browserLuminanceTotal / pixels;
  const unrealMean = unrealLuminanceTotal / pixels;
  const browserVariance = browserLuminanceSquared / pixels - browserMean ** 2;
  const unrealVariance = unrealLuminanceSquared / pixels - unrealMean ** 2;

  return {
    browser: {
      blank: browserVariance < 4,
      luminanceMean: browserMean,
      luminanceVariance: Math.max(0, browserVariance),
    },
    dimensions: { height: browser.height, width: browser.width },
    luminanceMae: absoluteError / pixels,
    unreal: {
      blank: unrealVariance < 4,
      luminanceMean: unrealMean,
      luminanceVariance: Math.max(0, unrealVariance),
    },
  };
}

export function rendererPromotionDecision({ comparisons, repeatedRuns }) {
  const incomplete = comparisons.some(
    (comparison) => comparison.browser.blank || comparison.unreal.blank,
  );
  if (incomplete || repeatedRuns < 3) {
    return {
      promoteUnreal: false,
      reason: incomplete
        ? "At least one comparison frame is blank or incomplete."
        : "Three repeatable Unreal runs are required.",
    };
  }
  return {
    promoteUnreal: null,
    reason:
      "Technical gates passed. A human must confirm an unmistakable visual improvement at identical frames.",
  };
}
