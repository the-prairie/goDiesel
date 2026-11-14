// What each biome builds a town from: its houses, trees, ground, water and
// props. Plain data; the generator picks from it and the renderer paints it.
// A new look is a new row here and, for a new house or tree, a painter.

import type { Biome } from "@/labs/overland/model/place-biomes";

export type Season = "spring" | "summer" | "autumn" | "winter" | "tropical";

/** A tree as drawn: a species, already in its season's colours. */
export type TreeSpecies =
  | "cedar"
  | "spruce"
  | "fir"
  | "larch"
  | "larch-gold"
  | "maple-red"
  | "maple-orange"
  | "maple-green"
  | "ginkgo"
  | "ginkgo-green"
  | "cherry"
  | "oak"
  | "olive"
  | "cypress"
  | "poplar"
  | "poplar-gold"
  | "aspen"
  | "aspen-gold"
  | "birch"
  | "palm"
  | "banana"
  | "plane"
  | "plane-gold"
  | "euphorbia"
  | "broadleaf"
  | "bare";

export type RoofStyle = "kawara" | "terracotta" | "slate" | "shingle" | "shingle-dark" | "metal" | "metal-red" | "metal-green" | "thatch" | "flat" | "flat-white";
export type WallStyle =
  | "tile-beige"
  | "siding-cream"
  | "stucco-ochre"
  | "stucco-red"
  | "stucco-cream"
  | "stucco-white"
  | "whitewash"
  | "brick"
  | "brownstone"
  | "glass"
  | "chalet"
  | "log"
  | "shingle-cedar"
  | "clapboard-blue"
  | "clapboard-red"
  | "clapboard-white"
  | "barn-red"
  | "elevator"
  | "craftsman"
  | "bali"
  | "stone-ochre"
  | "brick-plaster";
export type WindowStyle = "grid" | "shopfront" | "shutter-green" | "shutter-blue" | "shutter-red" | "arched" | "sash" | "curtain" | "small-wood" | "white-frame" | "black-frame" | "carved" | "none";
export type DoorStyle = "glass" | "noren" | "arched" | "portico" | "panel-black" | "panel-red" | "panel-green" | "stoop" | "wood" | "barn" | "blue" | "carved";
export type HouseExtra = "balcony" | "balcony-iron" | "balcony-wood" | "awning" | "chimney" | "stoop" | "porch" | "dovecote" | "meru" | "eave" | "canopy" | "ac" | "none";

/** The four Japanese houses keep the prototype's hand-drawn painters. */
export type HousePainter = "machiya" | "cottage" | "kura" | "modern" | "generic";

export interface HouseSpec {
  painter: HousePainter;
  /** Width, depth and wall height in texels; 16 texels make one world unit. */
  width: number;
  depth: number;
  height: number;
  /** The roof ridge runs along x (eaves face the street) or z (a gable faces it). */
  ridge: "x" | "z";
  /** Roof pitch in radians; 0 is a flat roof behind a parapet. */
  pitch: number;
  overhang: number;
  roof: RoofStyle;
  wall: WallStyle;
  window: WindowStyle;
  door: DoorStyle;
  storeys: number;
  extra: HouseExtra;
}

const generic = (spec: Omit<HouseSpec, "painter">): HouseSpec => ({ painter: "generic", ...spec });

