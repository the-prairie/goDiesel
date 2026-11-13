// The sketch, as a MapLibre style: the real world from OpenStreetMap
// (through OpenFreeMap's OpenMapTiles build) and Natural Earth relief, drawn
// as line work on paper. Streets are double lines, water a shoreline with a
// second contour, parks a dotted edge, buildings white forms (their edges
// come from the custom edge layer). Nothing carries colour except her routes
// and what they have explored, coloured by its distance to them.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

import type { SketchLook } from "@/labs/sketch/sketch-options";
import { REVEAL_RADIUS_M, corridorPolygons, samplePoints, type ExploredRoute, type RevealMode } from "@/labs/sketch/sketch-reveal";

export const SKETCH_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>';

const RELIEF_ATTRIBUTION = 'Relief: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>';

/** The two looks: paper, ink, and the weight of a line. */
const LOOKS: Record<SketchLook, { paper: string; ink: string; faint: string; water: string; wall: string; weight: number; blur: number }> = {
  line: { paper: "#fbfbf8", ink: "#1d1d1f", faint: "#9a9a98", water: "#eef0f0", wall: "#ffffff", weight: 1, blur: 0 },
  pencil: { paper: "#f5f2ea", ink: "#45443f", faint: "#a8a59c", water: "#ebe8df", wall: "#f8f6ef", weight: 0.85, blur: 0.5 },
};

/** The colours of the explored world: the real thing, as a map shows it. */
const REAL = {
  water: "#8fc1e3",
  park: "#b5d99a",
  route: "#d9412b",
  ground: "#efe8d6",
};

export interface SketchStyleInput {
  look: SketchLook;
  reveal: RevealMode;
  explored: readonly ExploredRoute[];
}

