import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Art direction for the journal plate, applied to the live openfreemap Liberty
 * style after load.
 *
 * This is a restyle of the real renderer and the real vector tiles - no imagery
 * substitution, no invented terrain. Three moves:
 *
 *   1. Land and water are pushed apart in value so the coastline reads as the
 *      strongest edge on the plate. Liberty ships #f8f4f0 land against
 *      rgb(158,189,255) water, a saturated cartoon blue that competed with the
 *      recorded route for attention.
 *   2. Background detail is quieted or removed - points of interest, buildings,
 *      one-way arrows, route shields, administrative boundaries, sports and
 *      institutional land use. None of it helps Lauren recognise a place she ran.
 *   3. The surviving labels are given a deliberate hierarchy with parchment
 *      halos, so toponyms sit under the route rather than fighting it.
 *
 * Terrain relief note: Liberty's only relief source is `ne2_shaded`, whose
 * source maxzoom is 6. At the plate's z10-12 framing it would be a 16-64x
 * overzoom of a low-resolution raster, so shaded relief is genuinely
 * unavailable at this scale from this provider. Landcover and the elevation
 * profile carry relief instead. Nothing here fabricates terrain.
 */

export interface CartographyPalette {
  land: string;
  water: string;
  waterEdge: string;
  wood: string;
  grass: string;
  sand: string;
  road: string;
  roadMajor: string;
  ink: string;
  inkSoft: string;
  halo: string;
  /** The selected route on the map. */
  route: string;
  /** Casing and bloom that lift the selected route off the landform. */
  routeCasing: string;
  /** Everything else recorded in this region. */
  routeHistory: string;
  /** Built-up shading. Left unthemed it kept a warm parchment cast in cities. */
  settlement: string;
}

/** Kept as the default so callers without a theme still render sensibly. */
export const JOURNAL_PALETTE: CartographyPalette = {
  route: "#c8502f",
  routeCasing: "#f4efe3",
  routeHistory: "#3379df",
  settlement: "rgba(214,201,177,0.36)",
  land: "#f1ebdd",
  water: "#8ba3b0",
  waterEdge: "#7b93a1",
  wood: "rgba(146,163,128,0.34)",
  grass: "rgba(163,177,140,0.22)",
  sand: "rgba(224,209,176,0.55)",
  road: "#ded4c2",
  roadMajor: "#d0c4ac",
  ink: "#413b32",
  inkSoft: "#6b6355",
  halo: "rgba(241,235,221,0.94)",
};

/** Layers that carry no meaning for remembering a route. */
const REMOVE = [
  "poi_r20", "poi_r7", "poi_r1", "poi_transit",
  "building", "building-3d",
  "road_one_way_arrow", "road_one_way_arrow_opposite",
  "highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us",
  "boundary_3", "boundary_2", "boundary_disputed",
  "landuse_pitch", "landuse_track", "landuse_cemetery",
  "landuse_hospital", "landuse_school",
  "aeroway_fill", "aeroway_runway", "aeroway_taxiway", "airport",
  "highway-name-path", "highway-name-minor",
  "landcover_ice",
];

function setPaint(map: MapLibreMap, id: string, prop: string, value: unknown) {
  if (!map.getLayer(id)) return;
  try {
    map.setPaintProperty(id, prop, value as never);
  } catch {
    // A style revision may drop or rename a layer; the plate must still render.
  }
}

function setLayout(map: MapLibreMap, id: string, prop: string, value: unknown) {
  if (!map.getLayer(id)) return;
  try {
    map.setLayoutProperty(id, prop, value as never);
  } catch {
    // Same tolerance as setPaint.
  }
}

export function applyJournalCartography(
  map: MapLibreMap,
  palette: CartographyPalette = JOURNAL_PALETTE,
) {
  for (const id of REMOVE) {
    if (map.getLayer(id)) {
      try {
        map.removeLayer(id);
      } catch {
        // Ignore: the layer is already gone.
      }
    }
  }

  // -- Ground ---------------------------------------------------------------
  setPaint(map, "background", "background-color", palette.land);
  setPaint(map, "water", "fill-color", palette.water);
  setPaint(map, "landcover_wood", "fill-color", palette.wood);
  setPaint(map, "landcover_wood", "fill-opacity", 1);
  setPaint(map, "landcover_grass", "fill-color", palette.grass);
  setPaint(map, "landcover_grass", "fill-opacity", 1);
  setPaint(map, "landcover_sand", "fill-color", palette.sand);
  setPaint(map, "landcover_wetland", "fill-opacity", 0.22);
  setPaint(map, "park", "fill-color", palette.grass);
  setPaint(map, "park", "fill-opacity", 0.6);
  setPaint(map, "park_outline", "line-opacity", 0);
  // Settlement shading stays, but as a whisper rather than a slab.
  setPaint(map, "landuse_residential", "fill-color", palette.settlement);

  // Rivers read as water, not as roads.
  for (const id of ["waterway_river", "waterway_other", "waterway_tunnel"]) {
    setPaint(map, id, "line-color", palette.waterEdge);
    setPaint(map, id, "line-opacity", 0.55);
  }

  // -- Road network: present for orientation, never dominant ---------------
  const roadLayers = (map.getStyle().layers ?? [])
    .map((layer) => layer.id)
    .filter((id) => /^(road|bridge|tunnel)_/.test(id));
  for (const id of roadLayers) {
    const casing = /casing/.test(id);
    setPaint(map, id, "line-color", casing ? palette.roadMajor : palette.road);
    setPaint(map, id, "line-opacity", casing ? 0.5 : 0.72);
  }

  // -- Labels: one clear hierarchy -----------------------------------------
  // Settlements in ink, water names in the water's own darker tone, minor
  // toponyms quiet and italic (Liberty already sets Noto Sans Italic there).
  for (const id of ["label_city_capital", "label_city", "label_town"]) {
    setPaint(map, id, "text-color", palette.ink);
    setPaint(map, id, "text-halo-color", palette.halo);
    setPaint(map, id, "text-halo-width", 1.6);
  }
  setPaint(map, "label_village", "text-color", palette.inkSoft);
  setPaint(map, "label_village", "text-halo-color", palette.halo);
  setPaint(map, "label_village", "text-halo-width", 1.4);
  setPaint(map, "label_other", "text-color", palette.inkSoft);
  setPaint(map, "label_other", "text-halo-color", palette.halo);
  setPaint(map, "label_other", "text-halo-width", 1.2);
  setLayout(map, "label_other", "text-letter-spacing", 0.06);

  for (const id of ["water_name_point_label", "water_name_line_label", "waterway_line_label"]) {
    setPaint(map, id, "text-color", "#4f6570");
    setPaint(map, id, "text-halo-color", "rgba(139,163,176,0.5)");
    setPaint(map, id, "text-halo-width", 1.1);
  }

  // Road names survive only at close range, where they orient rather than clutter.
  setLayout(map, "highway-name-major", "text-size", 10);
  setPaint(map, "highway-name-major", "text-color", "rgba(107,99,85,0.8)");
  setPaint(map, "highway-name-major", "text-halo-color", palette.halo);

  // Country and state labels are meaningless inside a single region plate.
  for (const id of ["label_country_1", "label_country_2", "label_country_3", "label_state"]) {
    setPaint(map, id, "text-opacity", 0);
  }
}
