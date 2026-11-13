// Builds the three.js scene for a town plan: the ground, houses, trees,
// water, props, signposts and the runner. Every texture is one of the
// painters' canvases with nearest filtering, as in the approved diorama.

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  GreaterDepth,
  Group,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshPhongMaterial,
  MeshToonMaterial,
  MultiplyBlending,
  NearestFilter,
  NearestMipmapLinearFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RGBADepthPacking,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
} from "three";

import { runnerAtlas } from "@/labs/overland/engine/runner";
import { HOUSE_SPECS, type TreeSpecies } from "@/labs/overland/model/town-kits";
import { cellHash as h2, type House, type Signpost, type TownPlan, type Tree } from "@/labs/overland/model/town-plan";
import {
  GROUND_UNITS,
  Painter,
  blockTexture,
  facades,
  gableTexture,
  leafTexture,
  lobePalette,
  lobeTexture,
  mumTexture,
  paintAO,
  paintGround,
  roofTexture,
  shrubTexture,
  signTexture,
  stoneTexture,
  tierPalette,
  tierTexture,
  trunkTexture,
  vendingTexture,
  waterTexture,
  woodTexture,
} from "@/labs/overland/town3d/painters";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface TextureOptions {
  mip?: boolean;
  repeat?: [number, number] | true;
  aniso?: number;
}

export class SceneKit {
  readonly emissive: Any[] = [];
  readonly disposables = new Set<Any>();

  constructor(readonly anisotropy: number) {}

  texture(canvas: HTMLCanvasElement, options: TextureOptions = {}) {
    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    const pot = (canvas.width & (canvas.width - 1)) === 0 && (canvas.height & (canvas.height - 1)) === 0;
    if (options.mip && pot) {
      texture.minFilter = NearestMipmapLinearFilter;
      texture.generateMipmaps = true;
    } else {
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
    }
    if (options.repeat) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      if (Array.isArray(options.repeat)) texture.repeat.set(options.repeat[0], options.repeat[1]);
    }
    texture.colorSpace = SRGBColorSpace;
    if (options.aniso) texture.anisotropy = options.aniso;
    this.disposables.add(texture);
    return texture;
  }

  phong(map: Any, options: { color?: string; em?: Any; side?: Any; transparent?: boolean; alphaTest?: number; flat?: boolean } = {}) {
    const material = new MeshPhongMaterial({
      map,
      specular: 0x000000,
      shininess: 0,
      flatShading: Boolean(options.flat),
      side: options.side ?? FrontSide,
      transparent: Boolean(options.transparent),
      alphaTest: options.alphaTest ?? 0,
    });
    if (options.em) {
      material.emissive = new Color(0xffffff);
      material.emissiveMap = options.em;
      material.emissiveIntensity = 0;
      this.emissive.push(material);
    }
    if (options.color) material.color = new Color(options.color);
    this.disposables.add(material);
    return material;
  }

  track<T>(value: T): T {
    this.disposables.add(value);
    return value;
  }
}

function mesh(geometry: Any, material: Any, cast = true, receive = true) {
  const result = new Mesh(geometry, material);
  result.castShadow = cast;
  result.receiveShadow = receive;
  return result;
}

const DUMMY = new Object3D();

/** One instance: position, scale, rotation, and an optional brightness. */
type Instance = [number, number, number, number, number, number, number, number, number, number?];

function instanced(kit: SceneKit, geometry: Any, material: Any, list: Instance[], cast = true) {
  const result = new InstancedMesh(geometry, material, Math.max(1, list.length));
  const colour = new Color();
  list.forEach((item, index) => {
    DUMMY.position.set(item[0], item[1], item[2]);
    DUMMY.rotation.set(item[6] || 0, item[7] || 0, item[8] || 0);
    DUMMY.scale.set(item[3], item[4], item[5]);
    DUMMY.updateMatrix();
    result.setMatrixAt(index, DUMMY.matrix);
    if (item[9] != null) {
      colour.setScalar(item[9]);
      result.setColorAt(index, colour);
    }
  });
  result.count = list.length;
  result.instanceMatrix.needsUpdate = true;
  if (result.instanceColor) result.instanceColor.needsUpdate = true;
  result.castShadow = cast;
  result.receiveShadow = true;
  kit.track(geometry);
  return result;
}

// ---------------------------------------------------------------- houses

