import fs from 'fs';

const p = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-6/lottie.json';
const txt = fs.readFileSync(p, 'utf8');

if (txt.includes('NaN')) {
  console.log('Lottie contains NaN!');
} else if (txt.includes('null')) {
  console.log('Lottie contains null!');
} else {
  console.log('No NaN or null found in Lottie text.');
}

// Parse to double check values
const lottie = JSON.parse(txt);
let count = 0;
const checkVal = (val, pathStr) => {
  if (val === null || val === undefined || (typeof val === 'number' && isNaN(val))) {
    console.log(`Found bad value at ${pathStr}: ${val}`);
    count++;
  } else if (Array.isArray(val)) {
    val.forEach((item, idx) => checkVal(item, `${pathStr}[${idx}]`));
  } else if (typeof val === 'object') {
    for (const key in val) {
      checkVal(val[key], `${pathStr}.${key}`);
    }
  }
};
checkVal(lottie, 'root');
console.log(`Total bad values: ${count}`);
