/**
 * Design-seed manifest.
 *
 * Produced by the seeded explorer script (scripts/design-seed-explore.mjs,
 * SCRIPT VERSION 1.0.0, SEED 20260904). The seed reproduces the AESTHETIC
 * selections only. Accessibility and product meaning are invariants and are
 * never randomised - see INVARIANTS below.
 *
 * This file is the reproducible design brief. The number alone is not.
 */

export const SEED_SCRIPT_VERSION = "1.0.0";
export const SEED = 20260904;

/** Identical for all three concepts. Never drawn from a pool. */
export const INVARIANTS = {
  contrast: "WCAG 2.2 AA - 4.5:1 body text, 3:1 UI and large text",
  targetDesktop: "44px minimum",
  targetMobile: "48px minimum",
  focus: "2px ring, >=3:1 against both panel surfaces and map imagery",
  reducedMotion: "decorative motion off; state changes and content preserved",
  routeHistoryColour: "cobalt",
  routeSelectedColour: "coral",
  actionColour: "forest",
  activityType: "icon + label, never colour alone",
  evidence: "recorded | derived | measured | hypothesis stays truthful - demoted, never deleted",
  personalTitles: "Lauren's original titles preserved verbatim, including emoji-only titles",
} as const;

export type ConceptId = "a" | "b" | "c" | "d";

export interface ConceptManifest {
  id: ConceptId;
  label: string;
  /** One sentence on what this direction believes. */
  premise: string;
  /** The two-or-more structural dimensions this direction changes. */
  structuralMoves: string[];
  /** Seeded aesthetic selections. */
  choices: Record<string, string>;
  /** Explicit departures from app/DESIGN.md. */
  deviations: string[];
}

