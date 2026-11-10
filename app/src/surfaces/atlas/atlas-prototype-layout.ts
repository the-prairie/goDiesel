export const ATLAS_PROTOTYPE_LAYOUTS = ["a", "b", "c"] as const;

export type AtlasPrototypeLayout = (typeof ATLAS_PROTOTYPE_LAYOUTS)[number];

export type AtlasSheetDetent = "closed" | "peek" | "medium" | "large";

export type AtlasSheetEvent = "expand" | "collapse" | "cycle" | "dismiss";

const OPEN_DETENTS = ["peek", "medium", "large"] as const satisfies readonly AtlasSheetDetent[];

export function readAtlasPrototypeLayout(
  params: URLSearchParams,
): AtlasPrototypeLayout | null {
  const value = params.get("atlasLayout");
  if (value === "a" || value === "b" || value === "c") return value;
  return null;
}

export function atlasSheetOpens(
  layout: AtlasPrototypeLayout,
  hasRegion: boolean,
  hasRoute: boolean,
): boolean {
  if (!hasRegion) return false;
  if (layout === "b") return hasRoute;
  return true;
}

export function reduceAtlasSheet(
  detent: AtlasSheetDetent,
  event: AtlasSheetEvent,
): AtlasSheetDetent {
  if (event === "dismiss") return "closed";
  if (event === "cycle") {
    if (detent === "closed") return "peek";
    const index = OPEN_DETENTS.indexOf(detent);
    return OPEN_DETENTS[(index + 1) % OPEN_DETENTS.length];
  }
  if (event === "expand") {
    if (detent === "closed" || detent === "peek") return detent === "closed" ? "peek" : "medium";
    if (detent === "medium") return "large";
    return "large";
  }
  if (detent === "large") return "medium";
  if (detent === "medium") return "peek";
  return "closed";
}
