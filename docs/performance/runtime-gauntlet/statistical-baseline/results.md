# Runtime statistical baseline results

**Run ID:** `issue113-hermetic-2026-08-27`
**Source commit:** `30b94f2502281fccd9caa8599ab06a92e1dab054`
**Host:** Lauren's fixed Apple M1 Pro workstation, arm64 macOS
**Provider mode:** live providers disabled; external map style replaced by a deterministic local fixture

## Outcome

The hermetic packet contains 100 measured Node samples per benchmark, 100 successful desktop observations per surface, 100 successful mobile observations per surface, five independent 20-transition lifecycle sequences per project, and 20 profiled repetitions per project.
The reducer produced 314 distributions.
It reports an available p99 for 298 distributions and an explicit `insufficient-samples` status for the remaining 16.
All 18 selected browser profiles contain nonzero React actual-duration evidence, per-commit profiles, CPU and allocation profiles, GC-normalized before-and-after heap, sampled peak heap, network classification, and WebGL lifecycle state.
The strict validator accepted the JSON Schema and verified all 979 retained artifacts with no checksum or size mismatch.

No surface attempt failed and no supplemental repetition was needed.
The provider-disabled browser reports contain zero successful external resources, 960 deterministic fixture resources, and zero unclassified or blocked external requests.
Every report identifies source commit `30b94f2502281fccd9caa8599ab06a92e1dab054`; aggregation rejects mixed source commits.

The live-provider distribution is explicitly unavailable because an owner-approved provider-quota repetition count was not supplied.
No live timing is inferred from provider-disabled data.

## Headline distributions

| Workload | p50 | p95 | p99 | CV |
| --- | ---: | ---: | ---: | ---: |
| Desktop route detail cold | 923.57 ms | 968.71 ms | 1,349.30 ms | 0.079 |
| Mobile route detail cold | 935.20 ms | 980.56 ms | 999.97 ms | 0.057 |
| Desktop Replay cold | 927.76 ms | 1,029.19 ms | 1,063.18 ms | 0.117 |
| Mobile Replay cold | 924.41 ms | 939.25 ms | 1,074.14 ms | 0.062 |
| Desktop Atlas, 2,500 routes | 1,292.11 ms | 2,074.17 ms | 2,158.24 ms | 0.210 |
| Mobile Atlas, 2,500 routes | 1,802.40 ms | 2,350.29 ms | 2,460.26 ms | 0.304 |
| Node route pose, 50,000 points | 20.23 ms | 89.67 ms | 91.11 ms | 0.780 |
| Node region build, 2,500 routes | 41.18 ms | 42.94 ms | 43.74 ms | 0.020 |

The 2,500-route Atlas p99 peak heap was 128.0 MB desktop and 112.9 MB mobile.
Its p99 long-task total was 4,339 ms desktop and 3,394 ms mobile, with 18 and 19 long tasks respectively.
The mobile Atlas cold distribution also has a material tail: 1,168.67 ms p50, 1,941.77 ms p95, and 1,998.59 ms p99.

## Lifecycle interpretation

Each project has five independent lifecycle sequences containing 20 correlated transitions.
The 100 transition observations support descriptive p50 values, including 1,004.85 ms desktop and 836.71 ms mobile detail transitions.
They do not support p95 or p99 independence claims, so those quantiles are `null` with `insufficient-samples` status.
Lifecycle heap CV was 0.050 desktop and 0.047 mobile, and every settled boundary retained exactly one connected, non-lost WebGL context.

## Profile interpretation

The 50,000-point route pose tail is the clearest Node hotspot.
Its CPU profile is led by `minimalLongitudeArc` with 1,835 samples and `pointAtDistance` with 1,756 samples.

The 2,500-route Atlas is the dominant browser workload by latency, heap, long-task time, and expensive React commit.
Its expensive-commit p95 was 59.3 ms desktop and 62.7 ms mobile.
Only 60 commit observations exist per project, so expensive-commit p99 remains correctly unavailable.

Route detail and Replay spend much more wall time in application and renderer startup than in React commits.
Their selected profiles recorded 21.3-25.9 ms of total React actual duration against roughly 924-935 ms median wall latency.
That evidence argues for profiling renderer/bootstrap reuse before React component micro-optimization.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=issue113-hermetic-2026-08-27 npm run perf:runtime:statistics
../.venv/bin/python ../runtime_evidence.py artifacts/runtime-statistics/issue113-hermetic-2026-08-27/statistical-summary.json --artifact-root . --require-artifacts
```

The raw packet is 276 MB at `app/artifacts/runtime-statistics/raw/issue113-hermetic-2026-08-27` and is intentionally retained as a local artifact.
The committed summaries carry its normalized paths, byte sizes, SHA-256 checksums, producing method, and source commit.
