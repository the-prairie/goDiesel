// Canvas primitives for the pixel world: crisp 2D contexts, sprites drawn
// from strings, and mirror images. Nothing here smooths a pixel.

export type Ctx = CanvasRenderingContext2D;

const contexts = new WeakMap<HTMLCanvasElement, Ctx>();

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): Ctx {
  const cached = contexts.get(canvas);
  if (cached) return cached;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the pixel world.");
  context.imageSmoothingEnabled = false;
  contexts.set(canvas, context);
  return context;
}

/** A sprite from rows of characters, each mapped to a colour; `.` and space are clear. */
export function sprite(rows: readonly string[], palette: Record<string, string>) {
  const width = Math.max(...rows.map((row) => row.length));
  const canvas = makeCanvas(width, rows.length);
  const context = context2d(canvas);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const colour = palette[row[x]];
      if (!colour) continue;
      context.fillStyle = colour;
      context.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

export function flipH(source: HTMLCanvasElement) {
  const canvas = makeCanvas(source.width, source.height);
  const context = context2d(canvas);
  context.translate(source.width, 0);
  context.scale(-1, 1);
  context.drawImage(source, 0, 0);
  return canvas;
}

/** A rectangle with its corners cut by one pixel. */
export function roundRect(context: Ctx, x: number, y: number, width: number, height: number, colour: string) {
  context.fillStyle = colour;
  context.fillRect(x + 1, y, width - 2, height);
  context.fillRect(x, y + 1, width, height - 2);
}