export const CONCEPTS: Record<ConceptId, ConceptManifest> = {
  a: {
    id: "a",
    label: "Field Atlas",
    premise:
      "Geography is the page. Chrome is a printed margin on top of live terrain, and the region reads as a dated index of places you have moved through.",
    structuralMoves: [
      "Map/panel composition: the centred bottom carousel becomes a left editorial index column over full-bleed terrain.",
      "Information hierarchy: the place name moves out of the bottom band and becomes the largest element on the screen, set over its own geography.",
      "Navigation presentation: four control clusters collapse to one top margin rule plus the index.",
    ],
    choices: {
      typeScaleRatio: "1.200 minor third",
      placeNameTreatment: "Cormorant 600 uppercase 0.14em",
      chromeTone: "bone paper over live terrain",
      panelEdge: "1px hairline, no shadow",
      densityStep: "8px base / 4px half",
      mapTone: "openfreemap liberty, desaturated -18%",
      accentTemperature: "cool cobalt / warm coral (contract)",
      motionProfile: "camera ease 320ms, no element entrance",
      routeIndexForm: "dated edge index",
    },
    deviations: [
      "DESIGN.md specifies a centred route carousel for Atlas region selection. This replaces it with a left index column so eight routes are legible at once and each keeps its own title.",
      "Region label size exceeds the documented 28-36px band; the place name is the screen's primary element.",
    ],
  },
  b: {
    id: "b",
    label: "Expedition Journal",
    premise:
      "The memory is the page and the map is a plate bound into it. Lauren's own words are the headline; the region is a kicker above them.",
    structuralMoves: [
      "Map/panel composition: geography stops being full-bleed canvas and becomes an inset plate inside an editorial spread.",
      "Information sequence: personal title first, then date, then place, then numbers - inverting the current place-first order.",
      "Narrative/geography relationship: the region view becomes a chronological journal sequence rather than a spatial browse.",
    ],
    choices: {
      typeScaleRatio: "1.250 major third",
      placeNameTreatment: "Cormorant 600 title case, region as small caps kicker",
      chromeTone: "warm ivory, map as inset plate",
      panelEdge: "no border, plate keyline only",
      densityStep: "editorial 12px base / 6px half",
      mapTone: "openfreemap liberty, sepia-shifted",
      accentTemperature: "cool cobalt / warm coral (contract)",
      motionProfile: "page-turn 380ms, plate cross-fade 200ms",
      entrySequence: "personal title -> date -> place -> numbers",
    },
    deviations: [
      "DESIGN.md says terrain is the canvas. Here terrain is a plate inside an editorial page - the strongest departure of the three.",
      "Atlas is documented as the only dark full-bleed surface; this direction makes the Atlas region view light.",
      "Editorial type is used for route titles at display size, including emoji-only titles rendered as titles.",
    ],
  },
  c: {
    id: "c",
    label: "Precision Terrain",
    premise:
      "An instrument for reading ground you have covered. No cards, no panels - labelled traces on real terrain, and quiet readouts at the edges.",
    structuralMoves: [
      "Map/panel composition: the card list is removed entirely; routes are selected by their labelled traces on the map.",
      "Navigation presentation: all chrome collapses into one thin left instrument rail plus a corner readout cluster.",
      "Narrative/geography relationship: narrative is demoted to a measured cross-section shared identically by Atlas, story, and Replay.",
    ],
    choices: {
      typeScaleRatio: "1.125 major second",
      placeNameTreatment: "Cormorant 500 uppercase 0.22em, single use per screen",
      chromeTone: "graphite instrument rail over dark terrain",
      panelEdge: "no panels; rules and readouts only",
      densityStep: "8px base / 4px half",
      mapTone: "openfreemap fiord, contrast +12%",
      accentTemperature: "cool cobalt / warm coral (contract)",
      motionProfile: "no easing on readouts, 160ms camera",
      numeralTreatment: "tabular lining, 0.04em",
    },
    deviations: [
      "DESIGN.md reserves the dark full-bleed treatment for Atlas only. This direction extends dark terrain to the route story as well, so the instrument reads consistently.",
      "Removes the route carousel and the route inspector panel in favour of on-map labels and an edge readout.",
    ],
  },
  d: {
    id: "d",
    label: "The Carried Notebook",
    premise:
      "A notebook someone carried, whose geography you can enter. The landform is the surface; the page rests on it; the recorded line is the instrument you take hold of.",
    structuralMoves: [
      "The region is one modelled landform carrying every recorded day at once, not a list beside a plate of one route. Changing day flies the camera across the same terrain.",
      "Real relief. Mapzen Terrain Tiles (public domain, AWS Open Data) give hillshade and 3D terrain the basemap provider cannot; the camera is pitched so a ridge has a shape.",
      "The thread: the recorded line is a draggable control on the map, sharing one position with the climb ribbon and with the photographs pinned at their recorded distances. Entering Replay descends from the held point.",
    ],
    choices: {
      typeScaleRatio: "inherited from the accepted journal presentation",
      placeNameTreatment: "inherited",
      chromeTone: "notebook leaf over modelled terrain",
      panelEdge: "soft-edged leaf with directional shadow; no cards",
      densityStep: "inherited",
      mapTone: "openfreemap liberty, warm restyle, terrarium hillshade",
      accentTemperature: "inherited terracotta",
      motionProfile: "900ms camera between days, 1100ms descent",
      numeralTreatment: "inherited",
    },
    deviations: [
      "DESIGN.md records that shaded relief is unavailable at these framings from the basemap provider. That remains true of the provider; this direction adds a separate public-domain DEM and credits it.",
      "The map's own pan and zoom gestures are disabled here: the drag belongs to the recorded line, which also removes the scroll dead zone the baseline has over a map on a phone.",
    ],
  },
};

/** The fixed content used by every concept frame, so comparisons are honest. */
export const FIXTURE = {
  region: "Crete, Greece",
  /** No media, no curation, no description - the state 65 of 68 routes are in. */
  plainSlug: "14130782031",
  /** 233-character personal title. */
  longTitleSlug: "14080158961",
  /** The only route with real photographs and a reviewed guide. */
  mediaSlug: "17654151284",
  /** Imported geometry, not Lauren's memory. */
  discoveredSlug: "3519505225411091950",
} as const;

