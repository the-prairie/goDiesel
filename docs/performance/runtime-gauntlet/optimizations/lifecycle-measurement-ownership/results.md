# Lifecycle measurement ownership correction

**Baseline source commit:** `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`
**Corrected source commit:** `a8972adbba136f76495194458c8479e8de178c16`
**Lever:** release profiler-owned WebGL records, establish a trend-validated warmup baseline, and keep the final 1.10 heap target gating

## Outcome

The original lifecycle-retention hotspot is cleared under a stricter measurement contract without changing production renderer code.
All five desktop and five mobile browser-context sequences converged independently and finished below the mandatory 1.10 final settled-heap ratio.
Every measured route-detail, Replay, and Atlas boundary retained exactly one active WebGL context and one instrumentation record.

| Project | Original final range | Corrected final range | Corrected median | Warmup cycles |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 1.452x-1.499x | 1.034x-1.049x | 1.045x | 20-33 |
| Mobile Chromium | 1.336x-1.386x | 1.039x-1.044x | 1.042x | 20-25 |

The profiler originally retained every historical canvas and WebGL context in a strong `Map`.
The captured heap graph traces those wrappers through `HTMLCanvasElement.getContext`, its `webglRecords` closure, the `Map` table, and retained context records.
The corrected profiler deletes disconnected records at every settled snapshot while preserving cumulative context creation.

## Convergence contract

The earlier three-point range rule was rejected because it could accept slow monotonic growth.
The permanent oracle now evaluates the last eight GC-normalized heap observations after at least 12 complete warmup cycles.
It requires all three conditions: range ratio at most 1.04, absolute normalized linear slope at most 0.0025 per cycle, and first-half versus second-half drift at most 1.01.
Warmup fails if convergence has not occurred by cycle 40.

Deterministic regressions cover stable noise, slow monotonic retention, a transient compilation spike followed by stability, and nonconvergence at the maximum cycle.
The evidence aggregator independently recalculates all three statistics, rejects malformed or mixed protocols, rejects failed atomic reports, and enforces the canonical 1.10 final heap ceiling.

The strict evidence needed 20-33 warmup cycles, proving that the old fixed ten-cycle result was premature.
The final 1.10 target remains an explicit Playwright assertion and an aggregation requirement.

No production renderer, camera, telemetry, route, Atlas, Replay, navigation, or provider behavior changes.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-lifecycle-strict-a8972adb-v2 GODIESEL_PERF_SOURCE_COMMIT=a8972adbba136f76495194458c8479e8de178c16 GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured npx playwright test --config playwright.runtime-perf.config.ts
GODIESEL_PERF_RUN_ID=pr-lifecycle-strict-a8972adb-v2 GODIESEL_PERF_SOURCE_COMMIT=a8972adbba136f76495194458c8479e8de178c16 GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured GODIESEL_PERF_REPETITION_OFFSET=1 npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=4
```

The ten ignored raw reports remain local and are identified by exact byte size and SHA-256 in `evidence.json`.