function buildHouse(kit: SceneKit, house: House, snow: boolean, wood: Any, dark: Any) {
  const spec = HOUSE_SPECS[house.kind];
  const group = new Group();
  const w = house.wp / 16;
  const d = house.dp / 16;
  const ht = house.hp / 16;
  const { front, side } = facades(house);
  const fm = kit.phong(kit.texture(front.m), { em: kit.texture(front.e) });
  const sm = kit.phong(kit.texture(side.m), { em: kit.texture(side.e) });
  const body = mesh(kit.track(new BoxGeometry(w, ht, d)), [sm, sm, dark, dark, fm, sm]);
  body.position.y = ht / 2;
  group.add(body);
  const edgeColour = spec.roof === "terracotta" ? "#7a3a24" : spec.roof === "kawara" ? "#33383f" : spec.roof === "thatch" ? "#6e5228" : "#30353a";
  const em = kit.phong(null, { color: edgeColour });

  if (spec.pitch === 0) {
    // A flat roof behind a parapet.
    const roofMaterial = kit.phong(kit.texture(roofTexture(Math.round(w * 16), Math.round(d * 16), spec.roof, snow)));
    const roof = mesh(kit.track(new BoxGeometry(w - 0.1, 0.06, d - 0.1)), roofMaterial);
    roof.position.y = ht + 0.03;
    group.add(roof);
    const parapetColour = spec.wall === "glass" ? "#5a6670" : spec.wall === "brownstone" ? "#5a3a2c" : "#e8e4da";
    const parapet = kit.phong(null, { color: parapetColour });
    for (const [px, pz, pw, pd] of [[0, d / 2 - 0.06, w, 0.12], [0, -d / 2 + 0.06, w, 0.12], [w / 2 - 0.06, 0, 0.12, d], [-w / 2 + 0.06, 0, 0.12, d]] as const) {
      const part = mesh(kit.track(new BoxGeometry(pw, 0.28, pd)), parapet);
      part.position.set(px, ht + 0.1, pz);
      group.add(part);
    }
    if (house.kind === "tower" || house.kind === "apartment") {
      const box = mesh(kit.track(new BoxGeometry(w * 0.3, 0.6, d * 0.3)), kit.phong(null, { color: "#8a8e92" }));
      box.position.set(w * 0.2, ht + 0.3, -d * 0.15);
      group.add(box);
    }
  } else {
    const ridgeX = spec.ridge === "x";
    const Lx = ridgeX ? w : d;
    const hd = (ridgeX ? d : w) / 2;
    const ov = spec.overhang;
    const a = spec.pitch;
    const tn = Math.tan(a);
    const D = hd + ov;
    const Hr = D * tn;
    const sl = Math.sqrt(D * D + Hr * Hr);
    const L = Lx + ov * 2;
    const th = 0.14;
    const roofTex = kit.texture(roofTexture(Math.round(L * 16), Math.round(sl * 16), spec.roof, snow));
    const rm = kit.phong(roofTex);
    rm.shadowSide = DoubleSide;
    const roof = new Group();
    for (let s = 0; s < 2; s += 1) {
      const half = new Group();
      const slab = mesh(kit.track(new BoxGeometry(L, th, sl + 0.02)), [em, em, rm, dark, em, em]);
      slab.position.set(0, Hr / 2 + th / 2, D / 2);
      slab.rotation.x = a;
      half.add(slab);
      half.rotation.y = s * Math.PI;
      roof.add(half);
    }
    if (spec.roof === "kawara" || spec.roof === "terracotta" || spec.roof === "slate") {
      const ridge = mesh(kit.track(new BoxGeometry(L + 0.06, 0.22, 0.34)), kit.phong(null, { color: snow ? "#e8ecf0" : spec.roof === "terracotta" ? "#a84a2c" : "#3a4048" }));
      ridge.position.y = Hr + th + 0.04;
      roof.add(ridge);
      if (spec.roof === "kawara") {
        for (const e of [-1, 1]) {
          const cap = mesh(kit.track(new BoxGeometry(0.12, 0.34, 0.42)), kit.phong(null, { color: "#2e333a" }));
          cap.position.set(e * (L / 2 + 0.03), Hr + th + 0.08, 0);
          roof.add(cap);
        }
      }
    }
    const gt = kit.texture(gableTexture(house));
    const R = hd * tn;
    const gg = kit.track(new BufferGeometry());
    gg.setAttribute("position", new Float32BufferAttribute([0, 0, hd, 0, 0, -hd, 0, R, 0], 3));
    gg.setAttribute("uv", new Float32BufferAttribute([1, 0, 0, 0, 0.5, 1], 2));
    gg.computeVertexNormals();
    const gm = kit.track(new MeshPhongMaterial({ map: gt, specular: 0, shininess: 0, side: DoubleSide }));
    for (const e of [-1, 1]) {
      const gable = mesh(gg, gm);
      gable.position.set((e * Lx) / 2, ov * tn, 0);
      roof.add(gable);
    }
    roof.position.y = ht - ov * tn;
    if (!ridgeX) roof.rotation.y = Math.PI / 2;
    group.add(roof);

    if (spec.extra === "meru") {
      // A shrine's stacked roofs, each smaller than the last.
      for (let k = 1; k <= 3; k += 1) {
        const f = 1 - k * 0.24;
        const tier = mesh(kit.track(new ConeGeometry(Math.max(w, d) * 0.62 * f, 0.55, 4)), kit.phong(kit.texture(roofTexture(32, 16, "thatch", false))));
        tier.rotation.y = Math.PI / 4;
        tier.position.y = ht + Hr + 0.1 + k * 0.42;
        group.add(tier);
      }
    }
  }

  // ---- extras
  const extra = spec.extra;
  if (extra === "eave") {
    const hw = w + 0.3;
    const hdp = 0.62;
    const ha = 0.38;
    const hs = hdp / Math.cos(ha);
    const hm = kit.phong(kit.texture(roofTexture(Math.round(hw * 16), Math.round(hs * 16), "kawara", snow)));
    hm.shadowSide = DoubleSide;
    const hisa = mesh(kit.track(new BoxGeometry(hw, 0.1, hs)), [em, em, hm, dark, em, em]);
    hisa.position.set(0, 29 / 16 + 0.02 + (Math.sin(ha) * hs) / 2, d / 2 + hdp / 2);
    hisa.rotation.x = ha;
    group.add(hisa);
  } else if (extra === "canopy" || extra === "porch") {
    const cm = kit.phong(kit.texture(roofTexture(26, 10, spec.roof, snow)));
    const width = extra === "porch" ? w * 0.9 : 1.6;
    const canopy = mesh(kit.track(new BoxGeometry(width, 0.08, extra === "porch" ? 1.0 : 0.62)), [em, em, cm, dark, em, em]);
    canopy.position.set(extra === "porch" ? 0 : 0.6, extra === "porch" ? Math.min(ht - 0.2, 2.0) : 2.12, d / 2 + (extra === "porch" ? 0.48 : 0.28));
    canopy.rotation.x = 0.22;
    group.add(canopy);
    if (extra === "porch") {
      for (const px of [-width / 2 + 0.1, width / 2 - 0.1]) {
        const post = mesh(kit.track(new BoxGeometry(0.1, Math.min(ht - 0.2, 2.0), 0.1)), wood);
        post.position.set(px, Math.min(ht - 0.2, 2.0) / 2, d / 2 + 0.9);
        group.add(post);
      }
      const deck = mesh(kit.track(new BoxGeometry(width, 0.12, 1.0)), wood);
      deck.position.set(0, 0.06, d / 2 + 0.5);
      group.add(deck);
    }
  } else if (extra === "ac") {
    const balcony = mesh(kit.track(new BoxGeometry(2.2, 0.08, 0.6)), kit.phong(null, { color: "#9a9790" }));
    balcony.position.set(0.9, 1.75, d / 2 + 0.3);
    group.add(balcony);
    const rail = new Painter(36, 8);
    rail.r(0, 0, 36, 1, "#5c5f63");
    for (let i = 0; i < 36; i += 3) rail.r(i, 0, 1, 8, "#6c6f73");
    rail.r(0, 7, 36, 1, "#5c5f63");
    const railMesh = mesh(kit.track(new PlaneGeometry(2.2, 0.5)), kit.track(new MeshPhongMaterial({ map: kit.texture(rail.c), transparent: true, alphaTest: 0.5, side: DoubleSide, specular: 0, shininess: 0 })));
    railMesh.position.set(0.9, 2.04, d / 2 + 0.6);
    group.add(railMesh);
    const unit = new Painter(12, 10);
    unit.r(0, 0, 12, 10, "#d9d9d2").r(1, 1, 7, 8, "#9a9a94");
    for (let k = 1; k < 9; k += 2) unit.r(1, k, 7, 1, "#6f6f6a");
    unit.r(9, 2, 2, 6, "#bdbdb6");
    const light = kit.phong(null, { color: "#cfcfc8" });
    const ac = mesh(kit.track(new BoxGeometry(0.75, 0.6, 0.32)), [light, light, kit.phong(null, { color: "#e2e2dc" }), dark, kit.phong(kit.texture(unit.c)), dark]);
    ac.position.set(-w / 2 - 0.42, 0.3, d / 2 - 0.4);
    group.add(ac);
  } else if (extra === "balcony" || extra === "balcony-iron" || extra === "balcony-wood") {
    const storeys = Math.max(1, spec.storeys);
    const floor = ht / storeys;
    const railColour = extra === "balcony-wood" ? "#3e6a3a" : extra === "balcony-iron" ? "#2a2c30" : "#c8c8c0";
    const rail = new Painter(32, 8);
    rail.r(0, 0, 32, 1, railColour);
    for (let i = 0; i < 32; i += extra === "balcony-wood" ? 2 : 3) rail.r(i, 0, 1, 8, railColour);
    const railMat = kit.track(new MeshPhongMaterial({ map: kit.texture(rail.c), transparent: true, alphaTest: 0.5, side: DoubleSide, specular: 0, shininess: 0 }));
    for (let s = 1; s < storeys; s += 1) {
      const y = ht - s * floor;
      const bw = extra === "balcony" ? w * 0.8 : w * 0.42;
      const slab = mesh(kit.track(new BoxGeometry(bw, 0.07, 0.5)), extra === "balcony-wood" ? wood : kit.phong(null, { color: "#b8b4aa" }));
      slab.position.set(extra === "balcony" ? 0 : -w * 0.18, y, d / 2 + 0.25);
      group.add(slab);
      const front = mesh(kit.track(new PlaneGeometry(bw, 0.42)), railMat);
      front.position.set(slab.position.x, y + 0.24, d / 2 + 0.5);
      group.add(front);
    }
  } else if (extra === "chimney") {
    const chimney = mesh(kit.track(new BoxGeometry(0.4, 1.2, 0.4)), kit.phong(null, { color: spec.wall === "log" ? "#7a7068" : "#8a4a34" }));
    chimney.position.set(w * 0.3, ht + 0.9, -d * 0.12);
    group.add(chimney);
  } else if (extra === "stoop") {
    for (let k = 0; k < 4; k += 1) {
      const step = mesh(kit.track(new BoxGeometry(1.0, 0.16, 0.3)), kit.phong(null, { color: "#6a4a3a" }));
      step.position.set(w * 0.62 - w / 2, 0.08 + k * 0.16, d / 2 + 0.9 - k * 0.24);
      group.add(step);
    }
  } else if (extra === "dovecote") {
    const tower = mesh(kit.track(new BoxGeometry(1.2, ht + 1.1, 1.2)), sm);
    tower.position.set(-w / 2 + 0.6, (ht + 1.1) / 2, 0);
    group.add(tower);
    const cap = mesh(kit.track(new ConeGeometry(1.0, 0.7, 4)), kit.phong(kit.texture(roofTexture(16, 16, "terracotta", snow))));
    cap.rotation.y = Math.PI / 4;
    cap.position.set(-w / 2 + 0.6, ht + 1.45, 0);
    group.add(cap);
  }

  group.position.set(house.x, 0, house.z);
  return group;
}

