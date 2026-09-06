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
- The journal Replay presentation instead carries the selected route's terracotta
  identity across Atlas, route story and Replay. Because Replay is a dark
  surface, the hue is kept and the value lifted: `#c34a24` measures 2.27-3.15:1
  against the replay basemap's terrain range, below the 3:1 a line needs, while
  `#e2673c` measures 3.27-4.54:1 across the same range, with a warmed `#f2e4d2`
  casing. This is a named variant (`JOURNAL_REPLAY_THREAD_STYLE`), opted into by
  the journal presentation; surfaces outside that direction keep the shared
  cobalt default (`ROUTE_THREAD_STYLE`).
- Automatic cinematic replay may replace the baseline route with a layered filament: a restrained coral travelled thread, pale future guide, and narrow white focus glint. The treatment must remain terrain-seated and visually lighter than the baseline replay route.
- Waypoints use a `28px` coral circle, `2px` white border, and a white numeric label.
- Current replay position uses an `18px` coral point with a `3px` white ring.
- Region labels use editorial uppercase type between `28px` and `36px` with `0.22em` tracking.
- Only selected or editorially featured routes receive coral markers.

## Journal presentation (design-seed direction B)

Typography is role-based, not one family:

- Cormorant Garamond for titles and journal entries. Its narrower metrics fit
  long personal titles whole in the Atlas index where a wider serif truncated
  them, and its lighter caps keep an all-uppercase title engraved rather than
  shouted.
- Source Serif 4 for note and description prose only, through `--font-prose`.
  At the same 26px it has the larger x-height and lower stroke contrast, and its
  lining default figures match the tabular data figures below.
- Inter for controls and measurements, with tabular figures.

There is no user-facing typography or theme setting. Single-family variants are
reachable by `?type=` for review only.

Attribution never puts the owner's name to text she did not write. A curated
`vibe` is a description of the route whatever the lifecycle; only `description`
on one of her own recordings is her voice.

A day page has two compositions, chosen by what its content wants:

- The **reading column** for a page you settle into - a photograph to look at,
  or prose long enough to be a paragraph (past roughly two lines at the
  introduction's measure, currently 120 characters).
- The **compact introduction** for everything else: no note, or a note of a
  sentence or two. The introduction is a band the height of its own content -
  date, title, the note when there is one with its byline, and the recorded
  details read across in one line - and the geography takes the full width with
  the climb along its lower edge.

Both are primary. 57 of 68 routes have no note and none of those has a
photograph; of the 11 that do have a note, 9 are a single sentence. A
full-height column holding fourteen characters is the same reserved-empty
rectangle as a column holding nothing. The threshold is a property of the
composition, never a named route, and nothing is ever shortened to fit.

The absence itself stays in the small print beside the recording's other
caveats. It is never the emotional focus.

The two compositions share the header, type scale, rules, elevation strip,
Replay bar and unframed geography; only the reading area changes shape. The map
camera is framed for the pane it is given, not a nominal one - the full-width
sparse pane is height-bound where the tall column is width-bound.

Every surface has a narrow composition, picked by `useWideLayout` so only one
mounts and there is never a second MapLibre instance.

The narrow Atlas is for choosing a day, so the days get the screen. Its two
leaves stack inside one scroller below the header - region header, plate with
its framing control, caption, climb and action - and that geographic
introduction scrolls away, leaving the list the full viewport. It must not pin
the preview and give the list an inner scroller: that left about 153px, under
two rows.

On a phone a journal row is a link to its day, not a selector. Two panes can
afford select-then-read because choosing a row repaints the plate beside it;
stacked, the plate is above the fold you are browsing in, so selecting asked the
reader to scroll back up to an action that had left the screen.

The reading position is stored against whichever element the composition
scrolls, never the other way round.

A selection that arrives from the URL is scrolled into view; a selection the
reader clicked is not. Two rules, one distinction: where the change came from.

On a phone the day's Replay action is in flow beneath the climb, not pinned. A
fixed bar put the lower third of the elevation curve - playhead and readout
included - underneath itself during scrubbing. The geography and the climb are
one inspection unit and are brought into view together when scrubbing starts,
but only when they are not already both visible.

Replay headlines the day's own name, with place and date one step down.
Format that date in place rather than importing `formatRouteDate`: importing it
- from the `@/domain/route` barrel or from its own module - puts the HUD into
the entry's chunk group and takes lucide-react with it, moving the initial shell
from 235.9 KiB to 336.9 KiB and dissolving the per-icon chunks.
`route.name` is the generated region label, so headlining it read "Crete,
Greece" for a route she called "the final boss" - the same erasure the route
story and the Atlas index were corrected for. The rule is the one
`route-card.tsx` already uses. The journal cast restates `--route` so the
route accent on that dark surface matches the thread rather than the shared
cobalt.

Controls meet the application's agreed sizes - 44px minimum, 48px on mobile, on
both axes - through `.seed-control`. That is a stricter rule than the WCAG 2.5.8
24px floor and is checked separately by `npm run audit:journal-controls`.
Provider attribution is exempt: MapLibre's required credit is its own control
with inline text links, and padding it to 48px would put a band of chrome over
the geography on every surface.

The journal's return context is scoped and its own. The visible in-page return
link is a real URL, never a history gesture, so a directly opened day still
lands on the journal with its own route selected and visible. The reading
position is stored per journey - concept, region and presentation - restored
before paint, and never inherited by an unrelated journey.

The route is drawn as soon as the style is parsed, not when tiles finish, so on
a cold load the recorded line is on screen before the basemap. Do not guard that
work with `isStyleLoaded()`: it also requires every source cache to be loaded
and so stays false until `load`.

Four checks keep this honest, each needing a running server:

- `npm run perf:journal-paint` - ground, route and basemap-tile paint order
- `npm run verify:journal-return` - the visible link, Back/Forward, the Replay
  round trip, a directly opened day, and journey scoping
- `npm run verify:journal-replay` - playback actually advancing, pause holding,
  the journal thread on the dark surface, and the return through visible links
- `npm run verify:journal-mobile` - the five real content shapes at 390x844
- `npm run audit:journal-controls` - the agreed control sizes

## Exploration: the carried notebook (design-seed direction D)

Not the baseline. An ambitious reading of the same idea, alongside the accepted
journal presentation, at `/lab/design-seeds/d/*`. Recorded here because two of
its findings are worth keeping whatever happens to the direction.

Relief is available after all. The cartography note above is right that
Liberty's only relief source is unusable at these framings; it was wrong to
conclude that shaded relief was unavailable. Mapzen Terrain Tiles on the AWS
Open Data registry are public-domain terrarium DEMs served to z15, and give
real hillshade and real 3D terrain. Credit them in the attribution control.

A line draped on terrain waits for the DEM tiles under it. Measured: layers and
route geometry were in at 916ms, the same as the flat baseline, but the route
did not paint until ~1.7s because 21 elevation tiles were still arriving.
Applying `setTerrain` after the first idle keeps route-first ordering - the line
lands at ~900ms on the correct camera, then the ground rises to meet it. Nothing
may drape before that, including a `styledata` handler.

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
