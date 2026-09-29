// Live Google 3D evidence for the adventure verifiers.
//
// docs/agents/testing.md: native Google 3D is verified on http://localhost:8787
// (the browser key authorises that referrer, not 127.0.0.1), and the stage's
// data-state=ready (gmp-steadychange isSteady) is not by itself acceptance.
// This adds two observations: Google map tile responses actually arrived, and
// the rendered frame is imagery rather than a blank or uniform canvas.
import { PNG } from "pngjs";

export const LIVE_GOOGLE_BASE = "http://localhost:8787";

export function requireLiveGoogleBase(base) {
  if (new URL(base).origin !== LIVE_GOOGLE_BASE) {
    throw new Error(`Live Google 3D proof must run on ${LIVE_GOOGLE_BASE} (docs/agents/testing.md), not ${base}.`);
  }
}

/** Count successful Google map tile/data responses seen by this page. */
export function watchGoogleTiles(page) {
  const seen = { ok: 0, failed: 0 };
  page.on("response", (response) => {
    const url = response.url();
    if (!/^https:\/\/([a-z0-9-]+\.)*(googleapis|gstatic)\.com\//.test(url)) return;
    if (!/tile|map|3dtiles|vt|kh/i.test(url)) return;
    if (response.status() >= 200 && response.status() < 300) seen.ok += 1;
    else seen.failed += 1;
  });
  return seen;
}

/** Luminance spread of the stage: imagery varies, a blank canvas does not. */
export async function imageryVariance(page, selector = "[data-testid='replay-stage']") {
  const png = PNG.sync.read(await page.locator(selector).screenshot());
  let sum = 0, sumSquares = 0, count = 0;
  for (let i = 0; i < png.data.length; i += 16) {
    const luminance = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    sum += luminance;
    sumSquares += luminance * luminance;
    count += 1;
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
}