// ---------------------------------------------------------------- trees

type Shape = "tiered" | "lobed" | "flame" | "palm" | "banana" | "cactus" | "bare";

const SHAPE: Record<TreeSpecies, Shape> = {
  cedar: "tiered",
  spruce: "tiered",
  fir: "tiered",
  larch: "tiered",
  "larch-gold": "tiered",
  "maple-red": "lobed",
  "maple-orange": "lobed",
  "maple-green": "lobed",
  ginkgo: "flame",
  "ginkgo-green": "flame",
  cherry: "lobed",
  oak: "lobed",
  olive: "lobed",
  cypress: "flame",
  poplar: "flame",
  "poplar-gold": "flame",
  aspen: "lobed",
  "aspen-gold": "lobed",
  birch: "lobed",
  palm: "palm",
  banana: "banana",
  plane: "lobed",
  "plane-gold": "lobed",
  euphorbia: "cactus",
  broadleaf: "lobed",
  bare: "bare",
};

const WHITE_TRUNK = new Set<TreeSpecies>(["birch", "aspen", "aspen-gold"]);

export interface TreeBucket {
  mesh: Any;
  /** The rank of each instance, ascending; a tier keeps those below a rank. */
  ranks: number[];
}

function lathe(points: Array<[number, number]>, segments: number) {
  return new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);
}

