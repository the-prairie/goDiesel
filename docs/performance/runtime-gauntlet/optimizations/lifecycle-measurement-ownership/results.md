# Lifecycle measurement ownership correction

**Baseline source commit:** `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`
**Corrected source commit:** `51c98c5424a15da15873e8c4bf82cce11520011d`
**Lever:** release profiler-owned WebGL records, establish a trend-validated warmup baseline, and keep the final 1.10 heap target gating

## Outcome

The original lifecycle-retention hotspot is cleared under a stricter measurement contract without changing production renderer code.
All five desktop and five mobile browser-context sequences converged independently and finished below the mandatory 1.10 final settled-heap ratio.
Every measured route-detail, Replay, and Atlas boundary retained exactly one active WebGL context and one instrumentation record.

| Project | Original final range | Corrected final range | Corrected median | Warmup cycles |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 1.452x-1.499x | 1.040x-1.043x | 1.043x | 25-27 |
| Mobile Chromium | 1.336x-1.386x | 1.031x-1.049x | 1.041x | 17-28 |

The profiler originally retained every historical canvas and WebGL context in a strong `Map`.
The captured heap graph traces those wrappers through `HTMLCanvasElement.getContext`, its `webglRecords` closure, the `Map` table, and retained context records.
The corrected profiler deletes disconnected records at every settled snapshot while preserving cumulative context creation.

## Convergence contract

The earlier three-point range rule was rejected because it could accept slow monotonic growth.
The permanent oracle now evaluates the last eight GC-normalized heap observations after at least 12 complete warmup cycles.
It requires all three conditions: range ratio at most 1.04, absolute normalized linear slope at most 0.0025 per cycle, and first-half versus second-half drift at most 1.01.
Warmup fails if convergence has not occurred by cycle 40.

Deterministic regressions cover stable noise, slow monotonic retention, a transient compilation spike followed by stability, and nonconvergence at the maximum cycle.
The evidence aggregator independently recalculates all three statistics, rejects malformed or noncanonical protocols, rejects failed atomic reports, and enforces the canonical 1.10 final heap ceiling.
It exact-compares every warmup minimum, maximum, window, range, slope, and half-drift field against the permanent protocol so a consistently weakened producer cannot package passing evidence.

The strict exact-head evidence needed 17-28 warmup cycles, proving that the old fixed ten-cycle result was premature.
The final 1.10 target remains an explicit Playwright assertion and an aggregation requirement.

No production renderer, camera, telemetry, route, Atlas, Replay, navigation, or provider behavior changes.
The corrected measurements were regenerated after route-pose PR #115 merged, so every raw report names an ancestor of the final reviewed head.

## Exact-equivalence proof

Equivalent inputs are the same generated route corpus, deterministic provider fixtures, desktop/mobile projects, and canonical route-detail, Replay, and Atlas lifecycle sequence.
Production renderer, route, camera, telemetry, provider, navigation, and accessibility outputs are identical because this slice changes only performance instrumentation and evidence validation.
Ordering remains route detail, then Replay, then Atlas in every measured cycle, with the same exact navigation-readiness barriers.
Lifecycle and provenance remain explicit: only disconnected profiler records are released, cumulative context creation remains recorded, and each surface boundary retains one active connected context and one profiler record.
Invalidation is limited to disconnected instrumentation canvases; no product cache or route index is introduced.
The golden oracle is five independent sequences per project, 20 measured cycles per sequence, exact readiness assertions, canonical warmup validation, the 1.10 final heap ceiling, context ownership assertions, and checksum-addressed raw reports.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-lifecycle-rebased-51c98c54-v1 GODIESEL_PERF_SOURCE_COMMIT=51c98c5424a15da15873e8c4bf82cce11520011d GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ten ignored raw reports remain local and are identified by exact byte size and SHA-256 in `evidence.json`.
