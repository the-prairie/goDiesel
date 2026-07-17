---
title: "feat: Establish the goDiesel field-guide design system"
type: feat
date: 2026-07-16
status: proposed
---

# Field-Guide Design System Plan

## Summary

Redesign goDiesel around one product rule:

> Terrain is the canvas, route data is the annotation, and interface chrome behaves like an editorial field guide.

The redesign replaces the current dark black-and-green shell with a daylight cartographic system built from mineral neutrals, forest actions, cobalt route traces, coral position markers, restrained geometry, and editorial place typography.

This is not a visual rewrite of every page at once.

The work begins by establishing a stable token and shell foundation, proves that foundation on Atlas, then migrates route detail, Replay, Finder, Routes, and Admin in descending order of product importance.

The existing route data, Three.js globe, Cesium Replay, Playable Earth lab, avatar system, URL model, and application behavior remain intact unless a ticket explicitly changes them.

## Product Outcome

The redesigned product should feel like one coherent route atlas across four surface types:

1. **Map workspace:** Atlas and Finder use terrain as the primary workspace.
2. **Editorial route view:** Route detail explains one experience without hiding its geography.
3. **Immersive route view:** Replay keeps terrain full bleed and consolidates controls.
4. **Utility workspace:** Routes and Admin use a quieter content layout built from the same design language.

The user should always understand:

- where they are in the product;
- whether they are remembering, planning, browsing, replaying, or editing;
- which route or region is selected;
- how to move to the next relevant surface;
- what information belongs to the map and what belongs to an inspector or sheet.

## Current-State Findings

The current application has strong behavioral foundations but its design system no longer matches the product direction.

### Shell

- The global 56px top header consumes space on every surface, including immersive maps.
- Desktop navigation is structurally sound but styled for the old dark system.
- Mobile navigation is still a sidebar sheet and hamburger rather than persistent bottom navigation.
- Atlas, Replay, content pages, and Admin all inherit nearly the same shell despite requiring different workspace behavior.

### Visual Language

- The application is globally dark with neon green carrying brand, selection, action, and route meaning.
- Route traces use multiple colors by activity and replay quality, conflicting with the proposed cobalt cartographic language.
- Typography is a single interface sans with generic heading treatment.
- Large floating dark panels and broad shadows compete with the globe and terrain.
- The existing semantic shadcn tokens are useful, but the token values and role definitions need replacement.

### Atlas

- Atlas already has the correct behavioral ingredients: full globe, route traces, search, region selection, and route inspector.
- Intro, search, controls, and inspector currently compete as separate overlays.
- Region labels and route lines need a clear cartographic hierarchy.
- The inspector is a compact list rather than an editorial route selector.

### Route Detail

- Route detail is currently a conventional document page.
- Route identity, metrics, route trace, elevation profile, and curation are separated into stacked sections and cards.
- The route preview is abstract SVG geometry over a decorative grid rather than real terrain.
- Route guidance is semantically strong and should be recomposed, not discarded.

### Replay

- Replay already owns a full-bleed terrain experience and should not be rebuilt.
- Route context and playback controls remain visually heavy and use multiple floating panels.
- The desktop HUD needs one playback dock and an optional chapter rail.
- Mobile controls need a compact playback card and expandable tool sheet.

### Finder, Routes, and Admin

- Finder has a valid planning model but is form-first rather than map-first.
- Routes is a capable searchable library and should remain a content surface.
- Admin is a capable owner workflow and should remain a dense utility surface.
- Finder and Atlas must not collapse into one ambiguous search model.

## Design Principles

### 1. Terrain First

Maps and 3D terrain occupy the full available workspace on Atlas, Finder, route detail, and Replay.

Chrome floats only when it supports an immediate map task.

### 2. One Semantic Color Per Meaning

- Forest: actions, active navigation, and playback controls.
- Cobalt: routes, route history, selection traces, and elevation data.
- Coral: current position, selected waypoint, or singular active point.
- Mineral neutrals: application structure and readable editorial chrome.

Activity type is communicated by icons and labels, not route color.

