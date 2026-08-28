# Atlas overview primitive optimization

**Production baseline:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Control commit:** `6b4c8963bf817994c0c0c850107c6b8e36062354`
**Optimized behavior commit:** `bca68ce88ce3bf1a065e7a298383d8be1c1e9dcb`
**Lever:** replace the global Atlas overview's per-route Entities with one stable Cesium primitive that retains one geometry instance per renderable route.

## Outcome

The final scale distribution contains 2,500 distinct source-derived route geometries.
The harness asserts 2,500 routes, 2,500 unique sampled geometry keys, and 2,500 submitted render objects before every measured repetition can finish.
No exact-coordinate deduplication or coincident-trace suppression remains.

| Project | Metric | Control median | Primitive median | Improvement |
| --- | --- | ---: | ---: | ---: |
| Desktop Chromium | Complete route-ready latency | 51,942.97 ms | 15,310.41 ms | 70.52% |
| Desktop Chromium | Settled heap | 93.28 MB | 40.17 MB | 56.93% |
| Desktop Chromium | Peak heap | 94.15 MB | 74.97 MB | 20.37% |
| Desktop Chromium | Sample wall time | 89,920.50 ms | 21,664.73 ms | 75.91% |
| Mobile Chromium | Complete route-ready latency | 47,045.92 ms | 12,109.62 ms | 74.26% |
| Mobile Chromium | Settled heap | 93.25 MB | 39.97 MB | 57.14% |
| Mobile Chromium | Peak heap | 93.93 MB | 72.19 MB | 23.14% |
| Mobile Chromium | Sample wall time | 83,292.47 ms | 16,737.83 ms | 79.90% |

The control distribution passed 10 tests in 20.3 minutes.
The primitive distribution passed 10 tests in 5.4 minutes.
Each side used five fresh desktop browser contexts and five fresh mobile browser contexts.

## Corpus integrity

The scale corpus cycles through all 67 current generated routes.
Every replica preserves its source trace's point count, point order, and shape under a deterministic rigid latitude/longitude translation.
The translation creates 2,500 distinct sampled geometries without inventing route shapes or reducing the renderer's submitted geometry count.

The real 67-route production distribution is covered separately by the production-Cesium Atlas suites.
Those suites exercise global rendering, regional transitions, route selection, camera behavior, keyboard and pointer controls, URL state, accessibility, and responsive layout.

## Visual acceptance

The WebGL canvas was captured at global, east, and west camera positions on desktop and mobile.
The route oracle uses the production cobalt route color and requires bright map imagery 12 pixels away in every cardinal direction to exclude the globe edge.

All six comparisons passed.
Route-pixel ratios ranged from 0.9537 through 1.1205 against a 0.80 through 1.20 budget.
One-cell-dilated 48 by 24 occupancy Jaccard ranged from 0.8596 through 1.0000 against a 0.80 minimum.
Bidirectional route-mask Hausdorff distance ranged from 4.47 through 5.39 physical pixels against a 6 pixel maximum.
Every camera retained more than 100 route pixels.

The raw occupancy Jaccard values remain in `evidence.json`.
Mobile calibration showed that a passing 5 pixel mask displacement can cross a sparse grid boundary, so acceptance uses one-cell dilation while retaining the stronger exact pixel-space distance check.

## Behavioral equivalence

The overview primitive receives the same sampled route vertices in the same region, route, and point order as the Entity control.
Horizontal vertex coordinates, endpoints, and segment boundaries are exact.
The global overview is an ellipsoid-level locator and does not claim recorded elevation or terrain adherence.

Selecting a region still swaps to ordinary ground-clamped, classified, pickable per-route Entities.
Regional route styling, selection, terrain behavior, and rollback remain unchanged.
Partial regional Entity creation removes staged Entities and restores the global primitive atomically.
Atlas reports ready only after the primitive is ready and the harness additionally requires a stable, nonblank route mask.

## Environment

Both distributions ran on macOS 25.6.0, Apple M1 Pro with 10 CPUs and 16 GiB memory, Node v26.7.0, Chromium 149.0.7827.55, and Cesium 1.143.0.
Every raw report records its exact clean Git head and empty worktree status.
The schema-valid evidence manifest records byte size and SHA-256 for all 32 retained local artifacts.

## Verification

- `npm run verify:ticket` passed: typecheck, production build, 247 unit tests, and 4 navigation tests.
- `npx playwright test e2e/atlas-cesium.spec.ts` passed 19 tests.
- `npx playwright test e2e/atlas.spec.ts` passed 38 production-Cesium tests in 4.6 minutes.
- `UV_CACHE_DIR=<temporary-directory> uv run --with 'pytest>=8.0' --with 'jsonschema>=4.0' pytest -q test_runtime_evidence.py` passed 7 tests.
- `python3 runtime_evidence.py docs/performance/runtime-gauntlet/optimizations/atlas-overview-primitive/evidence.json --require-artifacts` passed and verified all 32 artifacts.
- `GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live` was not run because no Google Maps API key, provider preview URL, or local env file is configured.

The pull request must remain draft until the live-provider Atlas suite passes against a configured preview.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-atlas-final-before-6b4c8963 GODIESEL_PERF_SOURCE_COMMIT=6b4c8963bf817994c0c0c850107c6b8e36062354 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=baseline npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_RUN_ID=pr-atlas-final-after-bca68ce8 GODIESEL_PERF_SOURCE_COMMIT=bca68ce88ce3bf1a065e7a298383d8be1c1e9dcb GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=measured npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ignored raw JSON and PNG artifacts remain local at the paths and checksums declared in `evidence.json`.
