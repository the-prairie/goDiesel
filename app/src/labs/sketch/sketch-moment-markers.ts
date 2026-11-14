import type { Map as MapLibreMap } from "maplibre-gl";

import type { CatalogEntry, Placement } from "@/labs/sketch/moment-catalog";
import { hologramLayer } from "@/labs/sketch/moment-hologram";

/**
 * Each placed moment: a beacon from far that resolves into a hologram up
 * close (moment-hologram, drawn in WebGL), and over it an invisible 44 pt
 * button with the moment's name, for her tap and for assistive technology.
 * Shown from city zoom in.
 */
export function plantMoments(map: MapLibreMap, shown: { placement: Placement; entry: CatalogEntry }[], open: (placement: Placement, entry: CatalogEntry, button: HTMLElement) => void, reducedMotion = false) {
  const overlay = document.createElement("div");
  overlay.className = "sketch-moments";
  const container = map.getContainer();
  container.insertBefore(overlay, container.querySelector(".maplibregl-control-container"));
  const markers = shown.map(({ placement, entry }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sketch-moment";
    button.dataset.momentId = placement.id;
    button.setAttribute("aria-label", `${entry.title}, a planted moment`);
    button.style.transform = "translate(-999px, -999px)";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      open(placement, entry, button);
    });
    overlay.append(button);
    return { placement, kind: entry.kind, button };
  });
  // The drawn buildings know their roofs once their tiles are made.
  const edges = () => (map.getLayer("building-edges") as unknown as { implementation?: { roofUnder?: (lng: number, lat: number) => { top: number; west: number; east: number; south: number; north: number } | null } } | undefined)?.implementation;
  const layer = hologramLayer(markers, { reducedMotion, roofUnder: (lng, lat) => edges()?.roofUnder?.(lng, lat) ?? null });
  map.addLayer(layer);
  return () => {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    overlay.remove();
  };
}
