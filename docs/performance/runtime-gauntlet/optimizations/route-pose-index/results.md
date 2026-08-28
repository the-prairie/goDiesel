# Route-pose index optimization

**Base commit:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Optimized commit:** `b9dc6cf53362afb95dc13bad725c0f08cdb4f417`
**Lever:** replace the linear first-point-at-distance scan with lower-bound binary search over the existing cumulative route-point distance

## Outcome

The 50,000-point route-pose workload improved from 116.257 ms to 0.603 ms at p95, a 99.48% reduction.
P99 improved from 159.915 ms to 0.760 ms, and p50 improved from 22.365 ms to 0.338 ms.
The result exceeds the opportunity-matrix target of p95 below 30 ms.

| Distribution | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| p50 | 22.365 ms | 0.338 ms | 98.49% |
| p95 | 116.257 ms | 0.603 ms | 99.48% |
| p99 | 159.915 ms | 0.760 ms | 99.52% |
| mean | 46.608 ms | 0.374 ms | 99.20% |

Each sample performs 500 route-pose queries and each distribution contains 100 independent samples.
The before and after runs used the same Apple M1 Pro host, arm64 architecture, Node version, synthetic 50,000-point route, query order, and benchmark implementation.

## Equivalence proof

The before and after 500-query result digest is exactly `638c3244`.
The permanent public-interface tests compare every returned field exactly with a frozen copy of the pre-change linear algorithm across dense deterministic monotonic routes, duplicate-distance runs, segment boundaries, clamping, single-point routes, dateline-crossing interiors, and route-summary distance overshoot.
The lower bound preserves the legacy first-match ordering when cumulative distances are duplicated.
When route-summary distance exceeds the final geometry distance, it also intentionally preserves the legacy first-segment result instead of silently correcting behavior in this performance-only change.
No cache or retained index was introduced: every lookup reads the current route-point array, so route replacement and mutation do not create an index-invalidation path.
The 50,000-point late-lookup regression also limits the public operation to 64 indexed route-point reads, preventing a return to linear lookup without relying on a timing threshold.

No route data, rendering, camera, telemetry, provenance, accessibility, URL, or provider behavior changes.

## Commands

```bash
cd app
GODIESEL_PERF_NODE_SAMPLES=100 GODIESEL_PERF_RUN_ID=pr-route-pose-before GODIESEL_PERF_SOURCE_COMMIT=d84cb2d38133d800aa850ab4962f1c5f48ec299e npm exec vitest -- run --config vitest.runtime-perf.config.ts perf/runtime-baseline.perf.ts
GODIESEL_PERF_NODE_SAMPLES=100 GODIESEL_PERF_RUN_ID=pr-route-pose-after-final-b9dc6cf5 GODIESEL_PERF_SOURCE_COMMIT=b9dc6cf53362afb95dc13bad725c0f08cdb4f417 npm exec vitest -- run --config vitest.runtime-perf.config.ts perf/runtime-baseline.perf.ts
```

The ignored raw reports remain local and are identified by byte size and SHA-256 in `evidence.json`.