/** A palm frond: a drooping blade, its base at the origin, pointing along +x. */
function frondGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = t;
    const y = 0.25 * Math.sin(t * Math.PI * 0.9) - 0.35 * t * t;
    const half = 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08));
    positions.push(x, y, -half, x, y, half);
    uvs.push(0, t, 1, t);
  }
  const index: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildTrees(kit: SceneKit, plan: TownPlan, toon: (map: Any) => Any, trunkMaterial: (kind: "bark" | "white" | "palm") => Any) {
  const SHR = 14;
  const buckets = new Map<string, { geometry: Any; material: Any; items: Array<{ rank: number; instance: Instance }>; cast: boolean }>();
  const geometries = {
    tierNear: lathe([[0, 0], [0.72, 0.1], [1, 0.2], [0.6, 0.56], [0.001, 1]], 8),
    tierFar: lathe([[0, 0], [1, 0.2], [0.6, 0.56], [0.001, 1]], 6),
    lobe: lathe([[0, 0], [0.5, 0.04], [0.86, 0.16], [1, 0.38], [0.9, 0.62], [0.58, 0.86], [0.001, 1]], 8),
    trunk: (() => {
      const g = new CylinderGeometry(0.5, 0.6, 1, 6, 1, true);
      g.translate(0, 0.5, 0);
      return g;
    })(),
    frond: frondGeometry(),
    stem: (() => {
      const g = new CylinderGeometry(0.5, 0.5, 1, 6, 1, false);
      g.translate(0, 0.5, 0);
      return g;
    })(),
  };
  const materials = new Map<string, Any>();
  const crown = (species: TreeSpecies) => {
    const key = `crown:${species}`;
    let material = materials.get(key);
    if (!material) {
      const shape = SHAPE[species];
      if (shape === "tiered") material = toon(kit.texture(tierTexture(tierPalette(species), 81 + species.length), { repeat: [3, 1], mip: true }));
      else if (shape === "palm" || shape === "banana") material = toon(kit.texture(leafTexture(species), { mip: true }));
      else material = toon(kit.texture(lobeTexture(lobePalette(species), 111 + species.length * 3), { repeat: [2, 1], mip: true }));
      materials.set(key, material);
    }
    return material;
  };
  const add = (key: string, geometry: Any, material: Any, cast: boolean, rank: number, instance: Instance) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { geometry, material, items: [], cast };
      buckets.set(key, bucket);
    }
    bucket.items.push({ rank, instance });
  };

  plan.trees.forEach((tree: Tree, ti) => {
    const s = tree.scale;
    const near = Math.abs(tree.x) < SHR && tree.z > -SHR && tree.z < SHR;
    const j = 0.9 + h2(ti, 1, 201) * 0.16;
    const ry = h2(ti, 2, 202) * 6.28;
    const shape = SHAPE[tree.species];
    const material = shape === "bare" ? null : crown(tree.species);
    const trunk = (scale: number, height: number, kind: "bark" | "white" | "palm" = WHITE_TRUNK.has(tree.species) ? "white" : "bark") =>
      add(`trunk:${kind}`, geometries.trunk, trunkMaterial(kind), true, tree.rank, [tree.x, 0, tree.z, scale, height, scale, 0, 0, 0]);
    switch (shape) {
      case "tiered": {
        const narrow = tree.species === "spruce" ? 0.78 : tree.species === "fir" ? 0.9 : 1;
        const H = s * (3.6 + h2(ti, 3, 203) * 1.4) * (tree.species === "spruce" ? 1.15 : 1);
        const n = near ? (tree.species === "spruce" ? 5 : 4) : 3;
        for (let i = 0; i < n; i += 1) {
          const f = i / n;
          const rad = s * (1.05 - f * 0.72) * narrow;
          const y = 0.42 + H * (n >= 4 ? 0.76 / n : 0.25) * i;
          const hh = H * (n >= 4 ? 1.6 / n : 0.48) - i * 0.04 * H;
          add(`${near ? "tierN" : "tierF"}:${tree.species}`, near ? geometries.tierNear : geometries.tierFar, material, near, tree.rank, [tree.x, y, tree.z, rad, hh, rad, 0, ry + i * 0.7, 0, j * (1 + i * 0.03)]);
        }
        trunk(0.3 * s, 0.7);
        break;
      }
      case "flame": {
        const tall = tree.species === "cypress" ? 1.7 : tree.species.startsWith("poplar") ? 1.45 : 1.15;
        const thin = tree.species === "cypress" ? 0.48 : tree.species.startsWith("poplar") ? 0.62 : 1;
        const hg = s * tall;
        trunk(0.3 * s, 1.2 * hg);
        [[0.85, 1.0, 0.95], [0.72, 0.95, 1.6], [0.54, 0.85, 2.2], [0.32, 0.8, 2.72]].forEach(([r, h, y], k) =>
          add(`lobe:${tree.species}`, geometries.lobe, material, near, tree.rank, [tree.x, y * hg * (tree.species === "cypress" ? 0.8 : 1), tree.z, r * s * thin, h * hg, r * s * thin, 0, ry + k * 0.9, 0, j * (1 + k * 0.04)]),
        );
        break;
      }
      case "lobed": {
        const wide = tree.species === "olive" ? 1.15 : tree.species === "oak" ? 1.2 : 1;
        const low = tree.species === "olive" ? 0.75 : 1;
        trunk(0.3 * s, 1.3 * s * low);
        [[1.18, 0.95, 0.95], [0.92, 0.9, 1.45], [0.58, 0.72, 1.98]].forEach(([r, h, y], k) =>
          add(`lobe:${tree.species}`, geometries.lobe, material, near, tree.rank, [tree.x, y * s * low, tree.z, r * s * wide, h * s, r * s * 0.94 * wide, 0, ry + k * 1.1, 0, j * (1 + k * 0.05)]),
        );
        for (let k = 0; k < 2; k += 1) {
          const an = ry + k * 2.6 + 0.8;
          const o = 0.78 * s * wide;
          add(`lobe:${tree.species}`, geometries.lobe, material, near, tree.rank, [tree.x + Math.cos(an) * o, 1.05 * s * low, tree.z + Math.sin(an) * o, 0.62 * s, 0.7 * s, 0.62 * s, 0, an, 0, j * 0.96]);
        }
        break;
      }
      case "palm": {
        const height = s * (3.4 + h2(ti, 4, 204) * 1.4);
        const lean = (h2(ti, 5, 205) - 0.5) * 0.25;
        add("trunk:palm", geometries.trunk, trunkMaterial("palm"), true, tree.rank, [tree.x, 0, tree.z, 0.2 * s, height, 0.2 * s, lean, 0, lean * 0.6]);
        const topX = tree.x + Math.sin(lean * 0.6) * height * -1 * 0;
        for (let k = 0; k < 8; k += 1) {
          const an = ry + (k / 8) * Math.PI * 2;
          add(`frond:${tree.species}`, geometries.frond, material, near, tree.rank, [topX, height - 0.05, tree.z, 1.7 * s, 1.5 * s, 1.5 * s, 0, an, -0.15 + (k % 2) * 0.2, j]);
        }
        break;
      }
      case "banana": {
        add("trunk:palm", geometries.trunk, trunkMaterial("palm"), true, tree.rank, [tree.x, 0, tree.z, 0.22 * s, 1.4 * s, 0.22 * s, 0, 0, 0]);
        for (let k = 0; k < 6; k += 1) {
          const an = ry + (k / 6) * Math.PI * 2;
          add(`frond:${tree.species}`, geometries.frond, material, near, tree.rank, [tree.x, 1.3 * s, tree.z, 1.5 * s, 2.2 * s, 3.4 * s, 0, an, 0.55, j]);
        }
        break;
      }
      case "cactus": {
        // A candelabra: a trunk and upturned branches with rounded crowns.
        trunk(0.22 * s, 1.0 * s);
        for (let k = 0; k < 5; k += 1) {
          const an = ry + (k / 5) * Math.PI * 2;
          const o = 0.35 * s;
          add(`stem:${tree.species}`, geometries.stem, material, near, tree.rank, [tree.x + Math.cos(an) * o, 0.9 * s, tree.z + Math.sin(an) * o, 0.16 * s, (0.9 + h2(ti, k, 206) * 0.6) * s, 0.16 * s, 0, 0, 0, j]);
        }
        add(`lobe:${tree.species}`, geometries.lobe, material, near, tree.rank, [tree.x, 1.5 * s, tree.z, 0.9 * s, 0.6 * s, 0.9 * s, 0, ry, 0, j]);
        break;
      }
      case "bare": {
        trunk(0.28 * s, 2.1 * s);
        for (let k = 0; k < 4; k += 1) {
          const an = ry + (k / 4) * Math.PI * 2;
          add("trunk:bark", geometries.trunk, trunkMaterial("bark"), true, tree.rank, [tree.x, 1.2 * s, tree.z, 0.09 * s, 1.3 * s, 0.09 * s, Math.cos(an) * 0.7, 0, Math.sin(an) * 0.7]);
        }
        break;
      }
    }
  });

  const result: TreeBucket[] = [];
  for (const bucket of buckets.values()) {
    bucket.items.sort((a, b) => a.rank - b.rank);
    const meshResult = instanced(kit, bucket.geometry, bucket.material, bucket.items.map((item) => item.instance), bucket.cast);
    result.push({ mesh: meshResult, ranks: bucket.items.map((item) => item.rank) });
  }
  return result;
}

