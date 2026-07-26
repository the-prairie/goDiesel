import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

lottie.layers.forEach((layer) => {
  let shapesCount = 0;
  let bboxes = [];

  const traverse = (items) => {
    if (!items) return;
    for (const item of items) {
      if (item.ty === 'sh' && item.ks && item.ks.k && item.ks.k.v) {
        shapesCount++;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const pt of item.ks.k.v) {
          const [x, y] = pt;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        bboxes.push({ minX, maxX, minY, maxY });
      } else if (item.ty === 'gr' && item.it) {
        traverse(item.it);
      }
    }
  };

  traverse(layer.shapes);

  if (shapesCount > 1) {
    console.log(`Layer ${layer.ind} ("${layer.nm}") has ${shapesCount} paths:`);
    bboxes.forEach((box, i) => {
      console.log(`  Path ${i+1}: BBox [${box.minX.toFixed(1)}, ${box.minY.toFixed(1)}] to [${box.maxX.toFixed(1)}, ${box.maxY.toFixed(1)}]`);
    });
  }
});