### 3. Editorial Identity, Familiar Controls

Place names and route titles may use the editorial typeface.

Navigation, data, controls, filters, forms, and status messages remain in the interface typeface.

Standard product affordances remain familiar.

### 4. Inspect Rather Than Obscure

Desktop details use a collapsible right inspector.

Mobile details use a three-position bottom sheet.

The map remains visible whenever the user is comparing or orienting.

### 5. Surface-Specific Density

- Atlas and Finder are spacious map workspaces.
- Route detail is editorial and image-led.
- Replay minimizes chrome during motion.
- Routes and Admin prioritize scanning and repeated action.

## Design-System Source Of Truth

Create `app/DESIGN.md` from the normative design specification and treat it as the design contract.

Implement tokens in `app/src/index.css` using semantic aliases rather than embedding raw colors in components.

### Foundation Tokens

The source-of-truth roles are:

- canvas, surface, raised surface, muted surface, and map glass;
- primary ink, secondary ink, muted ink;
- default and strong dividing lines;
- forest action states;
- cobalt route states;
- coral active-position states;
- success and warning states;
- panel and bottom-sheet shadows;
- interface and editorial typography;
- shell, inspector, control, spacing, radius, and safe-area dimensions;
- semantic z-index levels.

Existing shadcn tokens such as `background`, `foreground`, `card`, `primary`, `muted`, `border`, `ring`, and sidebar roles should map onto these named product roles.

Components should consume semantic roles rather than `#hex`, arbitrary Tailwind colors, or old dark-theme assumptions.

## Application Shell Model

### Desktop, 1024px And Wider

- Fixed 166px sidebar.
- Optional 64px collapsed rail for immersive surfaces.
- No global top header on map or Replay surfaces.
- Routes and Admin may use a compact page toolbar inside the content workspace.
- Map surfaces fill all space between sidebar and inspector.
- Inspector width is 320px.

### Tablet, 768px To 1023px

- 64px icon rail.
- Inspectors become overlays.
- Search and map utilities remain independently reachable.
- Content surfaces retain a constrained readable column.

### Mobile, Below 768px

- No sidebar or hamburger for primary navigation.
- Fixed bottom navigation with Atlas, Finder, Routes, Replay, and Admin.
- Navigation height includes the safe-area inset.
- Map surfaces use bottom sheets.
- Content pages reserve bottom padding for navigation.
- Replay uses its own compact dock above navigation and keeps an explicit exit path.

## Core Components

### Foundation

- `AppShell`
- `DesktopSidebar`
- `MobileNavigation`
- `PageToolbar`
- `MapWorkspace`
- `ContentWorkspace`

### Cartography

- `MapViewport`
- `MapSearch`
- `MapUtilityBar`
- `MapModeControl`
- `RouteTraceLayer`
- `WaypointLayer`
- `CurrentPositionMarker`
- `RegionLabelLayer`

### Inspection

- `InspectorFrame`
- `RegionInspector`
- `RouteInspector`
- `MobileRouteSheet`
- `InspectorCollapseTab`

### Editorial Route Presentation

- `RouteEditorialHeader`
- `RouteProfile`
- `VibeAttributes`
- `RouteHighlights`
- `RouteCaveats`

### Finder

- `FinderSearch`
- `FinderFilterBar`
- `FinderFilterChips`
- `FinderResultList`
- `FinderMatchReason`

### Replay

- `ReplayHUD`
- `ReplayChapterRail`
- `PlaybackDock`
- `ReplayToolSheet`

## Implementation Sequence

## D0. Capture The Design Contract

**Goal:** Establish the specification as a repository-owned source of truth before visual implementation.

**Changes:**

- Add `app/DESIGN.md`.
- Record the color, typography, geometry, cartography, shell, inspector, route, Finder, Replay, and responsive rules.
- Document the four surface types and which shell each route uses.
- Add a short component usage table and semantic color rules.
- Document prohibited legacy patterns: neon route colors, global dark theme assumptions, generic floating intro cards, route preview grids, and mobile hamburger navigation.

