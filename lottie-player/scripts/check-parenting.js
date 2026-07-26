import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

let count = 0;
lottie.layers.forEach((layer) => {
  if (layer.parent !== undefined) {
    console.log(`Layer ${layer.ind} ("${layer.nm}") has parent: ${layer.parent}`);
    count++;
  }
});
console.log(`Total parented layers: ${count}`);