export const HOUSE_SPECS = {
  machiya: { painter: "machiya", width: 72, depth: 46, height: 58, ridge: "x", pitch: 0.5, overhang: 0.45, roof: "kawara", wall: "tile-beige", window: "none", door: "noren", storeys: 2, extra: "eave" },
  cottage: { painter: "cottage", width: 52, depth: 54, height: 36, ridge: "z", pitch: 0.55, overhang: 0.4, roof: "kawara", wall: "tile-beige", window: "none", door: "wood", storeys: 1, extra: "canopy" },
  kura: { painter: "kura", width: 40, depth: 38, height: 46, ridge: "x", pitch: 0.62, overhang: 0.35, roof: "kawara", wall: "whitewash", window: "none", door: "wood", storeys: 2, extra: "none" },
  modern: { painter: "modern", width: 58, depth: 44, height: 50, ridge: "x", pitch: 0.32, overhang: 0.35, roof: "metal", wall: "siding-cream", window: "grid", door: "wood", storeys: 2, extra: "ac" },
  apartment: generic({ width: 64, depth: 44, height: 74, ridge: "x", pitch: 0, overhang: 0, roof: "flat", wall: "tile-beige", window: "grid", door: "glass", storeys: 3, extra: "balcony" }),
  shop: generic({ width: 56, depth: 44, height: 40, ridge: "x", pitch: 0.42, overhang: 0.35, roof: "kawara", wall: "siding-cream", window: "shopfront", door: "noren", storeys: 2, extra: "awning" }),
  townhouse: generic({ width: 54, depth: 44, height: 66, ridge: "x", pitch: 0.3, overhang: 0.3, roof: "terracotta", wall: "stucco-ochre", window: "shutter-green", door: "arched", storeys: 3, extra: "balcony-iron" }),
  palazzo: generic({ width: 74, depth: 48, height: 72, ridge: "x", pitch: 0.28, overhang: 0.35, roof: "terracotta", wall: "stucco-red", window: "arched", door: "portico", storeys: 3, extra: "none" }),
  terrace: generic({ width: 50, depth: 44, height: 62, ridge: "x", pitch: 0.55, overhang: 0.2, roof: "slate", wall: "brick", window: "sash", door: "panel-black", storeys: 3, extra: "chimney" }),
  brownstone: generic({ width: 52, depth: 48, height: 68, ridge: "x", pitch: 0, overhang: 0, roof: "flat", wall: "brownstone", window: "sash", door: "stoop", storeys: 3, extra: "stoop" }),
  tower: generic({ width: 58, depth: 56, height: 150, ridge: "x", pitch: 0, overhang: 0, roof: "flat", wall: "glass", window: "curtain", door: "glass", storeys: 8, extra: "none" }),
  chalet: generic({ width: 64, depth: 58, height: 48, ridge: "z", pitch: 0.6, overhang: 0.55, roof: "shingle", wall: "chalet", window: "shutter-red", door: "wood", storeys: 2, extra: "balcony-wood" }),
  lodge: generic({ width: 78, depth: 50, height: 42, ridge: "x", pitch: 0.58, overhang: 0.45, roof: "metal-green", wall: "log", window: "small-wood", door: "wood", storeys: 2, extra: "chimney" }),
  cabin: generic({ width: 56, depth: 48, height: 38, ridge: "z", pitch: 0.58, overhang: 0.4, roof: "shingle-dark", wall: "shingle-cedar", window: "white-frame", door: "wood", storeys: 1, extra: "porch" }),
  clapboard: generic({ width: 60, depth: 48, height: 50, ridge: "x", pitch: 0.5, overhang: 0.35, roof: "slate", wall: "clapboard-blue", window: "white-frame", door: "panel-red", storeys: 2, extra: "chimney" }),
  boathouse: generic({ width: 50, depth: 60, height: 44, ridge: "z", pitch: 0.55, overhang: 0.3, roof: "metal-red", wall: "clapboard-red", window: "white-frame", door: "barn", storeys: 1, extra: "none" }),
  logcabin: generic({ width: 58, depth: 46, height: 36, ridge: "x", pitch: 0.52, overhang: 0.45, roof: "metal-green", wall: "log", window: "small-wood", door: "wood", storeys: 1, extra: "porch" }),
  farmhouse: generic({ width: 60, depth: 48, height: 52, ridge: "x", pitch: 0.58, overhang: 0.35, roof: "shingle-dark", wall: "clapboard-white", window: "white-frame", door: "panel-green", storeys: 2, extra: "porch" }),
  barn: generic({ width: 70, depth: 60, height: 54, ridge: "z", pitch: 0.72, overhang: 0.3, roof: "metal", wall: "barn-red", window: "none", door: "barn", storeys: 1, extra: "none" }),
  elevator: generic({ width: 36, depth: 36, height: 140, ridge: "x", pitch: 0.95, overhang: 0.15, roof: "metal", wall: "elevator", window: "none", door: "barn", storeys: 1, extra: "none" }),
  ranch: generic({ width: 78, depth: 50, height: 34, ridge: "x", pitch: 0.3, overhang: 0.45, roof: "terracotta", wall: "stucco-white", window: "black-frame", door: "arched", storeys: 1, extra: "none" }),
  bungalow: generic({ width: 58, depth: 52, height: 38, ridge: "z", pitch: 0.4, overhang: 0.5, roof: "shingle", wall: "craftsman", window: "white-frame", door: "wood", storeys: 1, extra: "porch" }),
  cube: generic({ width: 50, depth: 46, height: 42, ridge: "x", pitch: 0, overhang: 0, roof: "flat-white", wall: "whitewash", window: "shutter-blue", door: "blue", storeys: 2, extra: "none" }),
  stucco: generic({ width: 58, depth: 46, height: 46, ridge: "x", pitch: 0.3, overhang: 0.3, roof: "terracotta", wall: "stucco-cream", window: "shutter-green", door: "arched", storeys: 2, extra: "balcony-iron" }),
  canary: generic({ width: 56, depth: 46, height: 46, ridge: "x", pitch: 0, overhang: 0, roof: "flat-white", wall: "whitewash", window: "shutter-green", door: "wood", storeys: 2, extra: "balcony-wood" }),
  pavilion: generic({ width: 58, depth: 52, height: 30, ridge: "x", pitch: 0.82, overhang: 0.6, roof: "thatch", wall: "bali", window: "carved", door: "carved", storeys: 1, extra: "none" }),
  shrine: generic({ width: 36, depth: 36, height: 34, ridge: "x", pitch: 0.7, overhang: 0.4, roof: "thatch", wall: "bali", window: "none", door: "carved", storeys: 1, extra: "meru" }),
  casale: generic({ width: 72, depth: 48, height: 56, ridge: "x", pitch: 0.3, overhang: 0.35, roof: "terracotta", wall: "stone-ochre", window: "shutter-green", door: "arched", storeys: 2, extra: "dovecote" }),
  rustico: generic({ width: 60, depth: 50, height: 44, ridge: "z", pitch: 0.34, overhang: 0.35, roof: "terracotta", wall: "brick-plaster", window: "shutter-green", door: "barn", storeys: 2, extra: "none" }),
} satisfies Record<string, HouseSpec>;

