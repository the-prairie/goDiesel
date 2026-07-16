import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(appDir, "..");
const avatarDir = join(rootDir, "route-avatars");
const playerProjectDir = join(
  rootDir,
  "lottie-player",
  "public",
  "projects",
  "godiesel-avatars",
);

const frameRate = 30;
const endFrame = 60;
const archiveTimestamp = new Date("2000-01-01T00:00:00.000Z");
const transparent = [0, 0, 0, 0];
const ink = "#071217";
const white = "#f5fbf8";
const mint = "#00f19f";

const avatars = [
  {
    id: "tempo-runner",
    name: "Tempo Runner",
    kind: "runner",
    primary: "#ff6b5f",
    secondary: "#55b8ff",
    detail: "#f4c95d",
    gear: "singlet",
  },
  {
    id: "summit-runner",
    name: "Summit Runner",
    kind: "runner",
    primary: "#55b8ff",
    secondary: "#f4c95d",
    detail: "#ff6b5f",
    gear: "pack",
  },
  {
    id: "road-rider",
    name: "Road Rider",
    kind: "cyclist",
    primary: "#f4c95d",
    secondary: "#ff6b5f",
    detail: "#55b8ff",
    gear: "road",
  },
  {
    id: "gravel-rider",
    name: "Gravel Rider",
    kind: "cyclist",
    primary: "#00f19f",
    secondary: "#9b8cff",
    detail: "#ff8a4c",
    gear: "gravel",
  },
];

function hexColor(value) {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
    1,
  ];
}

function staticValue(value) {
  return { a: 0, k: value };
}

function easeKeyframes(values) {
  return values.map(([time, value], index) => {
    const keyframe = { t: time, s: [value] };
    if (index < values.length - 1) {
      keyframe.e = [values[index + 1][1]];
      keyframe.i = { x: [0.64], y: [1] };
      keyframe.o = { x: [0.36], y: [0] };
    }
    return keyframe;
  });
}

function bounceTransform(amount = 5) {
  return {
    o: staticValue(100),
    r: staticValue(0),
    p: {
      a: 1,
      k: easeKeyframes([
        [0, [0, amount, 0]],
        [15, [0, 0, 0]],
        [30, [0, amount, 0]],
        [45, [0, 0, 0]],
        [60, [0, amount, 0]],
      ]).map((keyframe) => ({
        ...keyframe,
        s: keyframe.s[0],
        e: keyframe.e?.[0],
      })),
    },
    a: staticValue([0, 0, 0]),
    s: staticValue([100, 100, 100]),
  };
}

function shape(points, closed = false) {
  return {
    i: points.map(() => [0, 0]),
    o: points.map(() => [0, 0]),
    v: points,
    c: closed,
  };
}

function pathShape(name, poses, color, width, opacity = 100) {
  const times = [0, 15, 30, 45, 60];
  const keyframes = times.map((time, index) => {
    const current = shape(poses[index]);
    const keyframe = { t: time, s: [current] };
    if (index < times.length - 1) {
      keyframe.e = [shape(poses[index + 1])];
      keyframe.i = { x: [0.64], y: [1] };
      keyframe.o = { x: [0.36], y: [0] };
    }
    return keyframe;
  });
  return {
    ty: "gr",
    nm: name,
    it: [
      { ty: "sh", nm: `${name} path`, ks: { a: 1, k: keyframes } },
      {
        ty: "st",
        nm: `${name} stroke`,
        c: staticValue(hexColor(color)),
        o: staticValue(opacity),
        w: staticValue(width),
        lc: 2,
        lj: 2,
        ml: 4,
      },
      groupTransform(),
    ],
  };
}

function staticPath(name, points, color, width, opacity = 100, closed = false) {
  return {
    ty: "gr",
    nm: name,
    it: [
      { ty: "sh", nm: `${name} path`, ks: staticValue(shape(points, closed)) },
      {
        ty: "st",
        nm: `${name} stroke`,
        c: staticValue(hexColor(color)),
        o: staticValue(opacity),
        w: staticValue(width),
        lc: 2,
        lj: 2,
        ml: 4,
      },
      groupTransform(),
    ],
  };
}

function ellipse(name, position, size, color, opacity = 100) {
  return {
    ty: "gr",
    nm: name,
    it: [
      {
        ty: "el",
        nm: `${name} ellipse`,
        p: staticValue(position),
        s: staticValue(size),
      },
      {
        ty: "fl",
        nm: `${name} fill`,
        c: staticValue(hexColor(color)),
        o: staticValue(opacity),
        r: 1,
      },
      groupTransform(),
    ],
  };
}