/** Halfway between two colours. */
function mix(a: string, b: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round((channel(a, i) + channel(b, i)) / 2).toString(16).padStart(2, "0")).join("")}`;
}

/** Line width by zoom, scaled by the look's weight. */
const width = (weight: number, stops: [number, number][]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.6], ["zoom"], ...stops.flatMap(([zoom, px]) => [zoom, px * weight])] as ExpressionSpecification;

export function sketchStyle({ look, reveal, explored }: SketchStyleInput): StyleSpecification {
  const L = LOOKS[look];
  const radius = REVEAL_RADIUS_M[reveal];
  const lines = explored.map((route) => route.line);
  const corridor = corridorPolygons(lines, radius);
  /**
   * A grey from the sketch, or the real colour where explored. Which
   * features lie near her routes is worked out from the tiles themselves and
   * set as each feature's `explored` state: 2 within half the reveal's
   * radius, 1 within it. (MapLibre's own `distance` counted buildings 900 m
   * off as within 120 m, and its `within` ignores polygons.)
   */
  const tint = (grey: string, real: string): string | ExpressionSpecification => {
    if (reveal === "line" || explored.length === 0) return grey;
    const level: ExpressionSpecification = ["coalesce", ["feature-state", "explored"], 0];
    if (reveal === "corridor") return ["case", [">=", level, 1], real, grey];
    // The wash fades: full colour near the route, half towards its edge.
    return ["case", [">=", level, 2], real, [">=", level, 1], mix(real, grey), grey];
  };
  const transport = (classes: string[]): ExpressionSpecification => ["all", ["match", ["get", "class"], classes, true, false], ["!=", ["get", "brunnel"], "tunnel"]];

  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": L.paper } },
    {
      id: "relief",
      type: "raster",
      source: "relief",
      maxzoom: 9,
      paint: {
        "raster-saturation": -1,
        "raster-contrast": 0.15,
        "raster-brightness-min": look === "line" ? 0.42 : 0.38,
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 8.5, 0],
      },
    },
  ];

  if (reveal === "wash" && explored.length > 0) {
    // A soft bloom of colour under the line work, its edge feathered.
    layers.push({
      id: "explored-wash",
      type: "heatmap",
      source: "sketch-reveal-points",
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": 0.9,
        // About the wash's radius in metres, at Kyoto's latitude, at any zoom.
        "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, Math.max(4, radius / 125), 20, Math.max(4, radius / 0.122)],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(255,255,255,0)",
          0.18,
          "rgba(184,214,160,0.20)",
          0.45,
          "rgba(170,205,225,0.38)",
          1,
          "rgba(240,206,160,0.5)",
        ],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 11, 1],
      },
    });
  }

  if (reveal === "corridor" && explored.length > 0) {
    // The ground itself, inside the corridor, in colour.
    layers.push({ id: "explored-ground", type: "fill", source: "sketch-corridor", paint: { "fill-color": REAL.ground, "fill-antialias": false } });
  }

  layers.push(
    {
      id: "wood",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["match", ["get", "class"], ["wood", "forest"], true, false],
      paint: { "fill-color": L.paper, "fill-outline-color": L.faint, "fill-opacity": 0.9 },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": tint(L.paper, REAL.park), "fill-opacity": 0.9 },
    },
    {
      id: "park-edge",
      type: "line",
      source: "openmaptiles",
      "source-layer": "park",
      minzoom: 11,
      paint: { "line-color": L.faint, "line-width": width(L.weight, [[11, 0.6], [18, 1.4]]), "line-dasharray": [1, 2.5] },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": tint(L.water, REAL.water) },
    },
    {
      // A second contour just inside the shore, as old maps drew water.
      id: "water-contour",
      type: "line",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "line-color": L.faint, "line-width": width(L.weight, [[3, 0.4], [16, 0.8]]), "line-offset": width(1, [[3, 1.5], [16, 4]]), "line-blur": L.blur },
    },
    {
      id: "water-shore",
      type: "line",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[2, 0.5], [10, 0.9], [18, 1.6]]), "line-blur": L.blur },
    },
    {
      id: "river",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], ["match", ["get", "class"], ["river", "canal"], true, false]],
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[5, 0.4], [12, 1], [18, 2.5]]), "line-blur": L.blur },
    },
    {
      id: "stream",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      minzoom: 13,
      filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], ["match", ["get", "class"], ["stream", "ditch", "drain"], true, false]],
      paint: { "line-color": L.faint, "line-width": width(L.weight, [[13, 0.5], [18, 1.2]]) },
    },
    {
      id: "boundary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": L.faint, "line-width": width(L.weight, [[2, 0.6], [10, 1.2]]), "line-dasharray": [3, 2] },
    },
    // Streets: an ink casing with paper inside, so each street is two lines.
    {
      id: "road-major-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 6,
      filter: transport(["motorway", "trunk", "primary"]),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[6, 0.6], [12, 3], [16, 12], [19, 34]]), "line-blur": L.blur },
    },
    {
      id: "road-mid-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 10,
      filter: transport(["secondary", "tertiary"]),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[10, 0.5], [13, 2.5], [16, 9], [19, 26]]), "line-blur": L.blur },
    },
    {
      id: "road-minor-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 13,
      filter: transport(["minor", "service"]),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[13, 0.4], [15, 2.6], [17, 6.5], [19, 18]]), "line-blur": L.blur },
    },
    {
      id: "road-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 11,
      filter: transport(["motorway", "trunk", "primary"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": L.paper, "line-width": width(1, [[11, 0.6], [12, 1.6], [16, 10], [19, 31]]) },
    },
    {
      id: "road-mid",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 12.5,
      filter: transport(["secondary", "tertiary"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": L.paper, "line-width": width(1, [[12.5, 1], [16, 7.4], [19, 23.5]]) },
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 14.5,
      filter: transport(["minor", "service"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": L.paper, "line-width": width(1, [[14.5, 1.2], [17, 5], [19, 15.5]]) },
    },
    {
      id: "path",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 14,
      filter: transport(["path", "track"]),
      paint: { "line-color": L.faint, "line-width": width(L.weight, [[14, 0.6], [19, 1.6]]), "line-dasharray": [2, 2] },
    },
    {
      id: "rail",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 9,
      filter: transport(["rail", "transit"]),
      paint: { "line-color": L.ink, "line-width": width(L.weight, [[9, 0.5], [16, 1.2], [19, 2]]) },
    },
    {
      // Sleepers across the rails.
      id: "rail-ties",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 13,
      filter: transport(["rail", "transit"]),
      paint: { "line-color": L.ink, "line-width": width(1, [[13, 2.5], [16, 5], [19, 9]]), "line-dasharray": [0.15, 2.5] },
    },
    {
      // Far out, a building is its drawn footprint.
      id: "building-plan",
      type: "line",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13.5,
      maxzoom: 15.2,
      paint: { "line-color": L.faint, "line-width": 0.5 * L.weight, "line-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.2, 1] },
    },
    {
      // Close in, it stands up as a white form; the edge layer draws its lines.
      id: "building-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 14.6,
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        "fill-extrusion-color": L.wall,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 14.6, 0, 15.2, 1],
        "fill-extrusion-vertical-gradient": false,
      },
    },
    {
      id: "route-casing",
      type: "line",
      source: "sketch-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": L.paper, "line-width": width(1, [[8, 4], [14, 7], [18, 13]]), "line-opacity": 0.9 },
    },
    {
      id: "route-line",
      type: "line",
      source: "sketch-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": REAL.route, "line-width": width(1, [[8, 2], [14, 3.5], [18, 7]]) },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["match", ["get", "class"], ["country", "city", "town"], true, false],
      maxzoom: 15,
      layout: {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, ["match", ["get", "class"], "country", 13, 10], 12, ["match", ["get", "class"], "city", 15, 12]],
        "text-letter-spacing": 0.08,
        "text-transform": "uppercase",
        "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      },
      paint: { "text-color": L.ink, "text-halo-color": L.paper, "text-halo-width": 1.6 },
    },
  );

  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    // Soft light, so white forms stay white: the walls only a shade darker than the roofs.
    light: { anchor: "viewport", color: "#ffffff", intensity: look === "line" ? 0.22 : 0.28, position: [1.15, 200, 35] },
    sources: {
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: SKETCH_ATTRIBUTION },
      relief: {
        type: "raster",
        tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 6,
        attribution: RELIEF_ATTRIBUTION,
      },
      "sketch-routes": {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: explored.map((route) => ({ type: "Feature", properties: { slug: route.slug, by: route.by }, geometry: { type: "LineString", coordinates: route.line } })),
        },
      },
      "sketch-corridor": { type: "geojson", data: { type: "Feature", properties: {}, geometry: corridor } },
      "sketch-reveal-points": {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: explored.flatMap((route) =>
            samplePoints(route.line, Math.max(40, radius / 2)).map((point) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: point } })),
          ),
        },
      },
    },
    layers,
  };
}