/**
 * Revisions applied to direction B after the rendered review.
 *
 * Recorded here because the manifest, not the seed number, is the brief. Each
 * entry states the observed defect and the change, so the decision is auditable.
 */
export const B_REVISIONS = [
  {
    defect:
      'The region leaf was headed "Eight days on the island" - a generated claim, and false: eight routes across seventeen calendar days, seven of them distinct.',
    change:
      "Headline is the region name. The line beneath states only recorded facts: route count, date range, total distance, and how it was covered.",
    kind: "data-honesty",
  },
  {
    defect:
      'The region aggregate read "170 km on foot". True for Crete, but Banff/Kananaskis and Victoria BC both mix runs and rides, so the copy would lie there.',
    change:
      "coverageLine() derives 'on foot' / 'by bike' / 'on foot and by bike' from the recorded activity types.",
    kind: "data-honesty",
  },
  {
    defect:
      "The run/ride distinction was dropped from every row, on a product that records both (5 rides across 68 routes).",
    change: "Every journal row states the activity type as a word before the numbers.",
    kind: "data-honesty",
  },
  {
    defect:
      'A discovered route showed its curated note under the heading "Your note" and offered "Fly this route again" - both assert an experience Lauren never had.',
    change:
      'guideAttribution() returns "About this route" for non-completed routes; replayActionLabel() drops "again" unless the route is a memory.',
    kind: "data-honesty",
  },
  {
    defect:
      "The muted caption colour failed WCAG AA at 3.33:1 on ivory, and coral numerals failed at 3.56:1.",
    change:
      "INK_3 darkened to #635e54; a separate CORAL_TEXT #9e3a1e is used wherever coral carries text. Route coral is unchanged - it is a graphical colour needing 3:1.",
    kind: "accessibility",
  },
  {
    defect:
      "Caption sizes ran to 8.5-10.5px; nav links were 44px tall but as narrow as 26px.",
    change: "11px caption floor; every nav target is at least 44x44.",
    kind: "accessibility",
  },
  {
    defect:
      "The required OpenFreeMap/OpenStreetMap attribution sat inside the plate over the recorded trace.",
    change: "Attribution moved to the plate's top-left, clear of the line.",
    kind: "compliance",
  },
  {
    defect:
      "The primary action used position:sticky, so on a tall story page it sat below the fold and was invisible on the first screen.",
    change: "Fixed bottom bar with reserved clearance, so Replay is always reachable.",
    kind: "usability",
  },
  {
    defect:
      "The 233-character title was set at 22px display serif and dominated its row and the plate caption.",
    change:
      "Titles over 64 characters step down to 17px and clamp to three lines; the plate caption clamps to two. Her capitals and wording are never altered.",
    kind: "typography",
  },
  {
    defect:
      "B could not answer 'where in the region have I not been' - the plate is a ~20km keyhole with no overview.",
    change:
      "A two-state framing control on the plate reframes the same real basemap between This route and Whole region. An SVG mini-locator was built and REJECTED first: without coastline data it rendered eight specks in a void, reproducing the exact failure this redesign set out to fix.",
    kind: "structural",
  },
] as const;

/** Known gaps carried into implementation, not solved by these revisions. */
export const B_OPEN_GAPS = [
  "No search or filtering. Production had 'Search this place' and All/Runs/Rides. At 68 routes across 30 places this is a findability regression and needs a plan before migration.",
  "Per-chapter recorded-vs-derived labels from production are not reproduced. Evidence is currently one quiet footnote; the chapter-level distinction still needs a home.",
  "Replay itself is not part of this exploration. The shared distance axis is designed for it but not yet wired to a playhead.",
  "The elevation profile has a total-climb datum but no y-axis or units.",
] as const;
