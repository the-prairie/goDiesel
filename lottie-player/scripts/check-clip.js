import fs from 'fs';

const svgPath = '/Users/laurenzary/Desktop/goDiesel/assets/pinata.svg';
const svgString = fs.readFileSync(svgPath, 'utf8');

const hasClipPathTag = svgString.includes('<clipPath');
const hasClipPathAttr = svgString.includes('clip-path');

console.log(`SVG contains <clipPath>: ${hasClipPathTag}`);
console.log(`SVG contains clip-path attr: ${hasClipPathAttr}`);
