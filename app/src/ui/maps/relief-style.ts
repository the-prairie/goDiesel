import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Art direction for the carried-notebook direction: real landform.
 *
 * The journal plate's cartography note recorded that shaded relief was
 * "genuinely unavailable at this scale from this provider" - Liberty's only
 * relief source is `ne2_shaded` at source maxzoom 6, a 16-64x overzoom at the
 * framings these surfaces use. That was true of the basemap provider and it is
 * still true. It was not true of the world.
 *
 * Mapzen Terrain Tiles are public-domain elevation rasters hosted on the AWS
 * Open Data registry, terrarium-encoded and served to z15. Probed here at
 * z10-z15 they return 66-139 KB per tile. That is a real DEM, so this direction
 * has real hillshade and real 3D terrain: the ridge Lauren climbed has a shape,
 * and pitching the camera moves through it rather than across a flat plate.
 *
 * Nothing is fabricated. The elevation raster and the vector basemap are both
 * credited in the attribution control (see `RELIEF_ATTRIBUTION`).
 */

export const DEM_SOURCE_ID = "relief-dem";
export const SHADE_SOURCE_ID = "relief-shade-dem";
export const HILLSHADE_LAYER_ID = "relief-hillshade";

/**
 * Elevation credit, added alongside the basemap's own required attribution.
 * Mapzen Terrain Tiles are CC0; the underlying sources are acknowledged as the
 * registry asks.
 */
export const RELIEF_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Elevation: Mapzen Terrain Tiles</a>';

export interface ReliefPalette {
  /** Low ground. */
  land: string;
  /** High ground, blended in by elevation so ridges warm as they rise. */
  upland: string;
  water: string;
  waterDeep: string;
  wood: string;
  grass: string;
  sand: string;
  road: string;
  roadMajor: string;
  ink: string;
  inkSoft: string;
  halo: string;
  settlement: string;
  /** Light and shadow on the modelled landform. */
  shadeHighlight: string;
  shadeShadow: string;
  shadeAccent: string;
  /** The recorded route. */
  route: string;
  routeCasing: string;
  /** Distance already inspected, behind the handle. */
  routeTravelled: string;
  /** Everything else recorded in this region. */
  routeHistory: string;
}

/**
 * Warm, unchanged in hue from the accepted journal palette - the ambition here
 * is the landform, not another colour direction. Water is deepened and given a
 * second, darker value so a pitched horizon has somewhere to go, and two new
 * values carry hillshade light and shadow.
 */
export const RELIEF_PALETTE: ReliefPalette = {
  land: "#f2f0ea",
  upland: "#e9e1d0",
  water: "#476a74",
  waterDeep: "#31525c",
  wood: "rgba(134,148,104,0.32)",
  grass: "rgba(158,166,120,0.18)",
  sand: "rgba(214,196,158,0.5)",
  road: "#e2dccd",
  roadMajor: "#d3cab5",
  ink: "#3b352c",
  inkSoft: "#645c4d",
  halo: "rgba(242,240,234,0.94)",
  settlement: "rgba(216,204,180,0.3)",
  /*
   * Rebalanced after the first render: a 0.5 highlight over #f2f0ea blew the
   * landform out to near-white and the modelled shape disappeared. The shadow
   * now carries the relief and the highlight only lifts the sunlit faces.
   */
  shadeHighlight: "rgba(255,250,240,0.22)",
  shadeShadow: "rgba(72,56,38,0.58)",
  shadeAccent: "rgba(126,98,64,0.42)",
  route: "#c34a24",
  routeCasing: "#faf7f0",
  routeTravelled: "#8d2f14",
  /*
   * The other days. Warmed off slate after the first render: in a cool grey
   * they read as roads on the map rather than as lines she had run.
   */
  routeHistory: "rgba(104,92,74,0.72)",
};

const setPaint = (map: MapLibreMap, id: string, prop: string, value: unknown) => {
  if (!map.getLayer(id)) return;
  try {
    map.setPaintProperty(id, prop, value as never);
  } catch {
    /* A style revision that renamed a layer must not take the surface down. */
  }
};

const hide = (map: MapLibreMap, id: string) => {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
};

/**
 * Attach the DEM and the hillshade beneath everything the basemap draws.
 *
 * The hillshade goes under the first symbol layer rather than on top, so labels
 * and the recorded route stay readable over modelled terrain. `setTerrain` is
 * applied separately by the caller, because a pitched camera is a composition
 * decision and a flat overview should not pay for it.
 */
