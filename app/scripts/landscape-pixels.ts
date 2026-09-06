/** Targeted close-Runner blank-region check, not a universal imagery-quality score. */
export function landscapePixels(image: {width: number; height: number; data: ArrayLike<number>}) {
  const {width, height, data} = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 160 || data.length !== width * height * 4) {
    throw new Error("Expected a full-size RGBA landscape frame");
  }
  let flatCells = 0, cells = 0, changing = 0, edges = 0;
  // Exclude the chapter typography on the left, horizon, header and transport.
  // Cell-wise evaluation catches a gray band beside a detailed patch; one tiny
  // textured corner must not certify an otherwise missing landscape.
  const size = 24;
  for (let y = Math.floor(height * .24); y < height * .66 - size; y += size) {
    for (let x = Math.floor(width * .43); x < width * .94 - size; x += size) {
      let difference = 0, n = 0;
      for (let dy=0;dy<size-1;dy++) for (let dx=0;dx<size-1;dx++) {
        const i=((y+dy)*width+x+dx)*4;
        for (const j of [i+4, i+width*4]) {
          const d=Math.abs(data[i]-data[j])+Math.abs(data[i+1]-data[j+1])+Math.abs(data[i+2]-data[j+2]);
          difference+=d; n++; edges++; if (d>12) changing++;
        }
      }
      if (difference/n < 3) flatCells++;
      cells++;
    }
  }
  return {cells, flatCells, flatFraction: flatCells/cells, textureVariation: changing/edges};
}
