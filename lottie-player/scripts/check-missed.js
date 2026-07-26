import fs from 'fs';

const lottiePath = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-3/lottie.json';
const lottie = JSON.parse(fs.readFileSync(lottiePath, 'utf8'));

// The configs used for pinata
const bg = 1;
const legs = [7, 19, 20, 24, 4, 12, 14, 28, 37, 26, 56, 57, 11, 23, 29, 39, 43, 45, 47];
const body = [2, 3, 5, 6, 8, 9, 10, 13, 15, 16, 17, 18, 21, 22, 25, 30, 31, 32, 33, 34, 35, 36, 38, 40, 41, 48, 49, 50, 51, 52, 53, 54, 55, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139];

lottie.layers.forEach((layer) => {
  const ind = layer.ind;
  if (ind !== bg && !legs.includes(ind) && !body.includes(ind)) {
    console.log(`Layer ${ind} is completely missed/static!`);
  }
});
