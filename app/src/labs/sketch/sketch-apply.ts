// Moves a running map to a new sketch style in place: paint that differs is
// set, layers the new style adds or drops are added (in their place) or
// removed, and the reveal's data is updated. Unlike `setStyle`, nothing is
// reloaded and our custom edge layer, which no style lists, stays.

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export interface StyleTarget {
  getLayer(id: string): unknown;
  getPaintProperty(id: string, name: string): unknown;
  setPaintProperty(id: string, name: string, value: unknown): void;
  addLayer(layer: LayerSpecification, before?: string): void;
  removeLayer(id: string): void;
  setSourceData(id: string, data: unknown): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function applySketchStyle(map: StyleTarget, next: StyleSpecification, previous?: StyleSpecification) {
  const ids = new Set(next.layers.map((layer) => layer.id));
  for (const layer of previous?.layers ?? []) if (!ids.has(layer.id) && map.getLayer(layer.id)) map.removeLayer(layer.id);
  // Without the previous style, a reveal layer the new one lacks is still known by name.
  if (!previous && !ids.has("explored-wash") && map.getLayer("explored-wash")) map.removeLayer("explored-wash");
  next.layers.forEach((layer, index) => {
    if (!map.getLayer(layer.id)) {
      const before = next.layers.slice(index + 1).find((later) => map.getLayer(later.id));
      map.addLayer(layer, before?.id);
      return;
    }
    const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
    for (const [name, value] of Object.entries(paint)) if (!same(map.getPaintProperty(layer.id, name), value)) map.setPaintProperty(layer.id, name, value);
  });
  for (const [id, source] of Object.entries(next.sources)) if (source.type === "geojson") map.setSourceData(id, source.data);
}