**Acceptance:**

- Every proposed component and semantic color has one documented role.
- Atlas, Finder, route detail, Replay, Routes, and Admin each map to one shell type.
- The contract distinguishes required behavior from illustrative styling.

## D1. Expand The Token Foundation

**Goal:** Make the target visual language available beside the current theme so each surface can migrate while the application remains green.

**Changes:**

- Add the mineral, forest, cobalt, and coral product roles without deleting legacy roles.
- Add typography tokens and locally bundled font assets.
- Add geometry, safe-area, z-index, timing, and easing tokens.
- Map shadcn semantic variables onto product roles.
- Standardize focus, disabled, loading, success, warning, and error states.
- Update Button, Input, Sheet, Sidebar, Tooltip, Separator, and Skeleton primitives.
- Add visual token and primitive test fixtures.
- Keep compatibility aliases until every product surface has migrated and the final contract gate can remove them safely.

**Primary files:**

- `app/src/index.css`
- `app/src/components/ui/*`
- `app/DESIGN.md`

**Acceptance:**

- Body and control contrast meet WCAG AA.
- Every primitive has default, hover, focus, active, disabled, and loading behavior where relevant.
- No raw product colors remain in shared UI primitives.
- Reduced-motion behavior is defined centrally.
- Existing surfaces remain functional while migrated and legacy roles coexist.

## D2. Build The Responsive Shell

**Goal:** Give every product surface the correct workspace before redesigning individual pages.

**Changes:**

- Split `AppShell` into map, immersive, and content workspace variants.
- Remove the global top header from Atlas, Finder, route detail, and Replay.
- Implement the 166px desktop sidebar and 64px tablet/immersive rail.
- Implement fixed mobile bottom navigation.
- Preserve all existing canonical URLs, active states, back/forward behavior, and direct links.
- Add content insets for bottom navigation and safe areas.
- Keep primary mobile navigation visible during Replay and reserve clearance for the compact playback dock.

**Primary files:**

- `app/src/components/app-shell.tsx`
- `app/src/components/app-sidebar.tsx`
- `app/src/components/mobile-navigation.tsx`
- `app/src/navigation.ts`
- `app/src/router.tsx`

**Acceptance:**

- All five destinations remain reachable at desktop, tablet, and mobile widths.
- No hamburger is required for primary mobile navigation.
- Navigation never overlaps Replay controls, bottom sheets, forms, or route content.
- Map surfaces gain the full height previously consumed by the global header.
- Existing navigation E2E remains green and gains mobile bottom-navigation coverage.

## D3. Prove The System On Atlas

**Goal:** Use Atlas as the reference implementation for the field-guide language.

**Changes:**

- Restyle the globe for daylight/mineral chrome without replacing Three.js or route data.
- Convert all completed route traces to cobalt with density expressed through opacity and line accumulation.
- Reserve coral for the selected region or featured route point.
- Replace the intro panel with compact product identity integrated into search.
- Implement `MapSearch`, a `MapUtilityBar` containing only controls with real behavior, and Runs/Rides/All `MapModeControl`.
- Rebuild `RegionInspector` on the shared inspector frame.
- Add an activity icon, metrics, and vibe per route.
- Add editorial imagery only when a source-backed image exists; otherwise preserve the map as the primary visual.
- Implement inspector collapse and restore.
- Implement the mobile three-position route sheet.
- Refine label collision, globe occlusion, pointer, wheel, touch, keyboard, and focus behavior.

**Primary files:**

- `app/src/pages/atlas-page.tsx`
- `app/src/components/globe/atlas-globe.tsx`
- `app/src/components/globe/atlas-controls.tsx`
- `app/src/components/globe/region-inspector.tsx`
- `app/src/components/search/atlas-search.tsx`

**Acceptance:**

- Terrain/globe is the dominant first-viewport signal.
- Historical traces are cobalt and legible without giant density markers.
- Search, utilities, mode control, and inspector do not overlap at supported viewport sizes.
- Selecting a region updates URL, globe emphasis, and inspector.
- Mobile users can retain map context at peek and half sheet positions.
- Canvas-pixel and interaction E2E pass across desktop, tablet, portrait mobile, and short landscape.

