import fs from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const document = dom.window.document;

const svgPath = '/Users/laurenzary/Desktop/goDiesel/assets/pinata.svg';
const svgString = fs.readFileSync(svgPath, 'utf8');

const parser = new dom.window.DOMParser();
const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
const paths = svgDoc.querySelectorAll('path');

paths.forEach((path, idx) => {
  const stroke = path.getAttribute('stroke');
  const strokeWidth = path.getAttribute('stroke-width');
  if (stroke && stroke !== 'none') {
    console.log(`Path ${idx + 1} has stroke: ${stroke}, width: ${strokeWidth}`);
  }
});
