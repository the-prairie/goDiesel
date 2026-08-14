# goDiesel Field-Guide Design Contract

This document is the visual and interaction source of truth for goDiesel.

The governing rule is:

> Terrain is the canvas, route data is the annotation, and interface chrome behaves like an editorial field guide.

## Product Surfaces

| Surface | Routes | Workspace | Primary purpose |
| --- | --- | --- | --- |
| Spatial atlas | Atlas | Full-bleed Cesium world with compact navigation and route carousel | Remember and revisit |
| Planning map | Finder | Full-height terrain with controls and inspector | Plan |
| Editorial route | Route detail | Chapter-led field story with recorded geography | Understand one route |
| Immersive | Replay and approved replay labs | Full-bleed terrain with one control dock | Relive one route |
| Utility | Routes and Admin | Dense content workspace | Compare or curate |

The surface type determines the shell.

It does not change canonical URLs or route data semantics.

## Semantic Color

### Mineral structure

- `canvas` is the application background.
- `surface` is used for panels, sheets, and controls.
- `surface-raised` is used when a control must separate from another surface.
- `surface-muted` provides quiet grouping.
- `surface-map-glass` is the only translucent panel treatment allowed over maps.
- `ink`, `ink-secondary`, and `ink-muted` establish the reading hierarchy.
- `line` and `line-strong` establish boundaries without decorative framing.

### Product meaning

- Forest communicates actions, active navigation, and playback controls.
- Cobalt communicates routes, route history, and elevation data.
- Coral communicates the selected Atlas route, a singular current position, waypoint, or active map point.
- Success and warning colors communicate status only.

Runs and rides share cobalt.

Activity type is communicated with an icon and label rather than a route color.

## Typography

Inter Variable is the interface typeface.

It is used for navigation, metrics, filters, controls, forms, captions, and status messages.

Cormorant Garamond is the editorial typeface.

It is reserved for place names, route titles, and short editorial premises.

Place names use medium weight, uppercase text, and `0.16em` tracking.

Route titles use title case and `0.01em` tracking.

Editorial typography must never be used for operational labels or form controls.

## Geometry

- Desktop sidebar: `166px`.
- Immersive and tablet rail: `64px`.
- Desktop inspector: `320px`.
- Desktop map-edge inset: `18px`.
- Mobile edge inset: `16px`.
- Standard control: at least `44px` high.
- Mobile control: `48px` high.
- Control and panel radius: `6px`.
- Mobile sheet top radius: `22px`.
- Mobile navigation: `82px` plus the safe-area inset.

Panels use one-pixel borders and restrained shadows.

Cards must not be nested inside other cards.

## Cartography

- Historical routes use a `2px` cobalt line at `42%` opacity without waypoint markers.
- Selected routes use a `4px` cobalt line with a `2px` pale halo outside Atlas.
- The selected Atlas route uses a `4px` coral line with a restrained pale halo.
- Replay routes use a `5px` cobalt line.
- Automatic cinematic replay may replace the baseline route with a layered filament: a restrained coral travelled thread, pale future guide, and narrow white focus glint. The treatment must remain terrain-seated and visually lighter than the baseline replay route.
- Waypoints use a `28px` coral circle, `2px` white border, and a white numeric label.
- Current replay position uses an `18px` coral point with a `3px` white ring.
- Region labels use editorial uppercase type between `28px` and `36px` with `0.22em` tracking.
- Only selected or editorially featured routes receive coral markers.

## Shell Behavior

### Desktop

At `1024px` and wider, the desktop sidebar is fixed at the left edge except on Atlas and Route detail.

Atlas uses compact navigation over a full-width world and does not reserve permanent sidebar space.

Route detail uses its own compact story header over a full-width editorial canvas.

Map and immersive surfaces do not use a global top header.

Routes and Admin may use a compact toolbar inside their content workspace.

### Tablet

Between `768px` and `1023px`, navigation becomes a `64px` icon rail.

Inspectors become overlays.

### Mobile

Below `768px`, primary navigation is a fixed five-destination bottom bar.

There is no primary-navigation hamburger.

Map details use bottom sheets and content pages reserve bottom-nav clearance.

Replay keeps navigation visible and places its compact dock above it.

All interactive controls remain at least `44px` square and respect safe-area insets.

## Inspection

