# Lifecycle measurement ownership correction

**Baseline source commit:** `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`
**Corrected source commit:** `9222a81d8ce6f7050508b2cf4469eef3151f7f23`
**Lever:** remove profiler-owned historical WebGL records and require a validated converged warmup protocol

## Outcome

The profiler-owned WebGL retention is fixed, but the total-heap hotspot is not cleared.
The original heap graph traces historical wrappers through `HTMLCanvasElement.getContext`, its `webglRecords` closure, the strong `Map` table, and retained context records.
The corrected profiler deletes disconnected records at every settled snapshot while preserving cumulative context creation.

All ten independent sequences ended with exactly one connected active context and one retained profiler record while cumulative creation reached 122.
The original snapshot's 80 additional WebGL wrapper nodes can no longer be attributed to production renderer ownership.

The GC-normalized total-heap result remains diagnostic.
All five desktop sequences returned within 1.10x, but one of five mobile sequences ended at 1.162x despite its pre-baseline heap satisfying the convergence rule.
Production renderer cleanup is therefore still unproven, and the total-heap hotspot remains open.

| Project | Original final range | Corrected final range | Corrected median | Sequences within 1.10x |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 1.452x-1.499x | 1.051x-1.055x | 1.052x | 5/5 |
| Mobile Chromium | 1.336x-1.386x | 1.057x-1.162x | 1.077x | 4/5 |

## Protocol

Every sequence performs at least ten complete unmeasured route-detail, Replay, and Atlas cycles.
Warmup continues until the last three GC-normalized heap observations remain within a 1.03 max/min ratio, with a hard failure at 40 cycles.
The aggregate validator rejects missing, invalid, non-converged, or mixed lifecycle protocols and emits the observed convergence cycles.

The permanent Playwright oracle requires every detail, Replay, and Atlas boundary to have exactly one active context and one retained profiler record.
The final total-heap ratio is retained as evidence rather than used as a pass/fail assertion because late JIT tiering can occur after a locally converged warmup.

No production renderer, camera, telemetry, route, Atlas, Replay, or navigation behavior changes.

## Command

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-lifecycle-diagnostic-9222a81d GODIESEL_PERF_SOURCE_COMMIT=9222a81d8ce6f7050508b2cf4469eef3151f7f23 GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ten raw reports remain local and are identified by exact byte size and SHA-256 in `evidence.json`.
