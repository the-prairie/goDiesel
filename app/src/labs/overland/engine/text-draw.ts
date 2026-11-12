// Drawing text in the Overland font. Emoji in her titles are rasterised from
// the system's colour emoji, downsampled to the pixel grid.

import { context2d, makeCanvas, roundRect, type Ctx } from "@/labs/overland/engine/canvas";
import {
  BOLD_GLYPHS,
  GLYPHS,
  MISSING_GLYPH,
  glyphAdvance,
  graphemesOf,
  isPictograph,
  measureText,
} from "@/labs/overland/engine/font";
import { C } from "@/labs/overland/engine/palette";

const glyphCache = new Map<string, HTMLCanvasElement>();

function glyphCanvas(grapheme: string, colour: string, bold: boolean) {
  const key = `${grapheme}\u0000${colour}${bold ? "b" : ""}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const heavy = bold ? BOLD_GLYPHS[grapheme] : undefined;
  const glyph = heavy ?? GLYPHS[grapheme] ?? MISSING_GLYPH;
  const thicken = bold && !heavy;
  const canvas = makeCanvas(glyph.width + (thicken ? 1 : 0), 9);
  const context = context2d(canvas);
  context.fillStyle = colour;
  glyph.rows.forEach((row, y) => {
    for (let x = 0; x < glyph.width; x += 1) {
      if (row[x] !== "#") continue;
      context.fillRect(x, y, 1, 1);
      if (thicken) context.fillRect(x + 1, y, 1, 1);
    }
  });
  glyphCache.set(key, canvas);
  return canvas;
}

const emojiCache = new Map<string, HTMLCanvasElement>();

/** One emoji as an N×N pixel tile, from the system emoji at a higher size. */
export function emojiTile(grapheme: string, size = 10) {
  const key = `${grapheme}${size}`;
  const cached = emojiCache.get(key);
  if (cached) return cached;
  const supersample = size > 10 ? 3 : 6;
  const big = size * supersample;
  const source = makeCanvas(big, big);
  const sourceContext = source.getContext("2d", { willReadFrequently: true })!;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.font = `${big - 6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  sourceContext.fillText(grapheme, big / 2, big / 2 + 3);
  const tile = makeCanvas(size, size);
  const context = context2d(tile);
  let data: Uint8ClampedArray | undefined;
  try {
    data = sourceContext.getImageData(0, 0, big, big).data;
  } catch {
    data = undefined;
  }
  if (data) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let alpha = 0;
        for (let j = 0; j < supersample; j += 1) {
          for (let i = 0; i < supersample; i += 1) {
            const k = ((y * supersample + j) * big + (x * supersample + i)) * 4;
            const a = data[k + 3];
            r += data[k] * a;
            g += data[k + 1] * a;
            b += data[k + 2] * a;
            alpha += a;
          }
        }
        if (alpha / (supersample * supersample * 255) < 0.42) continue;
        r /= alpha;
        g /= alpha;
        b /= alpha;
        // A little more saturation, so a 10-pixel emoji still reads.
        const light = (r + g + b) / 3;
        const boost = (value: number) => Math.min(255, Math.max(0, light + (value - light) * 1.25)) | 0;
        context.fillStyle = `rgb(${boost(r)},${boost(g)},${boost(b)})`;
        context.fillRect(x, y, 1, 1);
      }
    }
  }
  emojiCache.set(key, tile);
  return tile;
}

/** Draws a line of text with its top-left at (x, y); returns its advance. */
export function drawText(
  context: Ctx,
  text: string,
  x: number,
  y: number,
  colour: string,
  bold = false,
  withEmoji = true,
) {
  let cursor = x;
  for (const grapheme of graphemesOf(text)) {
    if (grapheme !== " ") {
      if (!GLYPHS[grapheme] && isPictograph(grapheme)) {
        if (withEmoji) context.drawImage(emojiTile(grapheme), cursor, y - 2);
      } else {
        context.drawImage(glyphCanvas(grapheme, colour, bold), cursor, y);
      }
    }
    cursor += glyphAdvance(grapheme, bold);
  }
  return cursor - x;
}

/** Shortens a line to fit, ending it with an ellipsis. */
export function clipText(text: string, maxWidth: number, bold = false) {
  if (measureText(text, bold) <= maxWidth) return text;
  let out = "";
  for (const grapheme of graphemesOf(text)) {
    if (measureText(`${out}${grapheme}…`, bold) > maxWidth) break;
    out += grapheme;
  }
  return `${out.replace(/\s+$/, "")}…`;
}

// Scale2x (EPX): doubles a bitmap and rounds its diagonals, for the large title.
function scale2x(on: (x: number, y: number) => number, width: number, height: number) {
  const W = width * 2;
  const out = new Uint8Array(W * height * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const B = on(x, y - 1);
      const D = on(x - 1, y);
      const E = on(x, y);
      const F = on(x + 1, y);
      const H = on(x, y + 1);
      let e0 = E;
      let e1 = E;
      let e2 = E;
      let e3 = E;
      if (B !== H && D !== F) {
        e0 = D === B ? D : E;
        e1 = B === F ? F : E;
        e2 = D === H ? D : E;
        e3 = H === F ? F : E;
      }
      out[y * 2 * W + x * 2] = e0;
      out[y * 2 * W + x * 2 + 1] = e1;
      out[(y * 2 + 1) * W + x * 2] = e2;
      out[(y * 2 + 1) * W + x * 2 + 1] = e3;
    }
  }
  return out;
}

const bigCache = new Map<string, HTMLCanvasElement>();

/** A line at twice the size, smoothed by Scale2x, with full-size emoji. */
export function bigLine(text: string, colour: string) {
  const key = `${text}\u0000${colour}`;
  const cached = bigCache.get(key);
  if (cached) return cached;
  const width = Math.max(1, measureText(text));
  const small = makeCanvas(width, 9);
  const smallContext = small.getContext("2d", { willReadFrequently: true })!;
  smallContext.imageSmoothingEnabled = false;
  drawText(smallContext, text, 0, 0, "#000", false, false);
  const data = smallContext.getImageData(0, 0, width, 9).data;
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < 9 && data[(y * width + x) * 4 + 3] > 128 ? 1 : 0;
  const pixels = scale2x(on, width, 9);
  const canvas = makeCanvas(width * 2, 18);
  const context = context2d(canvas);
  context.fillStyle = colour;
  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index]) context.fillRect(index % (width * 2), Math.floor(index / (width * 2)), 1, 1);
  }
  let cursor = 0;
  for (const grapheme of graphemesOf(text)) {
    if (!GLYPHS[grapheme] && isPictograph(grapheme)) context.drawImage(emojiTile(grapheme, 20), cursor * 2, -3);
    cursor += glyphAdvance(grapheme);
  }
  bigCache.set(key, canvas);
  return canvas;
}

/** The text box frame: ink edge, paper, a rule, then the fill. */
export function drawFrame(context: Ctx, x: number, y: number, width: number, height: number, fill: string = C.paper) {
  roundRect(context, x, y, width, height, C.ink);
  roundRect(context, x + 1, y + 1, width - 2, height - 2, C.paper);
  roundRect(context, x + 2, y + 2, width - 4, height - 4, C.rule);
  roundRect(context, x + 3, y + 3, width - 6, height - 6, fill);
}