function roundedRect(name, position, size, radius, color, rotation = 0) {
  return {
    ty: "gr",
    nm: name,
    it: [
      {
        ty: "rc",
        nm: `${name} rectangle`,
        p: staticValue([0, 0]),
        s: staticValue(size),
        r: staticValue(radius),
      },
      {
        ty: "fl",
        nm: `${name} fill`,
        c: staticValue(hexColor(color)),
        o: staticValue(100),
        r: 1,
      },
      {
        ...groupTransform(rotation),
        p: staticValue(position),
      },
    ],
  };
}

function groupTransform(rotation = 0) {
  return {
    ty: "tr",
    p: staticValue([0, 0]),
    a: staticValue([0, 0]),
    s: staticValue([100, 100]),
    r: staticValue(rotation),
    o: staticValue(100),
    sk: staticValue(0),
    sa: staticValue(0),
  };
}

function shapeLayer(index, name, shapes, options = {}) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks: options.static ? bounceTransform(0) : bounceTransform(options.bounce ?? 5),
    ao: 0,
    shapes,
    ip: 0,
    op: endFrame,
    st: 0,
    bm: 0,
  };
}

function transparentBackground(index) {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: "Transparent background control",
    sr: 1,
    ks: {
      o: staticValue(0),
      r: staticValue(0),
      p: staticValue([0, 0, 0]),
      a: staticValue([0, 0, 0]),
      s: staticValue([100, 100, 100]),
    },
    ao: 0,
    shapes: [
      {
        ty: "gr",
        nm: "Background",
        it: [
          {
            ty: "rc",
            p: staticValue([256, 256]),
            s: staticValue([512, 512]),
            r: staticValue(0),
          },
          { ty: "fl", c: { sid: "bgColor" }, o: staticValue(100), r: 1 },
          groupTransform(),
        ],
      },
    ],
    ip: 0,
    op: endFrame,
    st: 0,
    bm: 0,
  };
}

function baseDocument(avatar, layers) {
  return {
    v: "5.12.2",
    fr: frameRate,
    ip: 0,
    op: endFrame,
    w: 512,
    h: 512,
    nm: avatar.name,
    ddd: 0,
    assets: [],
    slots: {
      bgColor: { p: staticValue(transparent) },
    },
    meta: {
      author: "goDiesel",
      description: `Original ${avatar.kind} route avatar for goDiesel Replay.`,
      license: "Copyright Larry Zary. All rights reserved.",
      source: "Generated from repository-owned vector geometry.",
    },
    layers: [...layers, transparentBackground(layers.length + 1)],
  };
}

function runnerDocument(avatar) {
  const back = hexColor(avatar.secondary);
  const primary = avatar.primary;
  const secondary = avatar.secondary;
  const detail = avatar.detail;
  const backColor = `#${back
    .slice(0, 3)
    .map((channel) => Math.round(channel * 190).toString(16).padStart(2, "0"))
    .join("")}`;
  const rearLeg = [
    [[248, 305], [212, 365], [176, 412], [148, 420]],
    [[248, 305], [288, 352], [330, 390], [356, 394]],
    [[248, 305], [315, 326], [374, 335], [400, 338]],
    [[248, 305], [288, 352], [330, 390], [356, 394]],
    [[248, 305], [212, 365], [176, 412], [148, 420]],
  ];
  const frontLeg = [
    [[250, 305], [316, 330], [382, 358], [410, 364]],
    [[250, 305], [218, 361], [196, 423], [168, 429]],
    [[250, 305], [184, 341], [134, 388], [106, 397]],
    [[250, 305], [218, 361], [196, 423], [168, 429]],
    [[250, 305], [316, 330], [382, 358], [410, 364]],
  ];
  const rearShoes = rearLeg.map((points) => points.slice(-2));
  const frontShoes = frontLeg.map((points) => points.slice(-2));
  const rearArm = [
    [[274, 222], [228, 255], [188, 284]],
    [[274, 222], [308, 251], [340, 277]],
    [[274, 222], [322, 232], [360, 252]],
    [[274, 222], [308, 251], [340, 277]],
    [[274, 222], [228, 255], [188, 284]],
  ];
  const frontArm = [
    [[278, 222], [322, 248], [354, 286]],
    [[278, 222], [240, 250], [203, 272]],
    [[278, 222], [232, 226], [194, 241]],
    [[278, 222], [240, 250], [203, 272]],
    [[278, 222], [322, 248], [354, 286]],
  ];
  const layers = [
    shapeLayer(1, "Ground shadow", [
      ellipse("Shadow", [260, 432], [232, 34], ink, 28),
    ], { static: true }),
    shapeLayer(2, "Rear leg", [
      pathShape("Rear leg motion", rearLeg, backColor, 30, 92),
      pathShape("Rear shoe motion", rearShoes, detail, 15, 92),
    ]),
    shapeLayer(3, "Rear arm", [
      pathShape("Rear arm motion", rearArm, backColor, 24, 90),
    ]),
    shapeLayer(4, "Torso", [
      roundedRect("Performance top", [272, 246], [72, 116], 30, primary, -14),
      roundedRect("Waist band", [251, 299], [70, 22], 10, ink, -5),
      avatar.gear === "pack"
        ? roundedRect("Trail pack", [238, 238], [38, 76], 16, detail, -18)
        : roundedRect("Singlet panel", [287, 240], [16, 70], 8, white, -14),
    ]),
    shapeLayer(5, "Front leg", [
      pathShape("Front leg motion", frontLeg, secondary, 32),
      pathShape("Front shoe motion", frontShoes, detail, 16),
    ]),
    shapeLayer(6, "Front arm", [
      pathShape("Front arm motion", frontArm, primary, 26),
    ]),
    shapeLayer(7, "Head", [
      ellipse("Neck", [286, 190], [24, 34], "#d99a73"),
      ellipse("Head", [311, 163], [60, 60], "#d99a73"),
      roundedRect("Cap brim", [338, 146], [46, 10], 5, detail, -7),
      roundedRect("Cap crown", [306, 139], [56, 24], 12, primary, -7),
    ]),
    shapeLayer(8, "Route glow", [
      ellipse("Route badge", [260, 446], [34, 12], mint, 80),
    ], { static: true }),
  ];
  return baseDocument(avatar, layers);
}

