import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

lottie.layers.forEach((layer) => {
  const r = layer.ks?.r;
  if (r) {
    if (r.a === 1) {
      console.log(`Layer ${layer.ind} ("${layer.nm}") has ANIMATED rotation`);
    } else if (r.k !== 0) {
      console.log(`Layer ${layer.ind} ("${layer.nm}") has STATIC rotation: ${r.k}`);
    }
  }
});