export type HouseKind = keyof typeof HOUSE_SPECS;

export interface GroundPalette {
  /** Three grass levels, dark to light, dithered by noise. */
  grass: [string, string, string];
  tuft: [string, string];
  path: { base: string; light: string; dark: string };
  rim: [string, string];
  forestFloor: [string, string, string];
  /** The far plane beyond the ground and the fog's ground tint. */
  far: string;
  /** Leaves under deciduous trees, or null. */
  litter: string[] | null;
}

export type Filler = "forest" | "grove" | "blocks" | "fields";
export type FieldKind = "wheat" | "vines" | "rice" | null;
export type WaterKind = "canal" | "creek" | "shore" | "none";
export type Backdrop = "peaks" | "volcano" | "hills" | null;
export type CornerProp = "vending" | "lamp" | "well" | "hay" | "amphora" | "boat" | "lantern" | "bins" | "woodpile" | "shrine-gate";
export type BedKind = "mums" | "tulips" | "veg" | "lavender" | "succulents" | "none";

export interface BiomeKit {
  houses: HouseKind[];
  /** Houses added when the town is on the coast. */
  coastHouses?: HouseKind[];
  canopy: Record<Season, TreeSpecies>;
  accents: Record<Season, TreeSpecies[]>;
  filler: Filler;
  /** Grid spacing of the filler trees in world units. */
  spacing: number;
  /** The share of filler cells left empty, from noise. */
  clearing: number;
  field: FieldKind;
  water: WaterKind;
  pond: boolean;
  backdrop: Backdrop;
  snowInWinter: boolean;
  ground: GroundPalette;
  /** A season's own ground, where it differs. */
  seasonGround?: Partial<Record<Season, Partial<GroundPalette>>>;
  bed: BedKind;
  corner: CornerProp;
  shrub: [string, string, string, string];
}

const all = (species: TreeSpecies): Record<Season, TreeSpecies> => ({ spring: species, summer: species, autumn: species, winter: species, tropical: species });
const allAccents = (species: TreeSpecies[]): Record<Season, TreeSpecies[]> => ({ spring: species, summer: species, autumn: species, winter: species, tropical: species });

const KYOTO_GROUND: GroundPalette = {
  grass: ["#5b9140", "#6aa247", "#7bb352"],
  tuft: ["#4d8336", "#93c665"],
  path: { base: "#dcc9a0", light: "#e7d8b6", dark: "#c7b189" },
  rim: ["#a6cc72", "#8fbe5f"],
  forestFloor: ["#3e6c33", "#36602d", "#4c5e30"],
  far: "#3a5230",
  litter: ["#c8402a", "#e2692c", "#b8342a", "#f0b83a", "#f6cf55"],
};

