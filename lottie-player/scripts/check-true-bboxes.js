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
  let bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let hasPath = false;

  // Track transform state during traversal
  const traverse = (items, currentTransform) => {
    if (!items) return;
    
    // First, look for a transform shape in this group to update our transform context
    let localTransform = { ...currentTransform };
    const trItem = items.find(item => item.ty === 'tr');
    if (trItem) {
      const px = (trItem.p && trItem.p.k ? trItem.p.k[0] : 0);
      const py = (trItem.p && trItem.p.k ? trItem.p.k[1] : 0);
      const ax = (trItem.a && trItem.a.k ? trItem.a.k[0] : 0);
      const ay = (trItem.a && trItem.a.k ? trItem.a.k[1] : 0);
      
      // Net translation of group
      localTransform.x += (px - ax);
      localTransform.y += (py - ay);
    }

    for (const item of items) {
      if (item.ty === 'sh' && item.ks && item.ks.k && item.ks.k.v) {
        hasPath = true;
        for (const pt of item.ks.k.v) {
          const x = pt[0] + localTransform.x;
          const y = pt[1] + localTransform.y;
          if (x < bbox.minX) bbox.minX = x;
          if (x > bbox.maxX) bbox.maxX = x;
          if (y < bbox.minY) bbox.minY = y;
          if (y > bbox.maxY) bbox.maxY = y;
        }
      } else if (item.ty === 'gr' && item.it) {
        traverse(item.it, localTransform);
      }
    }
  };

  traverse(layer.shapes, { x: 0, y: 0 });

  if (hasPath) {
    // Check if this layer's true vertical position is in the head area (minY < 180)
    // but was grouped into the legs config
    console.log(`Layer ${layer.ind} ("${layer.nm}"): True BBox: [${bbox.minX.toFixed(1)}, ${bbox.minY.toFixed(1)}] to [${bbox.maxX.toFixed(1)}, ${bbox.maxY.toFixed(1)}]`);
  }
});