## D4. Recompose Route Detail Around Real Geography

**Goal:** Let the user understand the experience before entering Replay.

**Changes:**

- Replace the stacked document layout with a map-first route workspace.
- Place route identity and one-sentence premise over the map.
- Move metrics, vibe, terrain, highlights, caveats, seasonality, and actions into `RouteInspector`.
- Replace the abstract grid trace with a real map or terrain route preview.
- Render the selected route as a 4px cobalt line with pale halo.
- Use coral only for intentional waypoints.
- Rebuild the elevation view as a compact cobalt area profile.
- Replace unexplained difficulty language with semantic attributes.
- Use the mobile route sheet for all route detail.
- Keep Replay as the primary action when eligible.

**Primary files:**

- `app/src/pages/route-detail-page.tsx`
- `app/src/components/routes/route-briefing.tsx`
- `app/src/components/routes/route-guide.tsx`
- new route map and inspector components

**Acceptance:**

- Route, terrain, and editorial premise are visible without scrolling on desktop.
- Mobile peek state preserves both route identity and map context.
- Missing geometry, draft curation, and unavailable Replay remain intentional states.
- Route details remain directly addressable and retain return-to-library behavior.

## D5. Consolidate Replay Chrome

**Goal:** Preserve the working immersive engine while making Replay quieter and clearer.

**Changes:**

- Keep Cesium, Atlas fallback, avatar synchronization, route selection, and camera behavior unchanged.
- Replace current context panel and controls with `ReplayHUD` and one `PlaybackDock`.
- Add a collapsible desktop chapter/context rail.
- Implement mobile compact playback card and expandable tool sheet.
- Apply forest to playback actions, cobalt to route, and coral to current position.
- Add inactivity fade for nonessential chrome, with immediate return on pointer movement, keyboard focus, or tap.
- Preserve visible escape paths to route detail and Routes.
- Move experimental links out of the primary control hierarchy.

**Primary files:**

- `app/src/components/replay/earth-replay-stage.tsx`
- `app/src/components/replay/replay-route-picker.tsx`
- replay engine styling hooks only where necessary

**Acceptance:**

- One dock owns playback state.
- Route context never obscures the avatar or current path.
- All controls remain at least 44px.
- Fade behavior respects focus and reduced motion.
- Existing deterministic, live terrain, avatar, mobile, and five-minute Replay tests remain green.

## D6. Evolve Finder Into A Planning Workspace

**Goal:** Make Finder the place to ask what kind of day to have, without confusing it with Atlas history search.

**Changes:**

- Preserve the existing explicit, source-backed discovery model.
- Move Finder into a map workspace when result geometry is available.
- Use “What kind of day do you want?” as the primary search prompt.
- Convert activity, distance, terrain, and vibe controls into persistent Finder filters.
- Use desktop filter toolbar and mobile removable chips.
- Add match explanations to every result.
- Keep unsupported and no-match states explicit.
- Ensure route detail does not inherit Finder controls.

**Primary files:**

- `app/src/pages/finder-page.tsx`
- `app/src/components/finder/finder-form.tsx`
- `app/src/components/finder/candidate-route.tsx`
- new Finder map/filter components

**Acceptance:**

- Atlas and Finder use visibly different search language and state.
- Every result explains why it matches.
- Planned routes remain separate from completed Atlas totals.
- Filters persist through route comparison and browser navigation.
- Mobile filters remain usable without covering the map or result sheet.

## D7. Align Routes And Admin

**Goal:** Bring utility surfaces into the same system without making them decorative map pages.

Routes and Admin are independent delivery slices and may proceed in parallel after the responsive shell is complete.

**Routes changes:**

- Retain searchable, filterable library behavior.
- Replace card-heavy presentation with a denser editorial list or mixed list/grid suited to route comparison.
- Use one image, route title, activity icon, distance, climb, lifecycle, and vibe.
- Standardize filter toolbar and mobile chips.
- Preserve result count, progressive loading, URL filters, return scroll, and empty states.

