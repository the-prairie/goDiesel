import fs from 'fs';

const files = ['scene-3', 'scene-6']; // animated and static

files.forEach((scene) => {
  const lottiePath = `/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/${scene}/lottie.json`;
  const lottie = JSON.parse(fs.readFileSync(lottiePath, 'utf8'));

  console.log(`\n=== Checking ${scene} ===`);
  lottie.layers.forEach((layer) => {
    const traverse = (items) => {
      if (!items) return;
      for (const item of items) {
        if (item.ty === 'sh' && item.ks && item.ks.k && item.ks.k.v) {
          const vertices = item.ks.k.v;
          vertices.forEach((pt, idx) => {
            const [x, y] = pt;
            // Check if vertex is exactly [0,0] or very close to it
            // while other vertices are far away
            if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) {
              console.log(`  Layer ${layer.ind} ("${layer.nm}") has vertex at [0,0] (index ${idx})`);
            }
          });
        } else if (item.ty === 'gr' && item.it) {
          traverse(item.it);
        }
      }
    };
    traverse(layer.shapes);
  });
});
