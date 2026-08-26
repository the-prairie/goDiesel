# Production runtime architecture map

## Boot and code splitting

```text
index.html
  → app/main.tsx
  → App
  → hash router
  → AppShell (eager shared navigation/chrome)
  → lazy surface module
```

Every product surface is lazy. Atlas is the default destination, so a normal startup quickly loads the Atlas page, the shared route-summary chunk, and then the separately lazy Cesium globe implementation. Replay and route detail have explicit lazy-chunk assertions in the bundle gate.

## Route data flow

```text
private source files + quests.json
  → build.py (single canonical writer, atomic publication)
  → app/src/data/generated/routes.manifest.json
       → bundled shared route-summary chunk
       → lenient parseRouteSummary
       → routes / completedRoutes / discoveredRoutes
  → app/public/data/routes/<slug>.json
       → fetch only on selection
       → strict parseRouteDetail
       → cached Promise per slug
```

The manifest contains every summary and 96-point trace. The detail repository deduplicates concurrent requests and retains ready/not-found/invalid results; transient network errors are evicted so they can be retried.

## Atlas flow

```text
AtlasPage
  → completedRoutes
  → buildRouteRegions (module-level current data; pure function for other inputs)
  → AtlasGlobe (lazy wrapper)
  → CesiumAtlasGlobe
  → CesiumAtlasWorldEngine
```

`CesiumAtlasWorldEngine` creates one `Viewer`, one Cesium entity per drawable route, and one polyline per entity. Global routes use the summary trace. Selecting a region hides unrelated entities, recomputes regional positions for matching routes, frames a bounding sphere, and optionally loads Google Photorealistic 3D Tiles. Failure switches to a MapLibre regional surface.

Region labels are ordinary DOM buttons. `CesiumAtlasGlobe` polls projected region positions every 80 ms, maps projections by region name, computes label collision visibility, and mutates button styles.

The current Viewer uses continuous rendering (`requestRenderMode: false`) and retains the drawing buffer. These are implementation details to profile, not pre-approved changes.

## Atlas selection and search

Atlas selection is represented in URL search parameters and repaired by pure selection helpers. Search currently filters regions and completed routes in memory on each normalized query. Region and route counts are small in the current corpus but must be measured at synthetic scale.

## Finder flow

```text
Finder intent in URL
  → curatedRouteDiscoveryProvider.search
  → filter four curated candidate objects
  → select first/current candidate
  → lazy-load selected detail for map
  → optional browser-local planned route
```

The current matching algorithm normalizes strings during each search and checks place, activity, distance tolerance, terrain membership, and every requested vibe token. It is exact and intentionally narrow; the scalability harness may use synthetic copies of the same candidate contract without changing product scope.

## Routes flow

```text
bundled summaries + browser-local plans
  → derive filter options
  → parse/canonicalize URL filters
  → filterRoutes over full library
  → reveal first page(s)
  → RouteCard summaries only
  → detail fetch after route selection
```

The page memoizes option lists based on library identity, but `filterRoutes` runs on every render. Result order follows input order. Twenty-four results are revealed per page; the library does not fetch route details to filter or list.

## Route detail flow

```text
summary lookup by slug
  → useRouteDetail
  → deduplicated per-slug fetch
  → strict detail parse
  → map, guide, annotations, Replay affordance
```

A malformed detail becomes an intentional unavailable state. Returning to Routes or Atlas preserves originating state.

## Replay flow

```text
ReplayPage
  → summary lookup / representative route selection
  → strict detail fetch
  → GoogleRouteNavigatorStage (default)
      → GoogleRouteNavigatorEngine
      → RouteSceneManifest cached in WeakMap by route object
      → controller animation frames
      → scene frame / camera / telemetry resolution
  OR explicit Cesium / MapLibre engine
```

Playback controllers advance normalized progress and resolve route/camera state repeatedly. `routePathPose` currently finds the first point at or above progress with a linear `findIndex`. Scene construction caches a manifest per route object, but frame resolution still performs repeated path/telemetry work. This is a profiling hypothesis, not yet a retained optimization.

Each engine owns imperative resources and a `destroy()` path. The browser gauntlet measures active WebGL contexts and settled heap across repeated Atlas ↔ Replay transitions.

## Existing performance protections

- one initial JavaScript entry below 500 KiB;
- Cesium/Google photorealistic markers forbidden in that entry;
- exactly one lazy Replay chunk and route-detail chunk;
- summary/detail split;
- lazy Cesium Atlas globe;
- route-detail request deduplication;
- browser tests for renderer release, lazy detail loading, and visible layout behavior.

## Unprofiled candidate hotspots

These are hypotheses only until the baseline profiles are committed:

1. Continuous Cesium rendering and retained drawing buffer in the global Atlas.
2. One Entity/ConstantProperty/material object graph per route.
3. Region-label projection and collision polling every 80 ms regardless of camera activity.
4. Linear `routePathPose` lookup during playback and cinematic frame generation.
5. Repeated string normalization and scans in Finder/Atlas search at synthetic scale.
6. Repeated full-library filtering and option derivation as route counts grow.
7. Large bundled JSON parse/object allocation on first route-aware surface.
8. Renderer and listener retention across repeated surface transitions.

The opportunity matrix must rank these only after CPU, allocation, network, React, and memory evidence exists.
