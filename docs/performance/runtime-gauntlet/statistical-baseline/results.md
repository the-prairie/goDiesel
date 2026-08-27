# Runtime statistical baseline results

**Run ID:** `issue113-final-2026-08-27`
**Measurement source commit:** `979cef88180e936708a022f5549904754f997931`
**Host class:** fixed Apple M1 Pro workstation, arm64 macOS
**Provider mode:** live providers disabled; external map style replaced by a deterministic local fixture

## Outcome

The hermetic packet contains 100 measured Node samples per benchmark, 100 successful desktop observations per surface, 100 successful mobile observations per surface, five independent 20-transition lifecycle sequences per project, and 20 profiled repetitions per project.
The reducer produced 319 distributions.
It reports an available p99 for 298 distributions and an explicit `insufficient-samples` status for the remaining 21.
All 18 selected browser profiles contain nonzero React actual-duration evidence, per-commit profiles, CPU and allocation profiles, GC-normalized before-and-after heap, sampled peak heap, navigation plus action and observation network phases, and WebGL lifecycle state.
The strict validator accepted the JSON Schema and verified all 986 retained artifacts with no checksum or size mismatch.

No measured surface, lifecycle, or profile attempt failed and no supplemental repetition was needed.
The provider-disabled browser reports contain zero successful external resources, 960 deterministic fixture resources, and zero blocked external requests.
Every raw report identifies measurement source commit `979cef88180e936708a022f5549904754f997931`; aggregation rejects mixed source commits and non-passing reports.
The committed environment metadata redacts the local hostname.

The live-provider distribution is explicitly unavailable because an owner-approved provider-quota repetition count was not supplied.
No live timing is inferred from provider-disabled data.

## Headline distributions

| Workload | p50 | p95 | p99 | CV |
| --- | ---: | ---: | ---: | ---: |
| Desktop route detail cold | 926.67 ms | 1,001.32 ms | 1,323.87 ms | 0.083 |
| Mobile route detail cold | 948.77 ms | 1,023.08 ms | 1,126.38 ms | 0.055 |
| Desktop Replay cold | 928.21 ms | 1,064.74 ms | 1,084.79 ms | 0.169 |
| Mobile Replay cold | 929.39 ms | 1,082.44 ms | 1,093.80 ms | 0.221 |
| Desktop Atlas cold | 1,373.13 ms | 2,247.87 ms | 2,577.33 ms | 0.268 |
| Mobile Atlas cold | 1,566.09 ms | 2,537.41 ms | 2,667.35 ms | 0.262 |
| Desktop Atlas, 2,500 routes | 1,508.91 ms | 1,791.24 ms | 2,151.15 ms | 0.132 |
| Mobile Atlas, 2,500 routes | 1,569.80 ms | 2,136.40 ms | 4,239.93 ms | 0.361 |
| Node route pose, 50,000 points | 26.57 ms | 105.08 ms | 106.00 ms | 0.725 |
| Node region build, 2,500 routes | 46.09 ms | 49.80 ms | 51.36 ms | 0.039 |

The 2,500-route Atlas p99 peak heap was 128.7 MB desktop and 116.7 MB mobile.
Its p99 long-task total was 3,564 ms desktop and 7,580 ms mobile.
The ordinary Atlas cold path also has a material tail: desktop p99 was 2,577 ms and mobile p99 was 2,667 ms, with p99 long-task totals of 2,699 ms and 2,859 ms respectively.

## Lifecycle interpretation

Each project has five independent lifecycle sequences containing 20 correlated transitions.
The transition observations support descriptive p50 values, but do not support independent p95 or p99 claims, so those quantiles remain `null` with `insufficient-samples` status.

The independent final-boundary distributions identify material retained heap after 20 transitions.
Desktop final heap was 26.90-27.03 MB and 44.85-45.90% above the settled baseline, with a median ratio of 1.458.
Mobile final heap was 26.72-26.83 MB and 28.24-39.29% above the settled baseline, with a median ratio of 1.370.
Every settled boundary retained exactly one connected, non-lost WebGL context, so the evidence points to retained application or renderer data rather than multiplying active contexts.
This fails the gauntlet target of returning within 10% of the settled baseline and is a real follow-up hotspot.

## Profile interpretation

The 50,000-point route-pose tail is the clearest isolated Node hotspot.
Its dedicated CPU profile is led by `pointAtDistance` with 2,449 samples; the separate region-build profile is led by `minimalLongitudeArc` with 2,383 samples.
These profiles do not mix benchmark attribution.

The 2,500-route Atlas is the dominant browser scale workload by latency, heap, long-task time, and allocation size.
Its p95 expensive React commit was 63.7 ms desktop and 59.5 ms mobile.
Only 60 expensive-commit observations exist per project, so p99 remains correctly unavailable.
The selected allocation profiles attribute about 29 MB per project to route-region construction, 17-18 MB to `fromDegrees`, and a further 16-17 MB to Cesium geometry work.

Route detail and Replay spend much more wall time in application and renderer startup than in React commits.
Their selected profiles recorded roughly 21-25 ms of total React actual duration against roughly 927-949 ms median wall latency.
That evidence favors renderer, route-decoding, and bootstrap reuse before React component micro-optimization.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=issue113-final-2026-08-27 npm run perf:runtime:statistics
python3 ../runtime_evidence.py artifacts/runtime-statistics/issue113-final-2026-08-27/statistical-summary.json --artifact-root . --require-artifacts
```

The raw packet is 286 MB at `app/artifacts/runtime-statistics/raw/issue113-final-2026-08-27` and is intentionally retained as a local artifact.
The committed summaries carry normalized paths, byte sizes, SHA-256 checksums, producing method, and measurement source commit.

## Merge verification

The source-consistent statistical run passed six warm-up scenarios, 200 surface repetitions, 10 lifecycle sequences, and 40 profile repetitions.
Strict local validation verified 986 retained artifacts and no missing artifact.
The final ticket, runtime-baseline, focused Vitest, Python, and clean-checkout gates are recorded in the pull request after the published evidence commit.
