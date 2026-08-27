# Runtime statistical baseline results

**Run ID:** `issue113-2026-08-26`
**Source commit:** `153a554633354c12b4d809165dea36abda06ce89`
**Host:** Lauren's fixed Apple M1 Pro workstation, arm64 macOS
**Provider mode:** live providers disabled

## Outcome

The provider-disabled packet contains 100 measured Node samples per benchmark, 100 successful desktop observations per surface, 100 successful mobile observations per surface, and five independent 20-transition lifecycle sequences per project.
The reducer produced 138 distributions, of which 134 have at least 100 observations and an available p99.
All 18 selected browser profiles contain nonzero React commit and duration evidence.
The strict validator accepted the JSON Schema and verified all 425 retained artifacts with no checksum or size mismatch.

The live-provider distribution is explicitly unavailable because an owner-approved provider-quota repetition count was not supplied.
No live timing is inferred from provider-disabled data.

## Reliability observation

The initial browser run passed all 100 desktop attempts and 98 of 100 mobile attempts.
Mobile repetitions 16 and 17 failed because reduced-motion Replay settled to `data-state=unavailable` after the 60,000 ms readiness timeout.
Two supplemental attempts at unique indexes 100 and 101 passed, producing 100 successful mobile reports from 102 total attempts.
The 1.96% observed failure rate, failed screenshots, error contexts, and traces remain separate from successful latency distributions and are included in the checksum inventory.

## Headline distributions

| Workload | p50 | p95 | p99 | CV |
| --- | ---: | ---: | ---: | ---: |
| Desktop route detail cold | 2,867.81 ms | 3,119.70 ms | 3,281.12 ms | 0.079 |
| Mobile route detail cold | 2,599.32 ms | 3,015.19 ms | 3,216.88 ms | 0.123 |
| Desktop Replay cold | 2,166.91 ms | 2,380.76 ms | 2,444.92 ms | 0.075 |
| Mobile Replay cold | 1,945.01 ms | 2,289.31 ms | 2,657.78 ms | 0.168 |
| Desktop Atlas cold | 1,173.94 ms | 1,921.97 ms | 2,219.89 ms | 0.226 |
| Mobile Atlas cold | 1,640.84 ms | 2,274.67 ms | 2,458.73 ms | 0.173 |
| Node route pose, 50,000 points | 22.20 ms | 93.69 ms | 94.79 ms | 0.756 |
| Node region build, 2,500 routes | 42.00 ms | 45.18 ms | 71.44 ms | 0.115 |

Lifecycle route-detail p99 was 3,998.33 ms desktop and 3,703.41 ms mobile.
Lifecycle heap CV was 0.044 desktop and 0.045 mobile, and every lifecycle boundary had exactly one connected, non-lost WebGL context.

## Profile interpretation

Route detail and Replay spend much more wall time in renderer startup than in React commits.
The selected desktop route-detail and Replay captures recorded 21.5 ms and 24.6 ms of React actual duration, while their unprofiled p50 action latencies were 2,867.81 ms and 2,166.91 ms.

The 2,500-route Atlas capture retained 78.9 MB heap on desktop and 93.1 MB on mobile.
Its allocation profiles prominently contain typed-array and `fromDegrees` construction, including approximately 16.7-17.8 MB in the largest `fromDegrees` allocation node.

The Node CPU profile is dominated by `minimalLongitudeArc` and `pointAtDistance` in the 50,000-point route workload.
That evidence supports indexing geometry before considering lower-level micro-optimizations.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=issue113-2026-08-26 npm run perf:runtime:statistics
GODIESEL_PERF_RUN_ID=issue113-2026-08-26 GODIESEL_PERF_WORKLOAD=surfaces GODIESEL_PERF_PHASE=measured GODIESEL_PERF_REPETITION_OFFSET=100 npm exec playwright -- test --config playwright.runtime-perf.config.ts --project=mobile-chromium --repeat-each=2
GODIESEL_PERF_RUN_ID=issue113-2026-08-26 GODIESEL_PERF_WORKLOAD=lifecycle GODIESEL_PERF_PHASE=measured npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_RUN_ID=issue113-2026-08-26 GODIESEL_PERF_WORKLOAD=surfaces GODIESEL_PERF_PHASE=profile GODIESEL_PERF_CAPTURE_PROFILES=1 npm exec playwright -- test --config playwright.runtime-perf.config.ts --repeat-each=5
GODIESEL_PERF_LIVE_BLOCKER='owner-approved live-provider repetition count was not supplied' node scripts/runtime-statistics.mjs artifacts/runtime-statistics/raw/issue113-2026-08-26 artifacts/runtime-statistics/issue113-2026-08-26
../.venv/bin/python ../runtime_evidence.py artifacts/runtime-statistics/issue113-2026-08-26/statistical-summary.json --artifact-root . --require-artifacts
```

The raw packet is 162 MB at `app/artifacts/runtime-statistics/raw/issue113-2026-08-26` and is intentionally retained as a local artifact.
The committed summaries carry its paths, sizes, SHA-256 checksums, producing method, and source commit.