// ---------------------------------------------------------------- the scene

export interface SignParts {
  sign: Signpost;
  group: Any;
  board: Any;
}

export interface TownScene {
  root: Any;
  trees: TreeBucket[];
  signs: SignParts[];
  runner: Any;
  runnerTexture: Any;
  waterTextures: Any[];
  lampSpots: Array<[number, number, number]>;
  lampMaterial: Any;
  farPlane: Any;
  trailMesh: Any;
  trailCanvas: HTMLCanvasElement;
  trailTexture: Any;
  kit: SceneKit;
}

export const TRAIL_TEXELS = 16;
export const TRAIL_SIZE = 32;

export function buildTownScene(plan: TownPlan, anisotropy: number): TownScene {
  const kit = new SceneKit(anisotropy);
  const root = new Group();
  const gradient = kit.track(new DataTexture(new Uint8Array([92, 92, 92, 255, 168, 168, 168, 255, 255, 255, 255, 255]), 3, 1, RGBAFormat));
  gradient.minFilter = gradient.magFilter = NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  const toon = (map: Any) => kit.track(new MeshToonMaterial({ map, gradientMap: gradient, side: DoubleSide }));

  // ---- ground
  const groundTexture = kit.texture(paintGround(plan), { mip: true, aniso: Math.min(4, anisotropy) });
  const ground = mesh(kit.track(new PlaneGeometry(GROUND_UNITS, GROUND_UNITS)), kit.phong(groundTexture), false, true);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);
  const farPlane = mesh(kit.track(new PlaneGeometry(400, 400)), kit.phong(null, { color: plan.ground.far }), false, false);
  farPlane.rotation.x = -Math.PI / 2;
  farPlane.position.y = -0.02;
  root.add(farPlane);
  const aoTexture = kit.track(new CanvasTexture(paintAO(plan)));
  aoTexture.minFilter = LinearFilter;
  aoTexture.generateMipmaps = false;
  const ao = new Mesh(kit.track(new PlaneGeometry(GROUND_UNITS, GROUND_UNITS)), kit.track(new MeshBasicMaterial({ map: aoTexture, blending: MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, fog: false })));
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = 0.012;
  ao.renderOrder = 1;
  root.add(ao);

  // ---- materials shared by props
  const wood = kit.phong(kit.texture(woodTexture(), { repeat: [1, 1] }));
  const dark = kit.phong(null, { color: "#2b211b" });
  const stoneTex = kit.texture(stoneTexture(), { repeat: true });
  const stone = kit.phong(stoneTex);
  const trunkMaterials = new Map<string, Any>();
  const trunkMaterial = (kind: "bark" | "white" | "palm") => {
    let material = trunkMaterials.get(kind);
    if (!material) {
      material = kind === "bark" ? kit.phong(null, { color: "#4a3428" }) : kit.phong(kit.texture(trunkTexture(kind), { repeat: [1, 3] }));
      trunkMaterials.set(kind, material);
    }
    return material;
  };

  // ---- houses
  for (const house of plan.houses) root.add(buildHouse(kit, house, plan.snow, wood, dark));

  // ---- trees
  const trees = buildTrees(kit, plan, toon, trunkMaterial);
  for (const bucket of trees) root.add(bucket.mesh);

  // ---- city blocks
  if (plan.blocks.length) {
    const facade = blockTexture();
    const material = kit.phong(kit.texture(facade.m, { repeat: [1, 1] }), { em: kit.texture(facade.e, { repeat: [1, 1] }) });
    const roofMaterial = kit.phong(null, { color: "#6a6a68" });
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    root.add(instanced(kit, geometry, [material, material, roofMaterial, roofMaterial, material, material], plan.blocks.map((block) => [block.x, 0, block.z, block.w, block.h, block.d, 0, 0, 0, 0.78 + block.tone * 0.3] as Instance), true));
  }

  // ---- water
  const waterTextures: Any[] = [];
  const waterMaterial = (tint: "pond" | "sea" | "lake", repeat: [number, number]) => {
    const texture = kit.texture(waterTexture(tint), { repeat, mip: true });
    waterTextures.push(texture);
    return kit.phong(texture);
  };
  const natural = plan.biome === "alpine" || plan.biome === "swamp" || plan.biome === "prairie" || plan.biome === "jungle" || plan.biome === "pnw";
  if (plan.pond) {
    const p = plan.pond;
    const water = mesh(kit.track(new PlaneGeometry(p.w, p.d)), waterMaterial(plan.biome === "alpine" ? "lake" : "pond", [p.w / 2, p.d / 2]), false, true);
    water.rotation.x = -Math.PI / 2;
    water.position.set(p.x, natural ? 0.04 : 0.1, p.z);
    root.add(water);
    if (natural) {
      const rocks: Instance[] = [];
      for (let k = 0; k < 26; k += 1) {
        const t = k / 26;
        const perimeter = 2 * (p.w + p.d);
        let d = t * perimeter;
        let x: number;
        let z: number;
        if (d < p.w) { x = p.x - p.w / 2 + d; z = p.z - p.d / 2; }
        else if ((d -= p.w) < p.d) { x = p.x + p.w / 2; z = p.z - p.d / 2 + d; }
        else if ((d -= p.d) < p.w) { x = p.x + p.w / 2 - d; z = p.z + p.d / 2; }
        else { d -= p.w; x = p.x - p.w / 2; z = p.z + p.d / 2 - d; }
        const r = 0.18 + h2(k, 1, 401) * 0.16;
        rocks.push([x, r * 0.4, z, r * 1.3, r, r, 0, h2(k, 2, 402) * 6, 0, 0.85 + h2(k, 3, 403) * 0.25]);
      }
      root.add(instanced(kit, new DodecahedronGeometry(1, 0), kit.phong(null, { color: plan.snow ? "#d8dde2" : "#8a857c", flat: true }), rocks));
    } else {
      const t = 0.32;
      const hgt = 0.34;
      for (const [x, z, w, d] of [[p.x, p.z - p.d / 2 - t / 2, p.w + 2 * t, t], [p.x, p.z + p.d / 2 + t / 2, p.w + 2 * t, t], [p.x - p.w / 2 - t / 2, p.z, t, p.d], [p.x + p.w / 2 + t / 2, p.z, t, p.d]]) {
        const wall = mesh(kit.track(new BoxGeometry(w, hgt, d)), stone);
        wall.position.set(x, hgt / 2, z);
        root.add(wall);
      }
    }
  }
  const water = plan.water;
  if (water.kind === "canal" || water.kind === "creek") {
    const len = 90;
    const band = water.z1 - water.z0;
    const plane = mesh(kit.track(new PlaneGeometry(len, band)), waterMaterial(plan.biome === "alpine" ? "lake" : "pond", [len / 2, band / 2]), false, true);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, water.kind === "canal" ? 0.05 : 0.03, (water.z0 + water.z1) / 2);
    root.add(plane);
    if (water.kind === "canal") {
      const st = kit.track(stoneTex.clone());
      st.needsUpdate = true;
      st.repeat.set(len / 2, 1);
      const sm = kit.phong(st);
      for (const z of [water.z0 - 0.15, water.z1 + 0.15]) {
        const wall = mesh(kit.track(new BoxGeometry(len, 0.3, 0.3)), sm);
        wall.position.set(0, 0.15, z);
        root.add(wall);
      }
    }
    const bx = water.bridgeX;
    const bw = 1.5;
    const bl = band + 1.2;
    const plank = new Painter(16, 32);
    for (let j = 0; j < 32; j += 1) plank.r(0, j, 16, 1, j % 4 === 3 ? "#5a3f2c" : j % 4 === 0 ? "#a27a58" : "#8b6646");
    const pm = kit.phong(kit.texture(plank.c, { repeat: [1, bl / 2] }));
    const deck = mesh(kit.track(new BoxGeometry(bw, 0.14, bl)), [wood, wood, pm, dark, wood, wood]);
    deck.position.set(bx, water.kind === "canal" ? 0.38 : 0.22, (water.z0 + water.z1) / 2);
    root.add(deck);
    for (const s of [-1, 1]) {
      const rail = mesh(kit.track(new BoxGeometry(0.08, 0.08, bl - 0.3)), wood);
      rail.position.set(bx + s * (bw / 2 - 0.06), deck.position.y + 0.48, (water.z0 + water.z1) / 2);
      root.add(rail);
      for (let k = 0; k < 4; k += 1) {
        const post = mesh(kit.track(new BoxGeometry(0.1, 0.46, 0.1)), wood);
        post.position.set(bx + s * (bw / 2 - 0.06), deck.position.y + 0.28, water.z0 - 0.4 + (k * (bl - 0.6)) / 3 + 0.1);
        root.add(post);
      }
    }
  } else if (water.kind === "shore") {
    const sea = mesh(kit.track(new PlaneGeometry(400, 200)), waterMaterial("sea", [200, 100]), false, true);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.04, water.z0 + 100);
    root.add(sea);
    // A jetty from the promenade out over the water.
    const plank = new Painter(16, 32);
    for (let j = 0; j < 32; j += 1) plank.r(0, j, 16, 1, j % 4 === 3 ? "#5a3f2c" : j % 4 === 0 ? "#a27a58" : "#8b6646");
    const length = 7;
    const pm = kit.phong(kit.texture(plank.c, { repeat: [1, length / 2] }));
    const deck = mesh(kit.track(new BoxGeometry(1.4, 0.12, length)), [wood, wood, pm, dark, wood, wood]);
    deck.position.set(water.jettyX, 0.42, water.sand + length / 2);
    root.add(deck);
    const piles: Instance[] = [];
    for (let k = 0; k < 6; k += 1) for (const s of [-1, 1]) piles.push([water.jettyX + s * 0.6, 0.2, water.sand + 0.6 + k * 1.2, 0.12, 0.5, 0.12, 0, 0, 0]);
    root.add(instanced(kit, new BoxGeometry(1, 1, 1), wood, piles));
    const boat = mesh(kit.track(new BoxGeometry(0.9, 0.3, 2.2)), kit.phong(null, { color: "#e8e4da" }));
    boat.position.set(water.jettyX + 1.6, 0.12, water.z0 + 2.2);
    boat.rotation.y = 0.3;
    root.add(boat);
  }

  // ---- backdrop
  if (plan.backdrop) {
    const material = toon(null);
    material.color = new Color(plan.backdrop === "volcano" ? "#4a3e3a" : plan.backdrop === "peaks" ? "#6a7280" : "#5a7a4a");
    material.fog = false;
    const capMaterial = toon(null);
    capMaterial.color = new Color("#f2f4f6");
    capMaterial.fog = false;
    const peaks: Array<[number, number, number, number]> =
      plan.backdrop === "volcano"
        ? [[6, -78, 34, 30]]
        : plan.backdrop === "peaks"
          ? [[-34, -70, 26, 24], [-8, -82, 34, 32], [22, -74, 28, 26], [46, -66, 22, 20], [-58, -62, 20, 18]]
          : [[-40, -64, 30, 9], [-6, -74, 40, 11], [32, -66, 34, 10]];
    peaks.forEach(([x, z, r, h], k) => {
      const segments = plan.backdrop === "hills" ? 12 : 7;
      const cone = mesh(kit.track(new ConeGeometry(r, h, segments, 1, plan.backdrop === "volcano")), material, false, false);
      cone.position.set(x, h / 2 - 1, z);
      cone.rotation.y = k * 0.7;
      if (plan.backdrop === "hills") cone.scale.set(1, 1, 0.6);
      root.add(cone);
      if (plan.backdrop === "peaks" || (plan.backdrop === "volcano" && plan.snow)) {
        const capH = h * 0.32;
        const cap = mesh(kit.track(new ConeGeometry(r * 0.33, capH, segments)), capMaterial, false, false);
        cap.position.set(x, h - 1 - capH / 2 + 0.02, z);
        cap.rotation.y = k * 0.7;
        root.add(cap);
      }
    });
  }

  // ---- props
  const pick: Instance[] = [];
  const rails: Instance[] = [];
  for (const prop of plan.props) {
    if (prop.kind !== "fence") continue;
    const dx = prop.x2 - prop.x1;
    const dz = prop.z2 - prop.z1;
    const length = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(length / 0.22));
    const angle = Math.atan2(dx, dz);
    for (let i = 0; i <= n; i += 1) {
      const f = i / n;
      const hh = i % 5 === 0 ? 0.66 : 0.54;
      pick.push([prop.x1 + dx * f, hh / 2, prop.z1 + dz * f, 0.07, hh, 0.07, 0, 0, 0, (i % 5 === 0 ? 0.8 : 1) * (0.92 + h2(i, n, 301) * 0.12)]);
    }
    for (const y of [0.18, 0.42]) rails.push([prop.x1 + dx / 2, y, prop.z1 + dz / 2, 0.05, 0.05, length, 0, angle, 0, 0.9]);
  }
  const fenceColour = plan.biome === "japan" ? "#b49a62" : plan.biome === "city" ? "#4a4c50" : plan.biome === "med" || plan.biome === "volc" ? "#e8e4da" : "#8a6a44";
  if (pick.length) {
    root.add(instanced(kit, new BoxGeometry(1, 1, 1), kit.phong(null, { color: fenceColour }), pick));
    root.add(instanced(kit, new BoxGeometry(1, 1, 1), kit.phong(null, { color: plan.biome === "japan" ? "#8c7346" : fenceColour }), rails));
  }
  const dodecahedron = new DodecahedronGeometry(1, 0);
  for (const prop of plan.props) {
    if (prop.kind === "bed") {
      const colours: Record<string, [string, string]> = {
        mums: ["#f2c94a", "#f4f1e6"],
        tulips: ["#e8503a", "#f2c14e"],
        veg: ["#6a9a3a", "#c8402a"],
        lavender: ["#8a6ac8", "#b49ae0"],
        succulents: ["#8ab08a", "#d8a0b4"],
      };
      const [a, b] = colours[prop.bed] ?? colours.mums;
      const first: Instance[] = [];
      const second: Instance[] = [];
      for (let i = 0; i < 6; i += 1) for (let j = 0; j < 4; j += 1) {
        const x = prop.x - prop.w / 2 + 0.3 + i * 0.44 + (j % 2) * 0.1;
        const z = prop.z - prop.d / 2 + 0.2 + j * 0.42;
        const s = 0.2 + h2(i, j, 311) * 0.06;
        ((i + j) % 3 === 0 ? second : first).push([x, s * 0.75, z, s, s * 0.85, s, 0, h2(i, j, 312) * 6, 0, 0.95 + h2(i, j, 313) * 0.1]);
      }
      root.add(instanced(kit, dodecahedron, kit.phong(kit.texture(mumTexture(a, b), { repeat: [2, 1] }), { flat: true }), first));
      root.add(instanced(kit, dodecahedron.clone(), kit.phong(kit.texture(mumTexture(b, a), { repeat: [2, 1] }), { flat: true }), second));
    }
  }
  const shrubs = plan.props.filter((prop) => prop.kind === "shrub");
  if (shrubs.length) {
    root.add(
      instanced(
        kit,
        dodecahedron.clone(),
        kit.phong(kit.texture(shrubTexture(plan.snow ? ["#e8ecf0", "#d0d8de", "#f4f6f8", "#9aa4ac"] : plan.shrub), { repeat: [2, 1] }), { flat: true }),
        shrubs.map((prop, i) => (prop.kind === "shrub" ? ([prop.x, prop.s * 0.7, prop.z, prop.s * 1.15, prop.s * 0.8, prop.s, 0, i, 0, 0.9 + h2(i, 3, 322) * 0.15] as Instance) : ([0, 0, 0, 0, 0, 0, 0, 0, 0] as Instance))),
      ),
    );
  }
  let lampMaterial: Any = null;
  const lampSpots: Array<[number, number, number]> = plan.houses.slice(0, 3).map((house) => [house.x + house.width * 0.15, 1.5, house.z + house.depth / 2 + 0.9]);
  for (const prop of plan.props) {
    if (prop.kind === "bench") {
      const bench = new Group();
      const seat = mesh(kit.track(new BoxGeometry(1.3, 0.08, 0.38)), wood);
      seat.position.y = 0.42;
      bench.add(seat);
      for (const x of [-0.55, 0.55]) {
        const leg = mesh(kit.track(new BoxGeometry(0.08, 0.42, 0.34)), dark);
        leg.position.set(x, 0.21, 0);
        bench.add(leg);
      }
      bench.position.set(prop.x, 0, prop.z);
      root.add(bench);
    } else if (prop.kind === "pole") {
      const japanese = plan.biome === "japan" || plan.houses.some((house) => house.kind === "apartment");
      const pole = mesh(kit.track(new CylinderGeometry(0.08, 0.1, 3.6, 6)), kit.phong(null, { color: japanese ? "#8d8a84" : "#2c3036" }));
      pole.position.set(prop.x, 1.8, prop.z);
      root.add(pole);
      const arm = mesh(kit.track(new BoxGeometry(0.6, 0.06, 0.08)), kit.phong(null, { color: "#6f6c67" }));
      arm.position.set(prop.x - 0.25, 3.35, prop.z);
      root.add(arm);
      lampMaterial = kit.track(new MeshBasicMaterial({ color: 0x8a8478 }));
      const lamp = mesh(kit.track(new BoxGeometry(0.28, 0.12, 0.2)), lampMaterial, false, false);
      lamp.position.set(prop.x - 0.5, 3.28, prop.z);
      root.add(lamp);
      lampSpots.push([prop.x - 0.5, 2.9, prop.z]);
    } else if (prop.kind === "corner") {
      root.add(cornerProp(kit, prop.corner, prop.x, prop.z, wood, dark, plan.snow));
    }
  }

  // ---- signposts
  const signs: SignParts[] = [];
  const posts = new Map<number, Signpost[]>();
  for (const sign of plan.signposts) posts.set(sign.post, [...(posts.get(sign.post) ?? []), sign]);
  for (const boards of posts.values()) {
    const sorted = boards.sort((a, b) => a.tier - b.tier);
    const first = sorted[0];
    const group = new Group();
    const top = 1.12 + (sorted.length - 1) * 0.82;
    const post = mesh(kit.track(new BoxGeometry(0.14, top - 0.32, 0.14)), wood);
    post.position.y = (top - 0.32) / 2;
    group.add(post);
    const width = plan.signposts.length > 2 ? 1.8 : 2.0;
    for (const sign of sorted) {
      const y = top - sign.tier * 0.82;
      const back = mesh(kit.track(new BoxGeometry(0.1, 0.62, 0.06)), wood);
      back.position.set(0, y, -0.07);
      group.add(back);
      const material = kit.phong(kit.texture(signTexture(sign.label, sign.side)));
      const board = mesh(kit.track(new BoxGeometry(width, 0.75, 0.09)), [wood, wood, wood, wood, material, material]);
      board.position.y = y;
      group.add(board);
      const cap = mesh(kit.track(new BoxGeometry(width + 0.12, 0.07, 0.16)), dark);
      cap.position.y = y + 0.41;
      group.add(cap);
      signs.push({ sign, group, board });
    }
    group.position.set(first.x, 0, first.z);
    group.rotation.y = -first.side * 0.08;
    root.add(group);
  }

  // ---- the runner
  const runnerTexture = kit.texture(runnerAtlas());
  runnerTexture.repeat.set(0.25, 0.25);
  const runnerMaterial = kit.track(new MeshPhongMaterial({ map: runnerTexture, alphaTest: 0.5, side: DoubleSide, specular: 0, shininess: 0 }));
  const runnerGeometry = kit.track(new PlaneGeometry(1, 1.5));
  runnerGeometry.translate(0, 0.75, 0);
  const runner = new Mesh(runnerGeometry, runnerMaterial);
  runner.castShadow = true;
  runner.customDepthMaterial = kit.track(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: runnerTexture, alphaTest: 0.5 }));
  runner.scale.set(1.15, 1.15, 1.15);
  const xray = kit.track(new MeshBasicMaterial({ map: runnerTexture, color: 0xe8503a, alphaTest: 0.5, transparent: true, depthWrite: false, depthFunc: GreaterDepth, side: DoubleSide, fog: false }));
  xray.onBeforeCompile = (shader: Any) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      "#include <map_fragment>\n if(diffuseColor.a<0.5) discard;\n diffuseColor.rgb = diffuse;\n if(mod(floor(gl_FragCoord.x)+floor(gl_FragCoord.y),2.0)<0.5) discard;",
    );
  };
  const silhouette = new Mesh(runnerGeometry, xray);
  silhouette.renderOrder = 10;
  runner.add(silhouette);
  root.add(runner);

  // ---- her trail, drawn on the ground during the hold
  const trailCanvas = document.createElement("canvas");
  trailCanvas.width = TRAIL_SIZE * TRAIL_TEXELS;
  trailCanvas.height = TRAIL_SIZE * TRAIL_TEXELS;
  const trailTexture = kit.texture(trailCanvas);
  const trailMesh = new Mesh(kit.track(new PlaneGeometry(TRAIL_SIZE, TRAIL_SIZE)), kit.track(new MeshBasicMaterial({ map: trailTexture, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  trailMesh.rotation.x = -Math.PI / 2;
  trailMesh.position.y = 0.05;
  trailMesh.renderOrder = 2;
  trailMesh.visible = false;
  root.add(trailMesh);

  return { root, trees, signs, runner, runnerTexture, waterTextures, lampSpots, lampMaterial, farPlane, trailMesh, trailCanvas, trailTexture, kit };
}

function cornerProp(kit: SceneKit, kind: string, x: number, z: number, wood: Any, dark: Any, snow: boolean) {
  const group = new Group();
  group.position.set(x, 0, z);
  const box = (w: number, h: number, d: number, material: Any, px = 0, py = h / 2, pz = 0) => {
    const part = mesh(kit.track(new BoxGeometry(w, h, d)), material);
    part.position.set(px, py, pz);
    group.add(part);
    return part;
  };
  switch (kind) {
    case "vending": {
      const art = vendingTexture();
      const face = kit.phong(kit.texture(art.m), { em: kit.texture(art.e) });
      const shell = kit.phong(null, { color: "#dfe3e7" });
      const machine = mesh(kit.track(new BoxGeometry(0.85, 1.7, 0.62)), [shell, shell, kit.phong(null, { color: "#c9ced3" }), dark, face, shell]);
      machine.position.y = 0.85;
      group.add(machine);
      break;
    }
    case "lamp": {
      const metal = kit.phong(null, { color: "#2c3036" });
      box(0.1, 2.6, 0.1, metal);
      box(0.32, 0.36, 0.32, kit.phong(null, { color: "#f2e2a8" }), 0, 2.7);
      box(0.4, 0.06, 0.4, metal, 0, 2.9);
      break;
    }
    case "well": {
      const stone = kit.phong(null, { color: "#9a948a" });
      const ring = mesh(kit.track(new CylinderGeometry(0.55, 0.6, 0.6, 10, 1, true)), stone);
      ring.position.y = 0.3;
      group.add(ring);
      box(0.08, 1.4, 0.08, wood, -0.5, 0.7);
      box(0.08, 1.4, 0.08, wood, 0.5, 0.7);
      const roof = mesh(kit.track(new ConeGeometry(0.8, 0.5, 4)), kit.phong(kit.texture(roofTexture(16, 16, "terracotta", snow))));
      roof.position.y = 1.6;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      break;
    }
    case "hay": {
      const hay = kit.phong(null, { color: snow ? "#e8e4da" : "#d8b65a" });
      for (const [px, pz] of [[-0.4, 0], [0.45, 0.1], [0, -0.6]]) {
        const bale = mesh(kit.track(new CylinderGeometry(0.42, 0.42, 0.7, 10)), hay);
        bale.rotation.z = Math.PI / 2;
        bale.position.set(px, 0.42, pz);
        group.add(bale);
      }
      break;
    }
    case "amphora": {
      const clay = kit.phong(null, { color: "#c0603a" });
      for (const [px, pz, s] of [[-0.3, 0, 1], [0.35, 0.15, 0.8], [0.05, -0.4, 0.9]]) {
        const pot = mesh(kit.track(new LatheGeometry([[0.01, 0], [0.22, 0.1], [0.3, 0.4], [0.18, 0.75], [0.12, 0.85], [0.16, 0.95]].map(([a, b]) => new Vector2(a * s, b * s * 1.2)), 8)), clay);
        pot.position.set(px, 0, pz);
        group.add(pot);
      }
      break;
    }
    case "boat": {
      const hull = kit.phong(null, { color: "#3a6a8a" });
      box(0.8, 0.32, 2.2, hull, 0, 0.16);
      box(0.6, 0.06, 1.8, wood, 0, 0.33);
      group.rotation.y = 0.5;
      break;
    }
    case "woodpile": {
      const logs: Instance[] = [];
      for (let r = 0; r < 3; r += 1) for (let k = 0; k < 4 - r; k += 1) logs.push([-0.6 + k * 0.36 + r * 0.18, 0.16 + r * 0.3, 0, 0.16, 1.1, 0.16, Math.PI / 2, 0, 0]);
      const pile = instanced(kit, new CylinderGeometry(1, 1, 1, 7), kit.phong(null, { color: "#8a6440" }), logs);
      group.add(pile);
      break;
    }
    case "lantern": {
      box(0.3, 0.8, 0.3, kit.phong(null, { color: "#8a857c" }));
      box(0.5, 0.4, 0.5, kit.phong(null, { color: "#9a958c" }), 0, 1.0);
      break;
    }
    case "bins": {
      box(0.5, 0.8, 0.5, kit.phong(null, { color: "#3a6a4a" }), -0.3);
      box(0.5, 0.8, 0.5, kit.phong(null, { color: "#4a4c50" }), 0.3);
      break;
    }
    case "shrine-gate": {
      const stoneGrey = kit.phong(null, { color: "#7a766c" });
      box(0.5, 2.2, 0.5, stoneGrey, -0.7, 1.1);
      box(0.5, 2.2, 0.5, stoneGrey, 0.7, 1.1);
      const cap = mesh(kit.track(new ConeGeometry(0.42, 0.8, 4)), kit.phong(null, { color: "#5a564e" }));
      cap.position.set(-0.7, 2.6, 0);
      group.add(cap);
      const cap2 = cap.clone();
      cap2.position.x = 0.7;
      group.add(cap2);
      break;
    }
    default:
      break;
  }
  return group;
}