function cyclistDocument(avatar) {
  const primary = avatar.primary;
  const secondary = avatar.secondary;
  const detail = avatar.detail;
  const wheel = "#dce9e4";
  const rearLeg = [
    [[280, 276], [248, 316], [253, 350]],
    [[280, 276], [304, 314], [330, 338]],
    [[280, 276], [314, 270], [344, 252]],
    [[280, 276], [304, 314], [330, 338]],
    [[280, 276], [248, 316], [253, 350]],
  ];
  const frontLeg = [
    [[280, 276], [314, 270], [344, 252]],
    [[280, 276], [258, 308], [230, 334]],
    [[280, 276], [248, 316], [253, 350]],
    [[280, 276], [258, 308], [230, 334]],
    [[280, 276], [314, 270], [344, 252]],
  ];
  const spokeRotation = {
    a: 1,
    k: easeKeyframes([
      [0, 0],
      [30, 180],
      [60, 360],
    ]),
  };
  const wheelGroup = (name, center) => ({
    ty: "gr",
    nm: name,
    it: [
      {
        ty: "gr",
        nm: `${name} rim`,
        it: [
          {
            ty: "el",
            p: staticValue(center),
            s: staticValue([150, 150]),
          },
          {
            ty: "st",
            c: staticValue(hexColor(wheel)),
            o: staticValue(95),
            w: staticValue(16),
            lc: 2,
            lj: 2,
          },
          groupTransform(),
        ],
      },
      {
        ty: "gr",
        nm: `${name} hub`,
        it: [
          {
            ty: "el",
            p: staticValue(center),
            s: staticValue([24, 24]),
          },
          {
            ty: "fl",
            c: staticValue(hexColor(detail)),
            o: staticValue(100),
            r: 1,
          },
          groupTransform(),
        ],
      },
      groupTransform(),
    ],
  });
  const spokeGroup = (name, center) => ({
    ty: "gr",
    nm: name,
    it: [
      staticPath(`${name} vertical`, [[center[0], center[1] - 62], [center[0], center[1] + 62]], wheel, 5, 72),
      staticPath(`${name} horizontal`, [[center[0] - 62, center[1]], [center[0] + 62, center[1]]], wheel, 5, 72),
      {
        ...groupTransform(),
        a: staticValue(center),
        p: staticValue(center),
        r: spokeRotation,
      },
    ],
  });
  const layers = [
    shapeLayer(1, "Ground shadow", [
      ellipse("Shadow", [265, 432], [330, 34], ink, 26),
    ], { static: true }),
    shapeLayer(2, "Wheels", [
      wheelGroup("Rear wheel", [150, 350]),
      wheelGroup("Front wheel", [380, 350]),
      spokeGroup("Rear spokes", [150, 350]),
      spokeGroup("Front spokes", [380, 350]),
    ], { bounce: 2 }),
    shapeLayer(3, "Bicycle frame", [
      staticPath("Rear triangle", [[150, 350], [252, 350], [218, 264], [150, 350]], primary, 16),
      staticPath("Front triangle", [[252, 350], [325, 278], [380, 350], [252, 350]], primary, 16),
      staticPath("Top tube", [[218, 264], [325, 278]], secondary, 18),
      staticPath("Fork", [[325, 278], [380, 350]], secondary, 15),
      staticPath("Handlebar", [[325, 278], [350, 250], [383, 250]], ink, 13),
      staticPath("Seat", [[208, 255], [234, 255]], ink, 16),
      ellipse("Crank", [252, 350], [28, 28], detail),
      avatar.gear === "gravel"
        ? roundedRect("Frame bag", [270, 300], [54, 38], 12, detail, 5)
        : roundedRect("Bottle", [286, 319], [19, 46], 8, white, 18),
    ], { bounce: 2 }),
    shapeLayer(4, "Rear leg", [
      pathShape("Rear pedal stroke", rearLeg, secondary, 27, 88),
    ], { bounce: 2 }),
    shapeLayer(5, "Rider torso", [
      roundedRect("Jersey", [292, 220], [76, 112], 30, primary, 38),
      roundedRect("Bib shorts", [270, 278], [72, 48], 20, ink, 14),
      avatar.gear === "gravel"
        ? roundedRect("Hip pack", [252, 238], [32, 64], 14, secondary, 28)
        : roundedRect("Jersey stripe", [306, 218], [16, 74], 8, detail, 38),
    ], { bounce: 2 }),
    shapeLayer(6, "Front leg", [
      pathShape("Front pedal stroke", frontLeg, primary, 29),
    ], { bounce: 2 }),
    shapeLayer(7, "Arms", [
      staticPath("Rear arm", [[320, 205], [344, 232], [362, 250]], secondary, 22, 88),
      staticPath("Front arm", [[326, 205], [354, 225], [383, 250]], primary, 24),
    ], { bounce: 2 }),
    shapeLayer(8, "Head and helmet", [
      ellipse("Neck", [313, 184], [24, 32], "#d99a73"),
      ellipse("Head", [337, 158], [58, 58], "#d99a73"),
      staticPath("Visor", [[349, 158], [374, 164]], ink, 7),
      roundedRect("Helmet shell", [333, 137], [72, 30], 15, detail, 8),
      staticPath("Helmet vents", [[316, 134], [329, 143], [343, 132], [357, 141]], ink, 5, 70),
    ], { bounce: 2 }),
    shapeLayer(9, "Route glow", [
      ellipse("Route badge", [264, 446], [42, 12], mint, 78),
    ], { static: true }),
  ];
  return baseDocument(avatar, layers);
}

