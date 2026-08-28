# Atlas overview primitive optimization

**Production baseline:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Control commit:** `9a73728890d81daf03ea4d2f6515f9b12b1d6996`
**Optimized behavior commit:** `bb6cfecd5f555785f61c97752700681b46cd106d`
**Lever:** replace the global Atlas overview's per-route Entities with one stable Cesium Primitive that retains one geometry instance per renderable route.

## Outcome

The final production distribution contains all 66 completed generated routes.
The final scale distribution contains 2,500 distinct source-derived route geometries.
The harness asserts exact route, unique sampled geometry, and submitted geometry counts before every repetition can finish.
No exact-coordinate deduplication or coincident-trace suppression remains.

| Project | Metric | Control median | Primitive median | Improvement |
| --- | --- | ---: | ---: | ---: |
| Desktop Chromium | Complete route-ready latency | 66,068.13 ms | 24,370.07 ms | 63.11% |
| Desktop Chromium | Settled heap | 93.29 MB | 40.08 MB | 57.04% |
| Desktop Chromium | Peak heap | 94.10 MB | 70.97 MB | 24.59% |
| Desktop Chromium | Sample wall time | 109,219.43 ms | 36,181.22 ms | 66.87% |
| Mobile Chromium | Complete route-ready latency | 60,579.91 ms | 20,041.16 ms | 66.92% |
| Mobile Chromium | Settled heap | 93.15 MB | 39.84 MB | 57.23% |
| Mobile Chromium | Peak heap | 93.92 MB | 70.99 MB | 24.41% |
| Mobile Chromium | Sample wall time | 108,970.19 ms | 28,620.44 ms | 73.74% |

The control warmup passed 2 tests in 11.0 minutes.
The candidate warmup passed 2 tests in 3.4 minutes.
The control measured distribution passed 10 tests in 30.8 minutes.
The candidate measured distribution passed 10 tests in 11.4 minutes.
Each measured side used five fresh desktop contexts and five fresh mobile contexts after its explicit warmup.

## Post-readiness work

| Project | Metric | Control median | Primitive median | Change |
| --- | --- | ---: | ---: | ---: |
| Desktop Chromium | Task duration | 14,467.30 ms | 4,103.20 ms | 71.64% lower |
| Desktop Chromium | Frame p95 | unavailable | 379.80 ms | not comparable |
| Desktop Chromium | Estimated p95 FPS | 0.00 | 2.63 | not comparable |
| Desktop Chromium | Long-task count | 1 | 3 | 2 more |
| Desktop Chromium | Long-task duration | 1,614 ms | 1,088 ms | 32.59% lower |
| Mobile Chromium | Task duration | 14,687.49 ms | 3,208.34 ms | 78.16% lower |
| Mobile Chromium | Frame p95 | unavailable | 291.70 ms | not comparable |
| Mobile Chromium | Estimated p95 FPS | 0.00 | 3.43 | not comparable |
| Mobile Chromium | Long-task count | 1 | 3 | 2 more |
| Mobile Chromium | Long-task duration | 1,640 ms | 865 ms | 47.26% lower |

The control produced no frame intervals in the fixed observation window, so its frame p95 is recorded as unavailable rather than converted to zero.
The Primitive makes observable progress and sharply reduces total task cost, but its frame p95 remains far above the runtime gauntlet's eventual target.
The increased long-task count reflects work split across three smaller tasks; total long-task duration still falls materially.

## Corpus integrity

The production distribution includes all 66 completed generated routes.
The generated source summary contains 67 routes because one non-completed route remains available as a scale-shape source but is excluded from production Atlas truth.
The scale corpus cycles through all 67 source summaries.
Every replica preserves its source trace's point count, point order, and shape under deterministic rigid latitude/longitude translation.
The translation creates 2,500 distinct sampled geometries without inventing route shapes or reducing submitted geometry count.

## Visual acceptance

The WebGL canvas was captured at global, east, and west cameras on desktop and mobile for both production and scale distributions.
All 12 comparisons passed.

- Route-pixel ratios ranged from 0.8486 through 1.1205 against a 0.80 through 1.20 budget.
- One-cell-dilated occupancy Jaccard ranged from 0.8800 through 1.0000 against a 0.80 minimum.
- Bidirectional route-mask Hausdorff distance ranged from 2.00 through 4.00 physical pixels against a 6 pixel maximum.
- Every camera retained more than 100 route pixels.
- Every candidate camera recorded zero route-adjacent near-black pixels and zero enclosed near-white pixels against maxima of 5.

The Primitive uses an opaque cobalt material at a calibrated 1.9 pixel width.
Its vertices use an explicit 10,000 metre ellipsoid-relative overview height to prevent surface z-fighting.
Regional routes remain ground-clamped and classified.

## Behavioral equivalence

The overview Primitive receives the same sampled route vertices in the same region, route, and point order as the Entity control.
Horizontal coordinates, endpoints, and segment boundaries are exact.
The global overview is a locator and does not claim recorded elevation or terrain adherence.

Selecting a region still swaps to ordinary ground-clamped, classified, pickable per-route Entities.
Regional styling, selection, terrain behavior, and rollback remain unchanged.
Partial regional construction removes staged Entities and restores the global Primitive atomically.
Atlas reports ready only after the Primitive is ready, and the harness additionally requires a stable nonblank route mask.

## Environment and retention

Both distributions ran on macOS 25.6.0, Apple M1 Pro with 10 CPUs and 16 GiB memory, Node v26.7.0, Chromium 149.0.7827.55, and Cesium 1.143.0.
The committed manifest redacts the local hostname.
Every raw report records its exact clean Git head and empty worktree status.
The schema-valid evidence manifest records byte size and SHA-256 for all 72 retained local JSON and PNG artifacts.

## Verification

- `python3 runtime_evidence.py docs/performance/runtime-gauntlet/optimizations/atlas-overview-primitive/evidence.json --require-artifacts` passed and verified all 72 artifacts.
- The final ticket, Python, and Atlas Playwright gates are recorded after the evidence commit.
- `GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live` remains blocked because no Google Maps API key, provider preview URL, or local env file is configured.

The pull request must remain draft until the live-provider Atlas suite passes against a configured preview.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-atlas-warmup-before-9a737288 GODIESEL_PERF_SOURCE_COMMIT=9a73728890d81daf03ea4d2f6515f9b12b1d6996 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=warmup npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=1
GODIESEL_PERF_RUN_ID=pr-atlas-reviewed-final-before-9a737288 GODIESEL_PERF_SOURCE_COMMIT=9a73728890d81daf03ea4d2f6515f9b12b1d6996 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=baseline npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_RUN_ID=pr-atlas-warmup-after-bb6cfecd-final GODIESEL_PERF_SOURCE_COMMIT=bb6cfecd5f555785f61c97752700681b46cd106d GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=warmup npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=1
GODIESEL_PERF_RUN_ID=pr-atlas-reviewed-final-after-bb6cfecd GODIESEL_PERF_SOURCE_COMMIT=bb6cfecd5f555785f61c97752700681b46cd106d GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=measured npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ignored raw JSON and PNG artifacts remain local at the paths and checksums declared in `evidence.json`.
