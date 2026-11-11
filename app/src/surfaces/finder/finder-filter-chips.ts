import type { FinderIntent } from "@/domain/planning";

export type FinderFilterChipKey = "place" | "terrain" | "vibe" | "query";

export interface FinderFilterChip {
  key: FinderFilterChipKey;
  label: string;
  aria: string;
  /** Only Finder's own vocabulary (terrain) is title-cased; the person's words are shown as typed. */
  capitalize: boolean;
}

export function activeFilterChips(intent: FinderIntent): FinderFilterChip[] {
  const chips: FinderFilterChip[] = [
    { key: "query", label: intent.query && intent.query !== intent.place ? intent.query : "", aria: "Clear experience search", capitalize: false },
    { key: "place", label: intent.place, aria: "Clear location filter", capitalize: false },
    { key: "terrain", label: intent.terrain !== "any" ? intent.terrain : "", aria: "Remove terrain filter", capitalize: true },
    { key: "vibe", label: intent.vibe, aria: "Remove vibe filter", capitalize: false },
  ];
  return chips.filter((chip) => chip.label);
}