export function attachRelief(map: MapLibreMap, palette = RELIEF_PALETTE) {
  // Hillshade and terrain request different tile resolutions. Separate caches
  // avoid reusing a hillshade tile as the relief mesh during a close approach.
  for (const sourceId of [DEM_SOURCE_ID, SHADE_SOURCE_ID]) {
    if (map.getSource(sourceId)) continue;
    map.addSource(sourceId, {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: RELIEF_ATTRIBUTION,
    });
  }

  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    const layers = map.getStyle().layers ?? [];
    // Above the ground fill, below the first line or label the basemap draws.
    const firstAbove = layers.find(
      (layer) => layer.type === "line" || layer.type === "symbol",
    )?.id;
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: "hillshade",
        source: SHADE_SOURCE_ID,
        paint: {
          "hillshade-exaggeration": 0.62,
          "hillshade-shadow-color": palette.shadeShadow,
          "hillshade-highlight-color": palette.shadeHighlight,
          "hillshade-accent-color": palette.shadeAccent,
          "hillshade-illumination-anchor": "viewport",
          "hillshade-illumination-direction": 315,
        },
      },
      firstAbove,
    );
  }
}

/**
 * A horizon.
 *
 * Pitching a map without one produces a tilted plan, not a landscape: the
 * ground simply stops at a hard edge against nothing. A warm sky and a ground
 * haze give the far distance somewhere to go, which is the difference between
 * looking at terrain and being in it. Values are the notebook's own paper and
 * ink, so the horizon belongs to this product rather than to a weather app.
 */
export function applyReliefSky(map: MapLibreMap) {
  map.setSky({
    "sky-color": "#cfd9e2",
    "horizon-color": "#efe6d6",
    "fog-color": "#e8dfd0",
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.55,
    "fog-ground-blend": 0.02,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0, 8, 0.6, 12, 0.9],
  });
}

export function clearReliefSky(map: MapLibreMap) {
  map.setSky({ "atmosphere-blend": 0 });
}

/**
 * Restyle the live Liberty style for this direction.
 *
 * The moves are the journal's, with the landform added: push land and water
 * apart so the coastline is the strongest edge, quiet everything that does not
 * help recognise a place, and give water a second darker value so a pitched
 * horizon reads as distance rather than as a flat band.
 */
export function applyReliefCartography(map: MapLibreMap, palette = RELIEF_PALETTE) {
  const layers = map.getStyle().layers ?? [];

  setPaint(map, "background", "background-color", palette.land);

  /*
   * Named rather than pattern-matched, because the patterns missed things that
   * then shouted on the render: `airport` is its own symbol layer (a plane icon
   * and "Banff Airport" over a run up Sundance), the one-way arrows are symbols
   * too, and `natural_earth` is a low-resolution relief raster this direction
   * replaces with a real DEM.
   */
  for (const id of [
    "airport",
    "road_one_way_arrow",
    "road_one_way_arrow_opposite",
    "natural_earth",
    "road_area_pattern",
    "landuse_track",
  ]) {
    hide(map, id);
  }

  for (const layer of layers) {
    const id = layer.id;

    if (/^(poi|building|.*oneway|.*shield|boundary|aeroway)/.test(id)) {
      hide(map, id);
      continue;
    }

    /* Railways are not something she ran. */
    if (/_rail(_hatching)?$/.test(id)) {
      hide(map, id);
      continue;
    }

    if (/^landcover_wetland$/.test(id)) {
      setPaint(map, id, "fill-color", palette.grass);
      continue;
    }

    if (/^water/.test(id) && layer.type === "fill") {
      setPaint(map, id, "fill-color", palette.water);
      continue;
    }
    if (/^water/.test(id) && layer.type === "line") {
      setPaint(map, id, "line-color", palette.waterDeep);
      continue;
    }
    if (/^waterway/.test(id)) {
      setPaint(map, id, "line-color", palette.water);
      continue;
    }

    if (/^landcover_wood|^landuse_wood|forest/.test(id)) {
      setPaint(map, id, "fill-color", palette.wood);
      continue;
    }
    if (/^landcover_grass|^park|^landuse_park/.test(id)) {
      setPaint(map, id, "fill-color", palette.grass);
      continue;
    }
    if (/sand|beach|glacier|ice/.test(id)) {
      setPaint(map, id, "fill-color", palette.sand);
      continue;
    }
    if (/^landuse_residential|^landuse$|urban/.test(id)) {
      setPaint(map, id, "fill-color", palette.settlement);
      continue;
    }
    if (/^landuse_(hospital|school|university|stadium|pitch|cemetery)/.test(id)) {
      hide(map, id);
      continue;
    }

    if (layer.type === "line" && /^(highway|road|tunnel|bridge)/.test(id)) {
      const major = /motorway|trunk|primary/.test(id);
      setPaint(map, id, "line-color", major ? palette.roadMajor : palette.road);
      continue;
    }

    if (layer.type === "symbol") {
      setPaint(map, id, "text-color", /place_(city|country|state)/.test(id) ? palette.ink : palette.inkSoft);
      setPaint(map, id, "text-halo-color", palette.halo);
      setPaint(map, id, "text-halo-width", 1.6);
    }
  }
}
