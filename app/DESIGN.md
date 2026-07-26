# goDiesel Weathered Atlas Design Contract

This document is the visual and interaction source of truth for goDiesel.

The governing rule is:

> Terrain is the paper, routes are ink that ages with you, and the interface is the binding of a personal atlas.

## Core Metaphor

goDiesel is a **Weathered Atlas**. Movement leaves ink on mineral paper. Repeated travel wears the stroke deeper. Forgotten routes fade toward the paper tone. GPS gaps and pauses are repaired in gold (kintsugi), never hidden. Planned routes remain pencil until lived.

Three wabi-sabi pillars map to product jobs:

- **Impermanence** → Atlas (memory fades unless revisited)
- **Imperfection** → Replay (honest retracing, seams included)
- **Incompleteness** → Finder (empty regions are invitation, not missing data)

## Product Surfaces

| Surface | Routes | Workspace | Primary purpose |
| --- | --- | --- | --- |
| Atlas | Atlas | Full-height terrain with spine and margin | Remember |
| Leaf | Route detail | Geography with margin annotations | Understand one route |
| Retrace | Replay and approved replay labs | Full-bleed terrain with single-stroke dock | Relive |
| Empty Page | Finder | Paper workspace with pencil candidates | Plan |
| Ledger | Routes and Admin | Dense ruled content | Compare or curate |

The surface type determines the shell.

It does not change canonical URLs or route data semantics.

## Semantic Color

### Mineral paper

- `canvas` / `paper` is the application background (cool mineral washi, not warm cream).
- `surface` is used for panels, sheets, and controls.
- `surface-raised` is used when a control must separate from another surface.
- `surface-muted` provides quiet grouping.
- `paper-lifted` lifts unexplored Finder regions.
- `ink`, `ink-secondary`, `ink-muted`, and `ink-faded` establish reading hierarchy and route fade floors.
- `line` and `line-strong` establish boundaries without decorative framing.

### Pigment meaning

- **Moss** (`forest` token) communicates actions, active navigation, and playback controls.
- **Indigo** (`route` token) communicates routes, route history, route selection, and elevation data.
- **Vermilion** (`coral` token) communicates a singular current position, waypoint, playhead, or active map point.
- **Gold** (`gold-repair`) communicates kintsugi seams only — never decoration.
- **Graphite** communicates pencil / planned / unconfirmed geometry.
- Success and warning colors communicate status only.

Runs and rides share indigo.

Activity type is communicated with an icon and label rather than a route color.

## Typography

Inter Variable is the interface typeface.

It is used for navigation, metrics, filters, controls, forms, captions, and status messages.

Metrics use tabular figures at weight 450 when available.

Cormorant Garamond is the editorial typeface.

It is reserved for place names, route titles, short editorial premises, and **marginalia** (annotations in Cormorant italic).

Place names use medium weight, uppercase text, and `0.16em` tracking.

Route titles use title case and `0.01em` tracking.

Editorial typography must never be used for operational labels or form controls.

## Geometry

- Desktop spine: `166px`.
- Immersive and tablet spine rail: `64px`.
- Desktop margin: `320px` (never more than one-third of the page).
- Desktop map-edge inset: `18px`.
- Mobile edge inset: `16px`.
- Standard control: at least `44px` high.
- Mobile control: `48px` high.
- Control and panel radius: `3px` (paper corners, not pills).
- Mobile margin fold top curve: soft asymmetric radius ~`22px`.
- Mobile spine: `82px` plus the safe-area inset.

Panels use one-pixel borders and paper-soft shadows only.

Cards must not be nested inside other cards.

Spacing uses deliberate asymmetry (`ma`): prefer uneven section gaps (32 / 40 / 56) over uniform grids.

## Cartography

### Patina traces

- Historical routes use indigo ink whose **wear** (repetition) deepens and slightly widens the stroke, and whose **fade** (time since last travel) desaturates toward paper, floored at a legible minimum.
- Selected routes use a `4px` indigo line with a `2px` pale halo.
- Replay routes use a `5px` indigo line that re-inks in travel direction.
- Planned routes use graphite pencil strokes until lived.
- Waypoints use a `28px` vermilion circle, `2px` white border, and a white numeric label.
- Current replay position uses an `18px` vermilion point with a `3px` white ring.
- Region labels use editorial uppercase type between `28px` and `36px` with `0.22em` tracking.
- Only selected or editorially featured routes receive vermilion markers.
- Kintsugi seams render as thin gold repairs with enlarged invisible hit targets (≥ `44px`).

### Neon ban

Do not use neon route colors. Globe heat accents must stay within indigo, moss, vermilion, and gold.

## Shell Behavior

### Desktop (≥ `1024px`)