**Admin changes:**

- Retain the two-pane owner workflow.
- Apply the mineral utility workspace and standardized fields.
- Improve route-list density, selection clarity, save status, validation, and sticky action placement.
- Keep read-only and editable states unmistakable.
- Do not use editorial typography inside forms or operational labels.

**Acceptance:**

- Routes remains faster to scan than route detail.
- Admin remains denser and more operational than the consumer surfaces.
- Existing filter, pagination, curation, and save E2E remains green.
- Mobile utility layouts remain navigable above the bottom bar.

## D8. Contract Legacy Styling And Lock Design QA

**Goal:** Remove migration-only compatibility styling and prevent the completed system from drifting.

**Changes:**

- Remove legacy dark-theme aliases and obsolete surface-specific chrome after every migration ticket is complete.
- Confirm no migrated component depends on retired raw colors, typography, spacing, or shell assumptions.
- Add screenshot fixtures for shell, Atlas, route detail, Replay, Finder, Routes, and Admin.
- Cover 1440x1000, 1024x768, 768x900, 430x844, 390x844, 667x375, and 320x568 where relevant.
- Add canvas-pixel assertions for Atlas, map previews, and Replay.
- Add automated overlap, overflow, touch-target, contrast, and focus-order checks.
- Add font-loading and reduced-motion checks.
- Add a design QA checklist tied to `app/DESIGN.md`.
- Require focused screenshot and interaction evidence in every migration ticket rather than postponing visual review until this gate.

**Acceptance:**

- No text or controls overlap at supported viewports.
- No horizontal document overflow.
- Map and 3D canvases are nonblank and correctly framed.
- Bottom navigation, sheets, inspectors, and Replay dock maintain clearance.
- All existing behavioral E2E remains green.
- No legacy theme compatibility alias remains in active product code.
- Each migrated surface has human visual approval recorded before this contract ticket begins.

## Recommended Delivery Gates

### Gate 1: Foundation

- D0 Design contract
- D1 Token foundation
- D2 Responsive shell

Do not begin page redesign until navigation, typography, colors, primitives, and breakpoints are stable.

### Gate 2: Reference Experience

- D3 Atlas

Atlas becomes the visual reference and validates the system against the hardest responsive map surface.

### Gate 3: Core Route Loop

- D4 Route detail
- D5 Replay

This completes the memory-to-understanding-to-replay journey.

### Gate 4: Planning And Library

- D6 Finder
- D7 Routes and Admin

This completes future planning and owner curation without destabilizing the core route loop.

### Gate 5: Release Quality

- D8 Legacy styling contract and cross-surface design QA

## Work Boundaries

The redesign must not:

- replace the current route data model;
- change canonical URLs;
- rewrite Three.js globe interaction without a proven defect;
- rewrite Cesium Replay or Playable Earth;
- merge Atlas history search with Finder planning;
- add public submissions, social features, travel booking, or Strava OAuth;
- invent route imagery or editorial claims when source data is unavailable;
- make Routes or Admin map-first solely for visual consistency.

## Test Strategy

Every implementation ticket should include:

- unit tests for new pure state or geometry logic;
- type checking and production build;
- existing route/navigation regression tests;
- desktop and mobile Playwright interaction coverage;
- screenshot attachments for changed UI states;
- canvas-pixel checks for map and 3D work;
- reduced-motion and keyboard focus verification;
- explicit loading, empty, error, unavailable, and long-content states.

## First Implementation Slice

Begin with D0 and D1 only:

1. Add `app/DESIGN.md`.
2. Implement the semantic token foundation in `app/src/index.css`.
3. Update shared shadcn primitives.
4. Build a local design-system fixture route or Storybook-equivalent test page that does not ship in primary navigation.
5. Verify contrast, typography loading, controls, states, and mobile sizing.

Do not redesign Atlas in the same pull request.

The next pull request should implement D2, then the third should make Atlas the first complete migrated surface.
