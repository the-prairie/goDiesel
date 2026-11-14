import type { Map as MapLibreMap, Marker } from "maplibre-gl";

import type { CatalogEntry, Placement } from "@/labs/sketch/moment-catalog";

type MapLibreModule = { Marker: new (options: { element: HTMLElement; anchor: "bottom" }) => Marker };

/**
 * Each placed moment as a button on its building front: a small shop
 * window, the one thing in colour and moving in the ink city (its flicker is
 * CSS, so nothing runs per frame). Shown from city zoom in.
 */
export function plantMoments(map: MapLibreMap, maplibregl: MapLibreModule, shown: { placement: Placement; entry: CatalogEntry }[], open: (placement: Placement, entry: CatalogEntry, button: HTMLElement) => void) {
  const markers = shown.map(({ placement, entry }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sketch-moment";
    button.dataset.momentId = placement.id;
    button.setAttribute("aria-label", `${entry.title}, a planted moment`);
    button.innerHTML = '<span class="sketch-moment-window"></span>';
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      open(placement, entry, button);
    });
    return new maplibregl.Marker({ element: button, anchor: "bottom" }).setLngLat([placement.at.lng, placement.at.lat]).addTo(map);
  });
  const show = () => {
    for (const marker of markers) marker.getElement().hidden = map.getZoom() < 10;
  };
  show();
  map.on("zoomend", show);
  return () => {
    map.off("zoomend", show);
    for (const marker of markers) marker.remove();
  };
}
