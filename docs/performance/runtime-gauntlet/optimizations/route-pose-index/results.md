# Route-pose index optimization

**Base commit:** `d84cb2d38133d800aa850ab4962f1c5f48ec299e`
**Optimized commit:** `b90398f320f0fc01ae42819f2bcffe45b6e6ca5e`
**Lever:** replace the linear first-point-at-distance scan with lower-bound binary search over the existing cumulative route-point distance

## Outcome

The 50,000-point route-pose workload improved from 116.257 ms to 0.467 ms at p95, a 99.60% reduction.
P99 improved from 159.915 ms to 0.682 ms, and p50 improved from 22.365 ms to 0.311 ms.
The result exceeds the opportunity-matrix target of p95 below 30 ms.

| Distribution | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| p50 | 22.365 ms | 0.311 ms | 98.61% |
| p95 | 116.257 ms | 0.467 ms | 99.60% |
| p99 | 159.915 ms | 0.682 ms | 99.57% |
| mean | 46.608 ms | 0.345 ms | 99.26% |

Each sample performs 500 route-pose queries and each distribution contains 100 independent samples.
The before and after runs used the same Apple M1 Pro host, arm64 architecture, Node version, synthetic 50,000-point route, query order, and benchmark implementation.

## Equivalence proof

The before and after 500-query result digest is exactly `638c3244`.
The permanent public-interface tests cover boundary, duplicate-distance, interior, out-of-range, bearing, altitude, progress, and dateline interpolation behavior.
The 50,000-point late-lookup regression also limits the public operation to 64 indexed route-point reads, preventing a return to linear lookup without relying on a timing threshold.

No route data, rendering, camera, telemetry, provenance, accessibility, URL, or provider behavior changes.

## Commands

```bash
cd app
GODIESEL_PERF_NODE_SAMPLES=100 GODIESEL_PERF_RUN_ID=pr-route-pose-before GODIESEL_PERF_SOURCE_COMMIT=d84cb2d38133d800aa850ab4962f1c5f48ec299e npm exec vitest -- run --config vitest.runtime-perf.config.ts perf/runtime-baseline.perf.ts
GODIESEL_PERF_NODE_SAMPLES=100 GODIESEL_PERF_RUN_ID=pr-route-pose-after-b90398f3 GODIESEL_PERF_SOURCE_COMMIT=b90398f320f0fc01ae42819f2bcffe45b6e6ca5e npm exec vitest -- run --config vitest.runtime-perf.config.ts perf/runtime-baseline.perf.ts
```

The ignored raw reports remain local and are identified by byte size and SHA-256 in `evidence.json`.