function packageDotLottie(avatar, document) {
  const workspace = mkdtempSync(join(tmpdir(), `godiesel-${avatar.id}-`));
  const animationDir = join(workspace, "animations");
  mkdirSync(animationDir, { recursive: true });
  const animationPath = join(animationDir, `${avatar.id}.json`);
  const manifest = {
    version: "1.0",
    generator: "goDiesel replay avatar generator",
    author: "Larry Zary",
    animations: [
      {
        id: avatar.id,
        name: avatar.name,
        loop: true,
        speed: 1,
        themeColor: avatar.primary,
      },
    ],
  };
  writeFileSync(animationPath, `${JSON.stringify(document)}\n`);
  const manifestPath = join(workspace, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  utimesSync(animationPath, archiveTimestamp, archiveTimestamp);
  utimesSync(manifestPath, archiveTimestamp, archiveTimestamp);
  const destination = join(avatarDir, `${avatar.id}.lottie`);
  rmSync(destination, { force: true });
  execFileSync("/usr/bin/zip", [
    "-q",
    "-X",
    destination,
    "manifest.json",
    `animations/${avatar.id}.json`,
  ], { cwd: workspace });
  rmSync(workspace, { force: true, recursive: true });
}

mkdirSync(avatarDir, { recursive: true });

for (const [index, avatar] of avatars.entries()) {
  const document =
    avatar.kind === "runner" ? runnerDocument(avatar) : cyclistDocument(avatar);
  packageDotLottie(avatar, document);

  if (existsSync(join(rootDir, "lottie-player"))) {
    const sceneDir = join(playerProjectDir, `scene-${index + 1}`);
    mkdirSync(sceneDir, { recursive: true });
    writeFileSync(
      join(sceneDir, "lottie.json"),
      `${JSON.stringify(document, null, 2)}\n`,
    );
    writeFileSync(
      join(sceneDir, "controls.json"),
      `${JSON.stringify(
        { controls: [{ sid: "bgColor", label: "Background color" }] },
        null,
        2,
      )}\n`,
    );
  }
}

console.log(`Generated ${avatars.length} original Replay avatars in ${avatarDir}`);
