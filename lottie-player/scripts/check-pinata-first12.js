import fs from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const document = dom.window.document;

const svgPath = '/Users/laurenzary/Desktop/goDiesel/assets/pinata.svg';
const svgString = fs.readFileSync(svgPath, 'utf8');

const parser = new dom.window.DOMParser();
const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
const paths = svgDoc.querySelectorAll('path');

for (let idx = 0; idx < 12; idx++) {
  const path = paths[idx];
  const fill = path.getAttribute('fill');
  const d = path.getAttribute('d');
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const matches = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (matches) {
    for (let i = 0; i < matches.length; i += 2) {
      const x = parseFloat(matches[i]);
      const y = parseFloat(matches[i+1]);
      if (isNaN(x) || isNaN(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  
  console.log(`Path ${idx + 1}: fill="${fill}", BBox: [${minX.toFixed(1)}, ${minY.toFixed(1)}] to [${maxX.toFixed(1)}, ${maxY.toFixed(1)}]`);
}
