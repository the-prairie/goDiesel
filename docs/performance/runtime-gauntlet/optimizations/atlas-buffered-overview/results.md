# Atlas buffered-overview optimization

**Production baseline:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Control harness:** `54aa6be92fb5c828619099279c4fb1fb7f1f5718`
**Optimized commit:** `31e28b4be1c9814fdad61ea77538c531330ef451`
**Lever:** render the global overview with Cesium's buffer-backed polyline collection and create ground-clamped Entities only for the selected region

## Predeclared visual acceptance

The hardened comparison captures the WebGL canvas buffer directly at global, east, and west camera positions for desktop and mobile Chromium, excluding DOM labels and other overlays.
The route oracle isolates pixels within a squared RGB distance of 1,200 from the established `#62a7ff` route color, rejects the globe rim by requiring map imagery three pixels away in every cardinal direction, and records the remaining distribution in a 48 by 24 grid.
For every project and camera, the optimized median route-pixel count must remain between 80% and 120% of control and the occupied-cell Jaccard overlap must be at least 0.80.
The reference repetition for each project must contain more than 100 isolated route pixels per camera; the other timing and heap repetitions still enforce a ready 2,500-route canvas.
Every timed repetition also requires more than 100 isolated global route pixels before the action window may close, so readiness latency is comparable across renderers.
These limits were committed before the hardened control or optimized distributions were collected.

## Outcome

At 2,500 independently owned source-backed routes, median settled heap fell 58.51% on desktop and 58.89% on mobile.
Median peak observed heap fell 58.18% on desktop and 41.20% on mobile.
Median full sample wall time fell 71.66% on desktop and 70.56% on mobile.

| Project | Metric | Before median | After median | Improvement |
| --- | --- | ---: | ---: | ---: |
| Desktop Chromium | Settled heap | 93.93 MB | 38.97 MB | 58.51% |
| Desktop Chromium | Peak heap | 112.71 MB | 47.13 MB | 58.18% |
| Desktop Chromium | Sample wall time | 35.12 s | 9.95 s | 71.66% |
| Mobile Chromium | Settled heap | 93.72 MB | 38.52 MB | 58.89% |
| Mobile Chromium | Peak heap | 111.85 MB | 65.76 MB | 41.20% |
| Mobile Chromium | Sample wall time | 25.63 s | 7.55 s | 70.56% |

Readiness-only action latency improved 1.38% on desktop and 11.72% on mobile.
That timer still includes Cesium viewer and imagery startup, so the result does not claim those costs were removed.

## Equivalence proof

Each before and after distribution contains five independent desktop and five independent mobile browser processes.
Every repetition requires exactly 2,500 independently owned route traces, a ready Cesium canvas, and nonzero WebGL pixels.
The coordinate-buffer unit oracle compares every packed Cartesian component with Cesium's established `Cartesian3.fromDegrees` result and covers missing geometry.

The global view remains noninteractive at the route-line level, as before.
When a region is selected, the engine creates only that region's ordinary ground-clamped Entities, preserving route picking, selected-route styling, 3D terrain alignment, carousel synchronization, URLs, and exact return state.
The complete hermetic Atlas suite passed all 19 interaction tests on desktop, tablet, and mobile.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-atlas-before-54aa6be9-v2 GODIESEL_PERF_SOURCE_COMMIT=54aa6be92fb5c828619099279c4fb1fb7f1f5718 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=baseline npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_RUN_ID=pr-atlas-buffer-after-31e28b4b GODIESEL_PERF_SOURCE_COMMIT=31e28b4be1c9814fdad61ea77538c531330ef451 GODIESEL_PERF_WORKLOAD=atlas-scale GODIESEL_PERF_PHASE=measured npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=5
npx playwright test e2e/atlas-cesium.spec.ts
```

The ignored raw reports remain local and are identified by byte size and SHA-256 in `evidence.json`.
