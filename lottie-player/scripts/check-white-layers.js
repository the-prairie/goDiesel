import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-6/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

lottie.layers.forEach((layer) => {
  let hasPath = false;
  let fillColor = null;
  let bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

  const traverse = (items) => {
    if (!items) return;
    for (const item of items) {
      if (item.ty === 'sh' && item.ks && item.ks.k && item.ks.k.v) {
        hasPath = true;
        for (const pt of item.ks.k.v) {
          const [x, y] = pt;
          if (x < bbox.minX) bbox.minX = x;
          if (x > bbox.maxX) bbox.maxX = x;
          if (y < bbox.minY) bbox.minY = y;
          if (y > bbox.maxY) bbox.maxY = y;
        }
      } else if (item.ty === 'fl' && item.c && item.c.k) {
        fillColor = item.c.k;
      } else if (item.ty === 'gr' && item.it) {
        traverse(item.it);
      }
    }
  };

  traverse(layer.shapes);

  if (hasPath && fillColor) {
    const [r, g, b] = fillColor;
    // Check if color is close to white (light gray)
    if (r > 0.8 && g > 0.8 && b > 0.8) {
      console.log(`Layer ${layer.ind} ("${layer.nm}") is light color: ${JSON.stringify(fillColor)}`);
      console.log(`  BBox: [${bbox.minX.toFixed(1)}, ${bbox.minY.toFixed(1)}] to [${bbox.maxX.toFixed(1)}, ${bbox.maxY.toFixed(1)}]`);
    }
  }
});
