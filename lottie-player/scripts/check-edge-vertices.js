import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-6/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

lottie.layers.forEach((layer) => {
  if (layer.ind === 1) return; // skip background

  const traverse = (items) => {
    if (!items) return;
    for (const item of items) {
      if (item.ty === 'sh' && item.ks && item.ks.k && item.ks.k.v) {
        item.ks.k.v.forEach((pt, idx) => {
          const [x, y] = pt;
          // Check if coordinate matches the background coordinate [1.0, 1.1]
          if (Math.abs(x - 1.0) < 0.1 && Math.abs(y - 1.1) < 0.1) {
            console.log(`Layer ${layer.ind} ("${layer.nm}") has vertex at [1.0, 1.1] (index ${idx})`);
          }
        });
      } else if (item.ty === 'gr' && item.it) {
        traverse(item.it);
      }
    }
  };
  traverse(layer.shapes);
});
