# Lifecycle measurement ownership correction

**Baseline source commit:** `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`
**Corrected source commit:** `b905237bfec28abe55da33fd10439697f9d66452`
**Lever:** remove profiler-owned historical WebGL records and establish the heap baseline after ten complete unmeasured surface cycles

## Outcome

The apparent lifecycle-retention hotspot was a measurement false positive, not a demonstrated production renderer leak.
The original baseline was captured before route detail and Replay chunks had loaded, then counted their lazy compilation as retained lifecycle growth.
The profiler also held every historical canvas and WebGL context in a strong `Map`.
The captured heap graph traces the historical wrappers through `HTMLCanvasElement.getContext`, its `webglRecords` closure, the `Map` table, and the retained context record.

After the measurement owner was corrected, all five independent desktop and five independent mobile sequences returned within the 1.10x settled-heap boundary.

| Project | Original final range | Corrected final range | Corrected median | Worst corrected result |
| --- | ---: | ---: | ---: | ---: |
| Desktop Chromium | 1.452x-1.499x | 0.997x-1.059x | 1.056x | 1.059x |
| Mobile Chromium | 1.336x-1.386x | 1.044x-1.052x | 1.045x | 1.052x |

Every corrected sequence contains ten complete unmeasured warmup cycles followed by the unchanged 20 measured route-detail, Replay, and Atlas cycles.
Every final boundary reports exactly one connected active WebGL context and one instrumentation-owned context record while cumulative context creation reaches 122.

## Contract

The profiler deletes disconnected canvas records at each settled snapshot while retaining the cumulative creation counter.
The permanent Playwright oracle requires every detail, Replay, and Atlas boundary to have exactly one active context and one retained record.
It also requires the final GC-normalized heap ratio to remain at or below 1.10.

No production renderer, camera, telemetry, route, Atlas, Replay, or navigation behavior changes.
The correction prevents production cleanup work from being justified by profiler-owned state or one-time code loading.

## Command

```bash
cd app
GODIESEL_PERF_RUN_ID=pr-lifecycle-after-b905237b GODIESEL_PERF_SOURCE_COMMIT=b905237bfec28abe55da33fd10439697f9d66452 GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured npx playwright test --config playwright.runtime-perf.config.ts --repeat-each=5
```

The ten corrected raw reports remain local and are identified by exact byte size and SHA-256 in `evidence.json`.
