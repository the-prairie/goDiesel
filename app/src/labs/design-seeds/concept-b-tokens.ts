import type { PaddingOptions } from "maplibre-gl";

import type { CartographyPalette } from "@/labs/design-seeds/seed-cartography";

/**
 * Concept B's colour is a swappable theme; everything else is not.
 *
 * The token names below are CSS custom properties, so every existing inline
 * style keeps working untouched and a theme change is a single class on the
 * wrapper. Layout, typography, spacing, content, camera framing and
 * interactions are identical across themes by construction - only the values
 * behind these variables differ, which is what makes the comparison a colour
 * comparison.
 */
export const JOURNAL = {
  IVORY: "var(--seed-paper)",
  PLATE_FIELD: "var(--seed-field)",
  INK: "var(--seed-ink)",
  INK_2: "var(--seed-ink-2)",
  INK_3: "var(--seed-ink-3)",
  RULE: "var(--seed-rule)",
  /** Actions and playback. */
  FOREST: "var(--seed-action)",
  /** Elevation and route data. */
  COBALT: "var(--seed-data)",
  /** The selected route. A graphical colour, so it answers to 3:1. */
  CORAL: "var(--seed-route)",
  /** The same meaning carried as TEXT, which must answer to 4.5:1. */
  CORAL_TEXT: "var(--seed-route-text)",
} as const;

/** Translucent and incidental values, also themed. */
export const JOURNAL_SURFACES = {
  PAPER_VEIL: "var(--seed-paper-veil)",
  RULE_SOFT: "var(--seed-rule-soft)",
  MINIATURE: "var(--seed-miniature)",
  DATA_BAND: "var(--seed-data-band)",
  PLATE_HIGHLIGHT: "var(--seed-plate-highlight)",
} as const;

/**
 * The Atlas plate's framing. The day opens on this and eases to its own, so
 * the recorded line hands over instead of jumping.
 */
export const PLATE_PADDING: PaddingOptions = { top: 64, right: 56, bottom: 64, left: 56 };

export type SeedThemeId = "journal" | "expedition";

export interface SeedTheme {
  id: SeedThemeId;
  label: string;
  /** One-line statement of what the palette is trying to be. */
  premise: string;
  className: string;
  /** Real colour values, because MapLibre cannot read CSS variables. */
  cartography: CartographyPalette;
}

/**
 * A. Field journal - the current, selected direction.
 */
const JOURNAL_CARTOGRAPHY: CartographyPalette = {
  /*
   * The page is warm paper; the ground is not.
   *
   * The first warm pass tinted everything parchment, including the map's land,
   * and the coastline measured 2.22:1 against water - below the 3:1 a graphical
   * boundary needs. On a product about geographic instruments the most
   * important edge on the map did not separate.
   *
   * So the land steps back to a quiet warm limestone and the landscape supplies
   * the colour: deep teal-ink water, olive scrub, warm rock. Teal is
   * terracotta's complement, which keeps the map in the same family as the
   * interface instead of turning it cool. Measured against #f2f0ea land:
   * water 5.14:1, route 4.26:1, history 4.71:1.
   */
  land: "#f2f0ea",
  water: "#476a74",
  waterEdge: "#3d5f69",
  wood: "rgba(134,148,104,0.34)",
  grass: "rgba(158,166,120,0.2)",
  sand: "rgba(214,196,158,0.55)",
  road: "#e2dccd",
  roadMajor: "#d3cab5",
  ink: "#3b352c",
  inkSoft: "#645c4d",
  halo: "rgba(242,240,234,0.94)",
  route: "#c34a24",
  routeCasing: "#faf7f0",
  routeHistory: "#2f6bb8",
  settlement: "rgba(216,204,180,0.34)",
};

/**
 * B. Contemporary expedition atlas - the challenger.
 *
 * Chalk reading surfaces, mineral-grey supporting surfaces, basalt type, deeper
 * water for a harder coastline, and one controlled warm accent that only ever
 * means "the selected route". No parchment cast anywhere: the warm notes are
 * spent entirely on the route and on sand.
 */
const EXPEDITION_CARTOGRAPHY: CartographyPalette = {
  /*
   * Land is lighter than the mineral field it sits in, so the map reads as a
   * sheet of chalk inset into grey rather than dissolving into the page.
   * First pass had land at #f2f4f4 against a #eaeeef field and the boundary
   * went soft; vegetation at 0.26 alpha also read as grey haze rather than
   * ground cover, which cost real terrain legibility.
   */
  land: "#f5f7f7",
  water: "#5f7f91",
  waterEdge: "#4e6d7e",
  wood: "rgba(104,138,121,0.32)",
  grass: "rgba(126,156,140,0.19)",
  sand: "rgba(214,203,176,0.5)",
  road: "#dfe3e4",
  roadMajor: "#cbd2d4",
  ink: "#2b3237",
  inkSoft: "#59636a",
  halo: "rgba(245,247,247,0.95)",
  route: "#d1481c",
  routeCasing: "#f7f8f8",
  routeHistory: "#2472ad",
  /* Cool mineral, not tan. Tokyo showed the inherited warm value as beige
     blocks - the one place the parchment cast survived. */
  settlement: "rgba(196,205,208,0.42)",
};

export const SEED_THEMES: Record<SeedThemeId, SeedTheme> = {
  journal: {
    id: "journal",
    label: "Field journal",
    premise: "Warm paper, ink and terracotta. A notebook you carried.",
    className: "seed-theme-journal",
    cartography: JOURNAL_CARTOGRAPHY,
  },
  expedition: {
    id: "expedition",
    label: "Expedition atlas",
    premise: "Chalk daylight, mineral grey, basalt type, deep water, one warm accent.",
    className: "seed-theme-expedition",
    cartography: EXPEDITION_CARTOGRAPHY,
  },
};

export function resolveSeedTheme(value: string | null | undefined): SeedTheme {
  return value === "expedition" ? SEED_THEMES.expedition : SEED_THEMES.journal;
}

export type SeedTypefaceId = "cormorant" | "source-serif" | "role";

export interface SeedTypeface {
  id: SeedTypefaceId;
  label: string;
  /** Empty for the control, which is the stylesheet default. */
  className: string;
  note: string;
}

/**
 * Editorial typeface comparison. Only --font-editorial differs; every size,
 * weight, leading, tracking and label treatment is shared.
 */
export const SEED_TYPEFACES: Record<SeedTypefaceId, SeedTypeface> = {
  cormorant: {
    id: "cormorant",
    label: "Cormorant Garamond",
    className: "",
    note: "Review variant. Cormorant throughout, including note prose.",
  },
  "source-serif": {
    id: "source-serif",
    label: "Source Serif 4",
    className: "seed-type-source-serif",
    note: "Review variant. Source Serif 4 throughout, including titles.",
  },
  role: {
    id: "role",
    label: "Journal (Cormorant titles, Source Serif prose)",
    className: "seed-type-role",
    note: "Default. Cormorant titles and journal entries, Source Serif 4 note prose, Inter controls and measurements.",
  },
};

/**
 * The journal presentation's default is the role split: Cormorant for titles
 * and journal entries, Source Serif 4 for note and description prose, Inter
 * for controls and measurements.
 *
 * The single-family variants stay reachable by `?type=` for review. There is
 * deliberately no user-facing switch: this is one product with one
 * presentation, not a themable one.
 */
export function resolveSeedTypeface(value: string | null | undefined): SeedTypeface {
  if (value === "cormorant") return SEED_TYPEFACES.cormorant;
  if (value === "source-serif") return SEED_TYPEFACES["source-serif"];
  return SEED_TYPEFACES.role;
}
