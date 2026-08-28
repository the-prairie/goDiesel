# Atlas shared-ground-geometry optimization

**Production baseline:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Control harness:** `5475bc8be88ed44a47d93461227e9cfa04b3f071`
**Optimized commit:** `cdb05994d15a4b559f3552d59aa0163aff21c2c6`
**Lever:** globally batch shared source geometry into a ground-clamped primitive, retain at most two glow passes for coincident traces, and create ordinary per-route Entities only for the selected region.

## Outcome

At 2,500 independently owned source-backed routes, the optimization reduced median settled heap by 57.03% on desktop and 57.61% on mobile.
Median route-ready action latency improved 55.20% on desktop and 54.33% on mobile.
Median peak observed heap fell 42.55% on desktop and 35.58% on mobile.
Median full sample wall time fell 74.80% on desktop and 78.15% on mobile.

| Project | Metric | Before median | After median | Improvement |
| --- | --- | ---: | ---: | ---: |
| Desktop Chromium | Route-ready latency | 15,898.80 ms | 7,121.97 ms | 55.20% |
| Desktop Chromium | Settled heap | 93.57 MB | 40.21 MB | 57.03% |
| Desktop Chromium | Peak heap | 98.74 MB | 56.73 MB | 42.55% |
| Desktop Chromium | Sample wall time | 54,346.68 ms | 13,697.92 ms | 74.80% |
| Mobile Chromium | Route-ready latency | 12,344.11 ms | 5,637.00 ms | 54.33% |
| Mobile Chromium | Settled heap | 93.76 MB | 39.74 MB | 57.61% |
| Mobile Chromium | Peak heap | 114.82 MB | 73.96 MB | 35.58% |
| Mobile Chromium | Sample wall time | 47,864.96 ms | 10,459.32 ms | 78.15% |

## Visual acceptance

The acceptance limits were committed before the hardened distributions were collected.
The reference repetition captures the WebGL canvas directly at global, east, and west camera positions on desktop and mobile.
The route oracle isolates pixels near the established `#62a7ff` route color, rejects the cobalt-tinted globe rim by requiring map imagery three pixels away in every cardinal direction, and records a 48 by 24 occupancy grid.
Each camera must retain a route-pixel ratio from 0.80 through 1.20, occupied-cell Jaccard overlap of at least 0.80, and more than 100 route pixels.
Every timed repetition also requires more than 100 global route pixels before its action window closes.

All six camera comparisons passed.
Occupied-cell Jaccard was 1.00 in every comparison.
Route-pixel ratios ranged from 0.9486 through 0.9631.

## Behavioral equivalence

The global renderer uses Cesium's stable `GroundPolylinePrimitive`, `GroundPolylineGeometry`, and original glow material with terrain and 3D Tiles classification.
Identical sampled traces share one Cartesian array and render at most twice so repeated routes retain the established glow without unbounded geometry growth.
Selecting a region still swaps to ordinary ground-clamped per-route Entities, preserving route picking and selected-route styling.
Partial regional Entity creation rolls back staged Entities and restores the global primitive atomically.
Atlas cannot report ready until its global ground primitive is ready.

## Environment

Both distributions ran on macOS 25.6.0, Apple M1 Pro with 10 CPUs and 16 GiB memory, Node v26.7.0, Chromium 149.0.7827.55, and Cesium 1.143.0.
Each side contains five desktop and five mobile browser contexts.
Every raw report records its exact clean Git head and an empty worktree status.

## Verification

- `npm run verify:ticket` passed: typecheck, production build, 245 unit tests, and 4 navigation tests.
- `npx playwright test e2e/atlas-cesium.spec.ts` passed 19 tests.
- `npx playwright test e2e/atlas.spec.ts` passed 38 production-Cesium tests.
- The final control distribution passed 10 tests in 16.1 minutes.
- The final optimized distribution passed 10 tests in 3.8 minutes.
- `GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live` was not run because neither checkout has a configured Google Maps API key or provider preview URL.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-atlas-ready-before-5475bc8b GODIESEL_PERF_SOURCE_COMMIT=5475bc8be88ed44a47d93461227e9cfa04b3f071 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=baseline npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_RUN_ID=pr-atlas-ready-after-cdb05994 GODIESEL_PERF_SOURCE_COMMIT=cdb05994d15a4b559f3552d59aa0163aff21c2c6 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=measured npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ignored raw JSON and PNG artifacts remain local and are identified by byte size and SHA-256 in `evidence.json`.
