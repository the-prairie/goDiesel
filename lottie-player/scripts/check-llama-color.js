import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(p, 'utf8'));

// Search for the llama fur color [0.996078431372549,0.9647058823529412,0.7803921568627451,1]
const llamaColorStr = JSON.stringify([0.996078431372549,0.9647058823529412,0.7803921568627451,1]);

let found = false;
lottie.layers.forEach((layer) => {
  const json = JSON.stringify(layer);
  if (json.includes(llamaColorStr)) {
    console.log(`Layer ${layer.ind} ("${layer.nm}") contains Llama fur color!`);
    found = true;
  }
});

if (!found) {
  console.log('Llama fur color not found in Pinata Lottie.');
}
