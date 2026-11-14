// Planted moments: experiences she put into the drawn world. A catalog of
// what she has made (each a kind of scene and its clip), and placements: a
// real building front in the world showing one catalog entry. Her own
// catalog and placements are private and live with her clips in the
// gitignored public/moments/ folder; this committed example (one "no
// signal" entry, placed beside route 064) stands in wherever they are not.

export type MomentKind = "tv-wall";

export interface CatalogEntry {
  id: string;
  kind: MomentKind;
  /** For her own reference; also the moment's accessible name. */
  title: string;
  /** Her clip, by URL only; null for none (the screens show no signal). */
  clip: string | null;
  caption?: string;
  /** Hers to clear for the live site: only public entries, their clips and places are built into it. */
  public?: boolean;
}

export interface Placement {
  id: string;
  /** The catalog entry showing here, or null for an empty place. */
  entryId: string | null;
  /** The middle of the building's street front. */
  at: { lng: number; lat: number };
  /** Which way the front faces, degrees clockwise from north. */
  facingDeg: number;
}

export interface MomentsData {
  catalog: CatalogEntry[];
  placements: Placement[];
}

export const EXAMPLE_MOMENTS: MomentsData = {
  catalog: [{ id: "no-signal", kind: "tv-wall", title: "No signal (example)", clip: null }],
  // A street-facing shop 370 m along route 064, inside her explored corridor in Kyoto.
  placements: [{ id: "route-064-shop", entryId: "no-signal", at: { lng: 135.769891, lat: 34.995784 }, facingDeg: 185 }],
};

/** Her private data when it is whole, the example otherwise. */
export function chooseMoments(data: MomentsData | null | undefined): MomentsData {
  return data && Array.isArray(data.catalog) && Array.isArray(data.placements) ? data : EXAMPLE_MOMENTS;
}

/** What stands in the world: each place with an entry that exists. */
export function shownMoments(data: MomentsData) {
  return data.placements.flatMap((placement) => {
    const entry = data.catalog.find((candidate) => candidate.id === placement.entryId);
    return entry ? [{ placement, entry }] : [];
  });
}

export const placementsOf = (data: MomentsData, entryId: string) => data.placements.filter((p) => p.entryId === entryId);
export const placeMoment = (data: MomentsData, placement: Placement): MomentsData => ({ ...data, placements: [...data.placements, placement] });
export const swapPlacement = (data: MomentsData, placementId: string, entryId: string | null): MomentsData => ({
  ...data,
  placements: data.placements.map((p) => (p.id === placementId ? { ...p, entryId } : p)),
});
export const emptyPlacement = (data: MomentsData, placementId: string) => swapPlacement(data, placementId, null);
export const unplaceEntry = (data: MomentsData, entryId: string): MomentsData => ({ ...data, placements: data.placements.filter((p) => p.entryId !== entryId) });

/** Standing in the street a few metres out from the front, looking at it, low and close. */
export function approachCamera({ at, facingDeg }: Pick<Placement, "at" | "facingDeg">) {
  const out = 8;
  const rad = (facingDeg * Math.PI) / 180;
  const lat = at.lat + (Math.cos(rad) * out) / 111_320;
  const lng = at.lng + (Math.sin(rad) * out) / (111_320 * Math.cos((at.lat * Math.PI) / 180));
  return { center: [lng, lat] as [number, number], zoom: 18.7, pitch: 70, bearing: (facingDeg + 180) % 360 };
}

/** Save-Data or a reduced-data preference: clips wait to be asked for. */
export function momentDataSaving() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData) || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-data: reduce)").matches);
}
