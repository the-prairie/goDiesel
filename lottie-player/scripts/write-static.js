import fs from 'fs';
import path from 'path';
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

const sceneDir = '/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/running-loop/scene-6';
if (!fs.existsSync(sceneDir)) {
  fs.mkdirSync(sceneDir, { recursive: true });
}

lottie.nm = "PINATA - Static Test";
fs.writeFileSync(path.join(sceneDir, 'lottie.json'), JSON.stringify(lottie, null, 2));

const controls = { controls: [] };
fs.writeFileSync(path.join(sceneDir, 'controls.json'), JSON.stringify(controls, null, 2));

console.log('Static pinata written to scene-6.');