Primary navigation is a fixed left **spine** (journal binding).

Map, Leaf, and Retrace surfaces do not use a global top header.

Ledger and Empty Page may use a compact toolbar inside their content workspace.

### Tablet (`768px`–`1023px`)

Navigation becomes a `64px` icon spine rail.

Margins become overlays that still share the page (map remains visible).

### Mobile (`< 768px`)

Primary navigation is a fixed five-destination **bottom spine**.

There is no primary-navigation hamburger.

Map details use the **margin fold** (three stops). Content pages reserve bottom-spine clearance.

Replay keeps the spine visible and places its compact dock above it.

All interactive controls remain at least `44px` square and respect safe-area insets.

## Inspection — The Margin

Desktop route and region detail uses a collapsible `320px` **margin** (marginalia, not a card stack).

Mobile route detail uses a three-position fold with `180px`, `52vh`, and `88vh` stops.

The map remains visible in peek and half states.

Content settles with staggered `settle` motion. Annotations may use Cormorant italic.

Editorial imagery is optional and must be source-backed.

When no source-backed image exists, geography remains the primary visual.

## Motion

Three verbs only:

- **settle** — arrive with soft decelerating ease, `250–400ms`, ~`4px` travel, no bounce.
- **breathe** — attention response: slow opacity/weight swell, `600ms+`.
- **draw** — ink and pencil animate in travel direction, never whole-fade.

Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (settle) and `cubic-bezier(0.2, 0, 0, 1)` (interface).

`prefers-reduced-motion` collapses draw to instant-with-direction-cue and disables breathing. State changes remain visible.

## Shared Components

| Component | Role |
| --- | --- |
| `AppShell` | Selects atlas, leaf, retrace, empty-page, or ledger workspace behavior |
| `AtlasSpine` | Primary navigation as journal binding (desktop rail + mobile bottom) |
| `MapViewport` | Owns map or terrain framing |
| `MapSearch` | Surface-specific search intent |
| `MapUtilityBar` | Supported map actions only |
| `MapModeControl` | Runs, Rides, and All on Atlas surfaces |
| `RouteTraceLayer` | Patina / historical and selected route annotation |
| `WaypointLayer` | Intentional vermilion map points |
| `Margin` | Shared detail system (desktop column + mobile fold) |
| `RegionMargin` | Region totals and compact route list in the margin |
| `RouteMargin` | Route metrics, narrative, seams, and actions |
| `RouteEditorialHeader` | Route identity and short premise |
| `RouteProfile` | Compact indigo elevation profile (also Retrace scrubber geometry) |
| `VibeAttributes` | Semantic route-experience attributes |
| `FinderFilterBar` | Plain-language planning filters |
| `FinderResultList` | Source-backed pencil candidates |
| `ReplayHUD` | Compact route and playback context |
| `ReplayChapterRail` | Optional desktop replay context |
| `PlaybackDock` | The single owner of playback state |

## Required States

Interactive primitives provide visible default, hover, focus, active, disabled, loading, success, warning, and error behavior where relevant.

Focus indicators must remain visible against both mineral surfaces and map imagery.

Body text and controls must meet WCAG AA contrast.

Loading states must reserve stable dimensions.

Reduced-motion preferences disable decorative motion without hiding state changes.

## Required And Illustrative Decisions

Color meanings, typography roles, minimum target sizes, responsive breakpoints, shell selection, cartographic line and marker rules, margin behavior, accessibility states, and source-truth constraints are required product behavior.

The design-system fixture's sample place, route premise, route geometry, status copy, control arrangement, and terrain texture are illustrative examples only.

Migrated product surfaces may compose the required primitives differently when their workflow demands it.

Illustrative fixture content must not be treated as route data, editorial source material, or a reusable page template.

## Prohibited Patterns

- Do not use neon route colors.
- Do not assume a global dark theme.
- Do not use generic floating introduction cards over the primary experience.
- Do not use decorative route-preview grids when real geography is available.
- Do not use a mobile hamburger for primary navigation.
- Do not use vermilion for general actions or decoration.
- Do not use gold except for kintsugi seams.
- Do not invent route imagery or editorial claims.
- Do not expose map controls without real behavior.
- Do not place cards inside cards.
- Do not use bounce, spring, or idle-loop motion.

## Migration Rule

The Weathered Atlas theme ships through the existing `field-guide-theme` class during migration so surfaces can adopt progressively.

Existing surfaces remain on compatibility roles until their dedicated migration ticket lands.

Legacy aliases (`forest`, `route`, `coral`) remain the CSS token names; pigment names (moss, indigo, vermilion) are the design vocabulary.

Legacy aliases are removed only after every migrated surface has passed behavioral, responsive, accessibility, and visual verification.
