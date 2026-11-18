// What kind of building a footprint is, and which are landmarks: from what
// the open map data says, nothing more. OpenMapTiles carries no building
// type or roof tags, so type comes from the land a footprint stands in
// (land use) and from places of worship (points) inside it.

import type { RegionId } from "@/labs/sketch/sketch-region";

type P = [number, number];

export type Form = "house" | "block" | "mansion" | "tower" | "shed" | "institution" | "retail";
export type Landmark = "temple" | "shrine" | "church";

const INSTITUTIONS = ["school", "university", "college", "hospital", "kindergarten"];

export function buildingForm({ areaM2, height, rectangularity, region, landuse }: { areaM2: number; height: number; rectangularity: number; region: RegionId; landuse: string | undefined }): Form {
  if (height <= 30) {
    if (landuse === "industrial" && height <= 15 && areaM2 >= 300) return "shed";
    if (landuse && INSTITUTIONS.includes(landuse) && areaM2 >= 300) return "institution";
    if (landuse === "retail" && areaM2 >= 800 && height <= 15) return "retail";
  }
  if (height > 30) return "tower";
  if (height > 10) return region === "japan" ? "mansion" : "block";
  return areaM2 <= 400 && rectangularity >= 0.8 ? "house" : "block";
}

export function landmarkKind(subclass: string): Landmark | null {
  return subclass === "buddhist" ? "temple" : subclass === "shinto" ? "shrine" : subclass === "christian" ? "church" : null;
}

export function pointInRing(x: number, y: number, ring: readonly P[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Footprints with a place of worship inside: building index to landmark. A point in no footprint is skipped. */
export function matchLandmarks(buildings: readonly { rings: P[][] }[], pois: readonly { x: number; y: number; subclass: string }[]) {
  const found = new Map<number, Landmark>();
  const wanted = pois.flatMap((poi) => {
    const kind = landmarkKind(poi.subclass);
    return kind ? [{ ...poi, kind }] : [];
  });
  if (!wanted.length) return found;
  // The points by cell, so each footprint looks only at those near it.
  const CELL = 128;
  const cells = new Map<number, typeof wanted>();
  const cellKey = (cx: number, cy: number) => cx * 65536 + cy;
  for (const poi of wanted) {
    const k = cellKey(Math.floor(poi.x / CELL), Math.floor(poi.y / CELL));
    cells.set(k, [...(cells.get(k) ?? []), poi]);
  }
  buildings.forEach((building, index) => {
    const ring = building.rings[0];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx += 1)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy += 1)
        for (const poi of cells.get(cellKey(cx, cy)) ?? [])
          if (!found.has(index) && poi.x >= x0 && poi.x <= x1 && poi.y >= y0 && poi.y <= y1 && pointInRing(poi.x, poi.y, ring)) found.set(index, poi.kind);
  });
  return found;
}

/** Gates within 40 m of a shrine stand as torii, their beam across the way to it. */
export function toriiFrom(gates: readonly { x: number; y: number }[], shrines: readonly { x: number; y: number }[], metresPerUnit: number) {
  const reach = 40 / metresPerUnit;
  return gates.flatMap((gate) => {
    let best: { x: number; y: number } | null = null;
    let bestD = reach;
    for (const shrine of shrines) {
      const d = Math.hypot(shrine.x - gate.x, shrine.y - gate.y);
      if (d <= bestD) [best, bestD] = [shrine, d];
    }
    if (!best) return [];
    // The beam is perpendicular to the approach.
    return [{ x: gate.x, y: gate.y, angle: Math.atan2(best.y - gate.y, best.x - gate.x) + Math.PI / 2 }];
  });
}
