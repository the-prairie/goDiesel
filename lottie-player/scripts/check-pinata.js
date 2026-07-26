import fs from 'fs';

const lottiePath = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(lottiePath, 'utf8'));

lottie.layers.forEach((layer) => {
  if (layer.ks && layer.ks.r && layer.ks.r.a === 1) {
    let bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    let hasPath = false;
    let fillColor = null;

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
    console.log(`Layer ${layer.ind} ("${layer.nm}"):`);
    console.log(`  BBox: [${bbox.minX.toFixed(1)}, ${bbox.minY.toFixed(1)}] to [${bbox.maxX.toFixed(1)}, ${bbox.maxY.toFixed(1)}]`);
    console.log(`  Anchor: ${JSON.stringify(layer.ks.a.k)}`);
  }
});
