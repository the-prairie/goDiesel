import fs from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { SVGToLottieConverter } = await import('svg-to-lottie');
const converter = new SVGToLottieConverter();

const svgPath = '/Users/laurenzary/Desktop/goDiesel/assets/pinata.svg';
const svgString = fs.readFileSync(svgPath, 'utf8');
const lottie = converter.convert(svgString);

lottie.layers.forEach((layer) => {
  const p = layer.ks.p.k;
  const a = layer.ks.a.k;
  if (p[0] !== 0 || p[1] !== 0 || a[0] !== 0 || a[1] !== 0) {
    console.log(`Layer ${layer.ind} has non-zero transform: p=${JSON.stringify(p)}, a=${JSON.stringify(a)}`);
  }
});
