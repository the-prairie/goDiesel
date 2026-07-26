import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

const headLayers = [6, 34, 38, 83];
headLayers.forEach((ind) => {
  const layer = lottie.layers.find(l => l.ind === ind);
  if (layer) {
    console.log(`Layer ${ind} ("${layer.nm}"):`);
    console.log(`  Rotation: ${JSON.stringify(layer.ks.r)}`);
    console.log(`  Position: ${JSON.stringify(layer.ks.p)}`);
  } else {
    console.log(`Layer ${ind} not found!`);
  }
});
