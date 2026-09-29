// Live Google 3D evidence for the adventure verifiers.
//
// docs/agents/testing.md: native Google 3D is verified on http://localhost:8787
// (the browser key authorises that referrer, not 127.0.0.1), and the stage's
// data-state=ready (gmp-steadychange isSteady) is not by itself acceptance.
// This adds two observations:
//
// - Photorealistic tile content arrived. The endpoint is the one observed
//   serving it on 2026-09-29 (keyhole-pa.googleapis.com/rt/earth/NodeData,
//   protobuf); the Maps loader and configuration calls are not counted.
// - The geography itself is imagery: luminance spread is measured only over
//   a region first confirmed, point by point, to be the map and not a card,
//   heading or control drawn over it.
import { PNG } from "pngjs";

export const LIVE_GOOGLE_BASE = "http://localhost:8787";
const TILE_CONTENT = /^https:\/\/keyhole-pa\.googleapis\.com\/rt\/earth\/NodeData\//;

export function requireLiveGoogleBase(base) {
  if (new URL(base).origin !== LIVE_GOOGLE_BASE) {
    throw new Error(`Live Google 3D proof must run on ${LIVE_GOOGLE_BASE} (docs/agents/testing.md), not ${base}.`);
  }
}

/** Count photorealistic tile-content responses seen by this page. */
export function watchGoogleTiles(page) {
  const seen = { ok: 0, failed: 0 };
  page.on("response", (response) => {
    if (!TILE_CONTENT.test(response.url())) return;
    if (response.status() >= 200 && response.status() < 300) seen.ok += 1;
    else seen.failed += 1;
  });
  return seen;
}

/**
 * Luminance spread of an unobstructed patch of the map. Returns undefined when
 * no patch in the candidates is at least 95% map, rather than measuring UI.
 */
export async function imageryVariance(page, mapSelector = "[aria-label^='Google photorealistic 3D view']") {
  const viewport = page.viewportSize();
  // Search a grid of patches, largest first, for one that is unobstructed:
  // phone and desktop layouts cover different parts of the map.
  const candidates = [];
  for (const [w, h] of [[0.4, 0.3], [0.3, 0.15], [0.25, 0.1]]) {
    for (let y = 0.1; y + h <= 0.9; y += h / 2) {
      for (let x = 0.02; x + w <= 0.98; x += w / 2) {
        candidates.push({
          x: Math.round(x * viewport.width), y: Math.round(y * viewport.height),
          width: Math.round(w * viewport.width), height: Math.round(h * viewport.height),
        });
      }
    }
  }
  for (const clip of candidates) {
    const mapShare = await page.evaluate(({ clip, mapSelector }) => {
      const map = document.querySelector(mapSelector);
      if (!map) return 0;
      let inside = 0, total = 0;
      for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) {
        const element = document.elementFromPoint(clip.x + (clip.width * i) / 10, clip.y + (clip.height * j) / 10);
        total += 1;
        if (element && map.contains(element)) inside += 1;
      }
      return inside / total;
    }, { clip, mapSelector });
    if (mapShare < 0.95) continue;
    const png = PNG.sync.read(await page.screenshot({ clip }));
    let sum = 0, sumSquares = 0, count = 0;
    for (let i = 0; i < png.data.length; i += 16) {
      const luminance = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      sum += luminance;
      sumSquares += luminance * luminance;
      count += 1;
    }
    const mean = sum / count;
    return { spread: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)), clip, mapShare };
  }
  return undefined;
}
