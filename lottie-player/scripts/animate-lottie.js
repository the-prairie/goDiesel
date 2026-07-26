import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

// Polyfill DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;

const { SVGToLottieConverter } = await import('svg-to-lottie');
const converter = new SVGToLottieConverter();

// Mapping definitions for the 5 SVG files
const configs = {
  llama: {
    isBiped: false,
    bg: 1,
    body: [2, 3, 4, 18, 19, 20, 21, 22],
    legs: [
      { name: 'front_left', layers: [8, 10, 15, 26], pivot: [175, 446], phase: 'A' },
      { name: 'front_right', layers: [5, 9, 14, 23], pivot: [213, 446], phase: 'B' },
      { name: 'back_left', layers: [6, 11, 12, 24], pivot: [292, 447], phase: 'B' },
      { name: 'back_right', layers: [7, 13, 25], pivot: [330, 462], phase: 'A' }
    ],
    maxAngle: 18,
    bounceY: 4
  },
  messiah: {
    isBiped: true,
    bg: 1,
    body: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 20, 21, 28],
    legs: [
      { name: 'left_leg', layers: [13, 18, 23, 25, 27], pivot: [161, 425], phase: 'A' },
      { name: 'right_leg', layers: [15, 16, 22, 24, 26], pivot: [310, 425], phase: 'B' }
    ],
    maxAngle: 12,
    bounceY: 3
  },
  pinata: {
    isBiped: false,
    bg: 1,
    body: [2, 3, 5, 6, 8, 9, 10, 13, 15, 16, 17, 18, 21, 22, 25, 30, 31, 32, 33, 34, 35, 36, 38, 40, 41, 48, 49, 50, 51, 52, 53, 54, 55, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139],
    legs: [
      { name: 'front_left', layers: [7, 19, 20, 24], pivot: [165, 332], phase: 'A' },
      { name: 'front_right', layers: [4, 12, 14, 28, 37], pivot: [265, 346], phase: 'B' },
      { name: 'back_left', layers: [26, 56, 57], pivot: [330, 332], phase: 'B' },
      { name: 'back_right', layers: [11, 23, 29, 39, 43, 45, 47], pivot: [390, 322], phase: 'A' }
    ],
    maxAngle: 20,
    bounceY: 5
  },
  tmnt: {
    isBiped: true,
    bg: 1,
    body: [2, 3, 4, 5, 8, 9, 12, 13, 15, 18, 19, 22, 23, 24, 25, 28, 29, 30, 32, 33],
    legs: [
      { name: 'left_leg', layers: [7, 10, 17, 21, 26], pivot: [195, 262], phase: 'A' },
      { name: 'right_leg', layers: [6, 11, 16, 20, 27], pivot: [300, 262], phase: 'B' }
    ],
    maxAngle: 15,
    bounceY: 4
  },
  wdog: {
    isBiped: false,
    bg: 1,
    body: [2, 3, 10, 11, 12, 13, 14, 15, 18, 21, 22, 24, 28, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41],
    legs: [
      { name: 'front_left', layers: [5, 7, 8, 9, 19, 25], pivot: [100, 208], phase: 'A' },
      { name: 'front_right', layers: [17, 23], pivot: [180, 284], phase: 'B' },
      { name: 'back_left', layers: [4, 20], pivot: [280, 269], phase: 'B' },
      { name: 'back_right', layers: [6, 16, 26, 27, 29, 30, 31], pivot: [380, 200], phase: 'A' }
    ],
    maxAngle: 18,
    bounceY: 4
  }
};

const files = ['llama', 'messiah', 'pinata', 'tmnt', 'wdog'];
const projectSlug = 'running-loop';

files.forEach((name, idx) => {
  const sceneNum = idx + 1;
  const svgPath = `/Users/laurenzary/Desktop/goDiesel/assets/${name}.svg`;
  const sceneDir = `/Users/laurenzary/Desktop/goDiesel/lottie-player/public/projects/${projectSlug}/scene-${sceneNum}`;

  // Ensure scene directory exists
  if (!fs.existsSync(sceneDir)) {
    fs.mkdirSync(sceneDir, { recursive: true });
  }

  const svgString = fs.readFileSync(svgPath, 'utf8');
  const lottie = converter.convert(svgString);

  const config = configs[name];
  if (!config) {
    console.error('No configuration found for', name);
    return;
  }

  // Define slots
  lottie.slots = {
    bgColor: {
      p: {
        a: 0,
        k: [0.12, 0.12, 0.14, 1] // sleek dark mode background
      }
    }
  };

  // Modify layers
  lottie.layers.forEach((layer) => {
    const ind = layer.ind;

    // 1. Background layer
    if (ind === config.bg) {
      // Find the fill shape inside the background layer and bind to bgColor slot
      const bindFillToSlot = (shapes) => {
        if (!shapes) return;
        shapes.forEach((s) => {
          if (s.ty === 'fl') {
            s.c = { sid: 'bgColor' };
          } else if (s.ty === 'gr' && s.it) {
            bindFillToSlot(s.it);
          }
        });
      };
      bindFillToSlot(layer.shapes);
      return;
    }

    // 2. Leg layers
    const legGroup = config.legs.find(lg => lg.layers.includes(ind));
    if (legGroup) {
      const [px, py] = legGroup.pivot;
      
      // Set anchor point and position to the pivot point
      layer.ks.a = { a: 0, k: [px, py, 0] };
      layer.ks.p = { a: 0, k: [px, py, 0] };

      // Apply rotation keyframes (running loop)
      const sign = legGroup.phase === 'A' ? 1 : -1;
      const aMax = config.maxAngle * sign;
      const aMin = -config.maxAngle * sign;

      layer.ks.r = {
        a: 1,
        k: [
          { t: 0, s: [aMax] },
          { t: 8, s: [0] },
          { t: 15, s: [aMin] },
          { t: 23, s: [0] },
          { t: 30, s: [aMax] }
        ]
      };
      return;
    }

    // 3. Body layers (bounce)
    if (config.body.includes(ind)) {
      // Bounce animation on position
      const bMax = config.bounceY;
      layer.ks.p = {
        a: 1,
        k: [
          { t: 0, s: [0, bMax, 0] },
          { t: 8, s: [0, 0, 0] },
          { t: 15, s: [0, bMax, 0] },
          { t: 23, s: [0, 0, 0] },
          { t: 30, s: [0, bMax, 0] }
        ]
      };
    }
  });

  // Set scene options
  lottie.nm = `${name.toUpperCase()} - Running Loop`;
  lottie.op = 30; // loop length
  lottie.fr = 30; // 30 fps

  // Write lottie.json
  const lottiePath = path.join(sceneDir, 'lottie.json');
  fs.writeFileSync(lottiePath, JSON.stringify(lottie, null, 2));

  // Write controls.json
  const controlsPath = path.join(sceneDir, 'controls.json');
  const controls = {
    controls: [
      { sid: 'bgColor', label: 'Background Color' }
    ]
  };
  fs.writeFileSync(controlsPath, JSON.stringify(controls, null, 2));

  console.log(`Animated and wrote scene ${sceneNum} for ${name} to ${lottiePath}`);
});