Finder region detail uses a collapsible `320px` inspector.

Route detail is a vertically scrolling field story.

It leads with a source-backed route photograph when one exists, uses an evidence-labelled chapter rail, and places the real map, elevation profile, and factual guide inside a recorded-geography section.

Replay is a deliberate transition from the story and must preserve a return path to that route.

Atlas region selection uses a centered route carousel over the world rather than a permanent inspector.

Mobile route detail remains a continuous story page with its chapter rail below the compact route header.

The mobile navigation remains visible, and the map and factual guide stack within the story without horizontal overflow.

Editorial imagery is optional and must be source-backed.

When no source-backed image exists, geography remains the primary visual.

## Shared Components

| Component | Role |
| --- | --- |
| `AppShell` | Selects map, editorial, immersive, or utility workspace behavior |
| `DesktopSidebar` | Primary desktop navigation and identity |
| `MobileNavigation` | Persistent primary mobile navigation |
| `MapViewport` | Owns map or terrain framing |
| `MapSearch` | Surface-specific search intent |
| `MapUtilityBar` | Supported map actions only |
| `MapModeControl` | Runs, Rides, and All on Atlas surfaces |
| `RouteTraceLayer` | Historical and selected route annotation |
| `WaypointLayer` | Intentional coral map points |
| `AtlasGlobe` | Sole Cesium owner for the global and regional Atlas world |
| `AtlasImmersiveNavigation` | Compact Atlas navigation and memory/planning mode switch |
| `RegionRouteCarousel` | Source-backed routes for the selected Atlas region |
| `RouteInspector` | Route metrics, narrative, and actions |
| `MobileRouteSheet` | Mobile map inspection |
| `RouteEditorialHeader` | Route identity and short premise |
| `RouteProfile` | Compact cobalt elevation profile |
| `VibeAttributes` | Semantic route-experience attributes |
| `FinderFilterBar` | Persistent planning filters |
| `FinderResultList` | Source-backed planning candidates |
| `ReplayHUD` | Compact route and playback context |
| `ReplayChapterRail` | Optional desktop replay context |
| `PlaybackDock` | The single owner of playback state |

## Required States

Interactive primitives provide visible default, hover, focus, active, disabled, loading, success, warning, and error behavior where relevant.

Focus indicators must remain visible against both mineral surfaces and map imagery.

Body text and controls must meet WCAG AA contrast.

Loading states must reserve stable dimensions.

Reduced-motion preferences disable decorative motion without hiding state changes.

## Atlas Spatial Treatment

Atlas is the only product surface with a dark, full-bleed spatial treatment.

Its production world is Cesium, with bundled Natural Earth imagery for the global view and source-backed photorealistic regional tiles when available.

Actual recorded route geometry is always the primary annotation.

Global route threads use cobalt, the selected route uses coral, and route density comes from the recorded traces rather than oversized place markers.

Selecting a region moves the same world camera into place and opens the centered route carousel.

If regional 3D imagery is unavailable, Atlas keeps the selection and navigation state and uses the source-backed MapLibre regional fallback.

This exception does not establish a global dark theme and must not be copied to Finder, Routes, Admin, or route detail.

## Required And Illustrative Decisions

Color meanings, typography roles, minimum target sizes, responsive breakpoints, shell selection, cartographic line and marker rules, inspector behavior, accessibility states, and source-truth constraints are required product behavior.

The design-system fixture's sample place, route premise, route geometry, status copy, control arrangement, and terrain texture are illustrative examples only.

Migrated product surfaces may compose the required primitives differently when their workflow demands it.

Illustrative fixture content must not be treated as route data, editorial source material, or a reusable page template.

## Prohibited Patterns

- Do not use neon route colors.
- Do not assume a global dark theme.
- Do not use generic floating introduction cards over the primary experience.
- Do not use decorative route-preview grids when real geography is available.
- Do not use a mobile hamburger for primary navigation.
- Do not use coral for general actions or decoration.
- Do not invent route imagery or editorial claims.
- Do not expose map controls without real behavior.
- Do not place cards inside cards.

## Migration Rule

The field-guide theme is additive during migration.

Existing surfaces remain on compatibility roles until their dedicated migration ticket lands.

Legacy aliases are removed only after every migrated surface has passed behavioral, responsive, accessibility, and visual verification.