export const SNOW_GROUND: Partial<GroundPalette> = {
  grass: ["#dfe6ec", "#eef2f5", "#f8fafb"],
  tuft: ["#c5ced8", "#ffffff"],
  rim: ["#cfd8e0", "#e3e9ee"],
  forestFloor: ["#c9d2da", "#bcc6cf", "#d5dde3"],
  far: "#b9c4cc",
  litter: null,
};

export const BIOME_KITS: Record<Biome, BiomeKit> = {
  japan: {
    houses: ["machiya", "cottage", "kura", "modern"],
    canopy: all("cedar"),
    accents: {
      autumn: ["maple-red", "maple-orange", "ginkgo", "maple-red"],
      spring: ["cherry", "cherry", "maple-green"],
      summer: ["maple-green", "ginkgo-green"],
      winter: ["bare", "cherry"],
      tropical: ["maple-green"],
    },
    filler: "forest",
    spacing: 0.82,
    clearing: 0,
    field: null,
    water: "canal",
    pond: true,
    backdrop: null,
    snowInWinter: false,
    ground: KYOTO_GROUND,
    seasonGround: { spring: { litter: ["#f4b8c8", "#f9d3dc"] }, summer: { litter: null }, winter: { litter: null } },
    bed: "mums",
    corner: "vending",
    shrub: ["#c23a2a", "#a92e24", "#d9562e", "#7d2a20"],
  },
  city: {
    houses: ["townhouse", "palazzo"],
    canopy: { spring: "plane", summer: "plane", autumn: "plane-gold", winter: "bare", tropical: "plane" },
    accents: { spring: ["cherry", "plane"], summer: ["plane"], autumn: ["plane-gold", "maple-orange"], winter: ["bare"], tropical: ["palm"] },
    filler: "blocks",
    spacing: 2.9,
    clearing: 0.08,
    field: null,
    water: "canal",
    pond: false,
    backdrop: null,
    snowInWinter: false,
    ground: {
      grass: ["#8f8a82", "#9b968d", "#a8a399"],
      tuft: ["#7d7871", "#b6b1a7"],
      path: { base: "#5d6066", light: "#6c6f75", dark: "#4c4f55" },
      rim: ["#c8c2b4", "#b6b0a2"],
      forestFloor: ["#6e8c4a", "#628042", "#7b9a54"],
      far: "#7c7a76",
      litter: null,
    },
    seasonGround: { autumn: { litter: ["#d8a53a", "#c98a2c"] } },
    bed: "tulips",
    corner: "lamp",
    shrub: ["#4f7a3a", "#3c6230", "#5f8a44", "#2f5228"],
  },
  alpine: {
    houses: ["chalet", "lodge"],
    canopy: all("spruce"),
    accents: { spring: ["larch", "birch"], summer: ["larch"], autumn: ["larch-gold", "aspen-gold"], winter: ["spruce"], tropical: ["larch"] },
    filler: "forest",
    spacing: 0.95,
    clearing: 0.22,
    field: null,
    water: "creek",
    pond: true,
    backdrop: "peaks",
    snowInWinter: true,
    ground: {
      grass: ["#5f8a46", "#73a052", "#8bb862"],
      tuft: ["#4f7a3a", "#e8e0a0"],
      path: { base: "#b9ad96", light: "#cbc0aa", dark: "#9c917c" },
      rim: ["#9cc276", "#86b066"],
      forestFloor: ["#3b5a35", "#33502f", "#4a5a3c"],
      far: "#3d5238",
      litter: null,
    },
    seasonGround: { autumn: { grass: ["#7c8a48", "#8f9c56", "#a3ad66"] } },
    bed: "none",
    corner: "woodpile",
    shrub: ["#4a6e3a", "#3b5a30", "#5a7e44", "#2e4a28"],
  },
  pnw: {
    houses: ["cabin", "clapboard"],
    coastHouses: ["boathouse"],
    canopy: all("fir"),
    accents: { spring: ["maple-green", "birch"], summer: ["maple-green"], autumn: ["maple-orange", "maple-green", "aspen-gold"], winter: ["bare"], tropical: ["maple-green"] },
    filler: "forest",
    spacing: 0.78,
    clearing: 0.04,
    field: null,
    water: "creek",
    pond: false,
    backdrop: "hills",
    snowInWinter: false,
    ground: {
      grass: ["#3f7a3e", "#4c8a46", "#5c9a52"],
      tuft: ["#356a35", "#7ab06a"],
      path: { base: "#a69a84", light: "#b8ad98", dark: "#8c826e" },
      rim: ["#78a85e", "#669a52"],
      forestFloor: ["#2c4a2c", "#263f27", "#3a4e30"],
      far: "#2b4030",
      litter: null,
    },
    bed: "none",
    corner: "boat",
    shrub: ["#3a6a38", "#2f5a30", "#4a7a44", "#24482a"],
  },
  swamp: {
    houses: ["logcabin", "cabin"],
    canopy: all("spruce"),
    accents: { spring: ["aspen", "birch"], summer: ["aspen", "birch"], autumn: ["aspen-gold", "birch"], winter: ["bare"], tropical: ["aspen"] },
    filler: "forest",
    spacing: 0.9,
    clearing: 0.3,
    field: null,
    water: "creek",
    pond: true,
    backdrop: "hills",
    snowInWinter: true,
    ground: {
      grass: ["#6b7e3c", "#7a8c46", "#8d9a52"],
      tuft: ["#5a6a32", "#b3a860"],
      path: { base: "#9a8a6c", light: "#ab9c7e", dark: "#84755a" },
      rim: ["#94a25c", "#82924e"],
      forestFloor: ["#3a4a2c", "#334226", "#4a4a2e"],
      far: "#3a4630",
      litter: null,
    },
    bed: "none",
    corner: "woodpile",
    shrub: ["#6a7a3a", "#566630", "#7c8a44", "#4a5a2a"],
  },
  prairie: {
    houses: ["farmhouse", "barn", "elevator"],
    canopy: { spring: "poplar", summer: "poplar", autumn: "poplar-gold", winter: "bare", tropical: "poplar" },
    accents: { spring: ["aspen"], summer: ["aspen"], autumn: ["aspen-gold"], winter: ["bare"], tropical: ["aspen"] },
    filler: "fields",
    spacing: 0.9,
    clearing: 0,
    field: "wheat",
    water: "none",
    pond: true,
    backdrop: null,
    snowInWinter: true,
    ground: {
      grass: ["#8c9a4c", "#9cab58", "#b2bb68"],
      tuft: ["#7a8a42", "#d8c878"],
      path: { base: "#b49c78", light: "#c6b08c", dark: "#9a8462" },
      rim: ["#a8b46a", "#96a45c"],
      forestFloor: ["#d8b65a", "#c9a64c", "#e4c66c"],
      far: "#b8a058",
      litter: null,
    },
    seasonGround: { spring: { forestFloor: ["#6f8a3e", "#7e9a48", "#5f7a36"], far: "#6f8a3e" } },
    bed: "veg",
    corner: "hay",
    shrub: ["#7a8a42", "#6a7a3a", "#8a9a4c", "#5a6a32"],
  },
  calif: {
    houses: ["ranch", "bungalow"],
    canopy: all("oak"),
    accents: allAccents(["palm", "palm", "oak"]),
    filler: "grove",
    spacing: 1.7,
    clearing: 0.35,
    field: null,
    water: "none",
    pond: false,
    backdrop: "hills",
    snowInWinter: false,
    ground: {
      grass: ["#c2a456", "#cfb262", "#dcc070"],
      tuft: ["#a88c44", "#e8d38a"],
      path: { base: "#d8cdb8", light: "#e6ddca", dark: "#c0b49c" },
      rim: ["#b9a457", "#a8944c"],
      forestFloor: ["#a89048", "#9c8440", "#8e7a3c"],
      far: "#a8904c",
      litter: null,
    },
    seasonGround: { spring: { grass: ["#7a9a46", "#88a852", "#98b45e"], forestFloor: ["#6a8a40", "#5e7e38", "#7a8a44"] }, winter: { grass: ["#7a9a46", "#88a852", "#98b45e"] } },
    bed: "succulents",
    corner: "lamp",
    shrub: ["#6a7a48", "#5a6a3c", "#7a8a52", "#4a5a34"],
  },
  med: {
    houses: ["cube", "stucco"],
    canopy: all("olive"),
    accents: allAccents(["cypress", "cypress", "olive"]),
    filler: "grove",
    spacing: 1.6,
    clearing: 0.3,
    field: null,
    water: "none",
    pond: false,
    backdrop: "hills",
    snowInWinter: false,
    ground: {
      grass: ["#b8a46a", "#c6b276", "#d2c084"],
      tuft: ["#9c8a54", "#e0d29a"],
      path: { base: "#e4d8c0", light: "#efe6d4", dark: "#cdbfa4" },
      rim: ["#b4a46c", "#a4945e"],
      forestFloor: ["#a49058", "#988650", "#8c7c4a"],
      far: "#a08c58",
      litter: null,
    },
    seasonGround: { winter: { grass: ["#8a9a52", "#98a65c", "#a8b26a"] }, spring: { grass: ["#8a9a52", "#98a65c", "#a8b26a"] } },
    bed: "lavender",
    corner: "amphora",
    shrub: ["#6e7a4c", "#5e6a42", "#7e8a56", "#4e5a38"],
  },
  volc: {
    houses: ["canary", "cube"],
    canopy: all("euphorbia"),
    accents: allAccents(["palm", "palm", "euphorbia"]),
    filler: "grove",
    spacing: 2.0,
    clearing: 0.4,
    field: null,
    water: "none",
    pond: false,
    backdrop: "volcano",
    snowInWinter: false,
    ground: {
      grass: ["#3a3433", "#47403d", "#565049"],
      tuft: ["#2c2827", "#7a6a50"],
      path: { base: "#c9b89a", light: "#d8c9ae", dark: "#b0a084" },
      rim: ["#6a5c4a", "#5a4e40"],
      forestFloor: ["#5a4a3c", "#4e4034", "#665444"],
      far: "#3c3634",
      litter: null,
    },
    bed: "succulents",
    corner: "amphora",
    shrub: ["#6a7a3c", "#5a6a34", "#7a8a44", "#4a5a2c"],
  },
  jungle: {
    houses: ["pavilion", "shrine"],
    canopy: all("palm"),
    accents: allAccents(["banana", "broadleaf", "banana"]),
    filler: "forest",
    spacing: 1.05,
    clearing: 0.05,
    field: "rice",
    water: "creek",
    pond: true,
    backdrop: "volcano",
    snowInWinter: false,
    ground: {
      grass: ["#3f9a3a", "#4cae44", "#5ec050"],
      tuft: ["#358a32", "#8ad06a"],
      path: { base: "#b89a74", light: "#c8ac88", dark: "#9c805e" },
      rim: ["#6cbc52", "#5aac46"],
      forestFloor: ["#2a6a2e", "#246028", "#347232"],
      far: "#245a2c",
      litter: ["#e8503a", "#f2c14e", "#f4f1e6"],
    },
    bed: "tulips",
    corner: "shrine-gate",
    shrub: ["#3a8a3a", "#2f7a30", "#4a9a44", "#d84a7a"],
  },
  farm: {
    houses: ["casale", "rustico"],
    canopy: { spring: "poplar", summer: "poplar", autumn: "poplar-gold", winter: "bare", tropical: "poplar" },
    accents: allAccents(["cypress", "cypress"]),
    filler: "fields",
    spacing: 0.85,
    clearing: 0,
    field: "vines",
    water: "canal",
    pond: false,
    backdrop: "hills",
    snowInWinter: false,
    ground: {
      grass: ["#6a8c44", "#78984e", "#88a65a"],
      tuft: ["#5a7a3a", "#a8b86a"],
      path: { base: "#d2c2a0", light: "#ded0b2", dark: "#baa984" },
      rim: ["#98b066", "#86a058"],
      forestFloor: ["#8a7a4e", "#7c6c44", "#9a8a58"],
      far: "#7a8a52",
      litter: null,
    },
    seasonGround: { winter: { grass: ["#7a8a52", "#86945c", "#94a066"], litter: ["#a8743a", "#8a5a2c"] } },
    bed: "veg",
    corner: "well",
    shrub: ["#5a7a3a", "#4a6a32", "#6a8a44", "#3a5a2a"],
  },
};

/** A city is built in its region's style. */
export function cityHouses(lat: number, lng: number): HouseKind[] {
  if (lng > 100) return ["apartment", "shop", "modern", "machiya"];
  if (lng < -30) return ["brownstone", "tower"];
  if (lat >= 50) return ["terrace"];
  return ["townhouse", "palazzo"];
}
