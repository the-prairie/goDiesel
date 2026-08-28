# Runtime statistical baseline results

**Run ID:** `issue113-final-hardened-2026-08-27`
**Measurement source commit:** `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`
**Host class:** fixed Apple M1 Pro workstation, arm64 macOS
**Provider mode:** live providers disabled; external map style replaced by a deterministic local fixture

## Outcome

The hermetic packet contains 100 measured Node samples per benchmark, 100 successful desktop observations per surface, 100 successful mobile observations per surface, five independent 20-transition lifecycle sequences per project, one baseline/final lifecycle heap-snapshot pair per project, and 20 profiled repetitions per project.
The reducer produced 318 distributions.
It reports an available p99 only where 100 independent samples exist and records `insufficient-samples` everywhere else.
All 18 selected browser profiles contain nonzero React actual-duration evidence, per-commit profiles, CPU and allocation profiles, GC-normalized before-and-after heap, sampled peak heap, navigation plus action and observation network phases, and WebGL lifecycle state.
The strict validator accepted the JSON Schema and verified all 992 retained artifacts with no checksum, size, path, or source-commit mismatch.

No measured surface, lifecycle, lifecycle-profile, or browser-profile attempt failed and no supplemental repetition was needed.
The provider-disabled browser reports contain zero successful external resources, 960 deterministic fixture resources, and zero blocked external requests.
Every raw report identifies measurement source commit `47455d7d364ebe47b22d75a9fbe98abb25e2a22b`; aggregation rejects mixed source commits and non-passing reports.
Committed environment and process metadata redact the local hostname, executable location, worktree, and dependency paths.

The live-provider distribution is explicitly unavailable because an owner-approved provider-quota repetition count was not supplied.
No live timing is inferred from provider-disabled data.

## Headline distributions

| Workload | p50 | p95 | p99 | CV |
| --- | ---: | ---: | ---: | ---: |
| Desktop route detail cold | 929.07 ms | 988.42 ms | 1,323.26 ms | 0.071 |
| Mobile route detail cold | 938.24 ms | 989.71 ms | 1,358.93 ms | 0.206 |
| Desktop Replay cold | 926.14 ms | 1,071.40 ms | 1,110.45 ms | 0.206 |
| Mobile Replay cold | 925.87 ms | 1,075.51 ms | 1,101.43 ms | 0.131 |
| Desktop Atlas cold | 1,380.06 ms | 2,457.84 ms | 3,069.23 ms | 0.297 |
| Mobile Atlas cold | 1,455.16 ms | 1,992.14 ms | 2,330.11 ms | 0.214 |
| Desktop Atlas, 2,500 routes | 1,480.14 ms | 2,126.67 ms | 2,393.81 ms | 0.163 |
| Mobile Atlas, 2,500 routes | 1,237.31 ms | 1,634.30 ms | 3,146.55 ms | 0.318 |
| Node route pose, 50,000 points | 21.43 ms | 93.58 ms | 96.41 ms | 0.772 |
| Node region build, 2,500 routes | 41.91 ms | 43.98 ms | 44.76 ms | 0.023 |

The 2,500-route Atlas p99 peak heap was 128.4 MB desktop and 116.2 MB mobile.
Its p99 long-task total was 5,894 ms desktop and 4,708 ms mobile.
The ordinary Atlas cold path also has a material tail: desktop p99 was 3,069 ms and mobile p99 was 2,330 ms.

Frame distributions now use one complete-window p95 interval per repetition rather than pooling individual frames.
Intervals clipped by either observation boundary are excluded.
The 2,500-route desktop interval distribution has 98 observations because two repetitions contained no complete interval; its 100-observation frame-rate distribution records those repetitions as 0 FPS.
Across every surface, the smallest complete interval was 8.4 ms and the largest derived maximum was 119.05 FPS, consistent with the host display rather than the impossible rates produced by boundary fragments.

## Lifecycle interpretation

Each project has five independent lifecycle sequences containing 20 correlated transitions.
The transition observations support descriptive p50 values, but do not support independent p95 or p99 claims, so those quantiles remain `null` with `insufficient-samples` status.

The independent final-boundary distributions identify material retained heap after 20 transitions.
Desktop final heap was 26.98-27.05 MB and 45.16-49.93% above the settled baseline, with a median ratio of 1.492.
Mobile final heap was 26.61-26.83 MB and 33.63-38.61% above the settled baseline, with a median ratio of 1.377.
Every settled boundary retained exactly one connected, non-lost WebGL context, so the scalar evidence points to retained application or renderer data rather than multiplying active contexts.
This fails the gauntlet target of returning within 10% of the settled baseline and is a real follow-up hotspot.

The dedicated snapshot pairs reproduce the retention signal at 1.328x desktop and 1.362x mobile.
Their largest self-size growth is compiled/runtime code: `InstructionStream` adds 4.14 MB desktop and 3.93 MB mobile, followed by `TrustedByteArray`, `FeedbackVector`, and `InternalNode` growth.
Both snapshots also show 80 additional `WebGL2RenderingContext` wrapper nodes while the settled runtime reports one connected active context.
This narrows the next investigation to renderer teardown, wrapper reachability, and code-cache ownership, but does not yet prove a production leak owner.

## Profile interpretation

The 50,000-point route-pose tail is the clearest isolated Node hotspot.
Its dedicated CPU profile is led by `pointAtDistance` with 2,180 samples; the separate region-build profile is led by `minimalLongitudeArc` with 2,251 samples.
These profiles do not mix benchmark attribution.

The 2,500-route Atlas is the dominant browser scale workload by latency, heap, long-task time, and allocation size.
Its p95 expensive React commit was 56.2 ms desktop and 56.7 ms mobile.
Only 60 expensive-commit observations exist per project, so p99 remains correctly unavailable.
The selected allocation profiles attribute 27.9 MB desktop and 29.5 MB mobile to route-region construction, 16.3 MB and 17.5 MB to `fromDegrees`, and further material allocations to route regions and Cesium geometry.

Route detail and Replay spend much more wall time in application and renderer startup than in React commits.
Their selected profiles recorded 19.2-24.8 ms of total React actual duration against 926-938 ms selected wall latency.
That evidence favors renderer, route-decoding, and bootstrap reuse before React component micro-optimization.

## Commands

```bash
cd app
GODIESEL_PERF_RUN_ID=issue113-final-hardened-2026-08-27 npm run perf:runtime:statistics
python3 ../runtime_evidence.py artifacts/runtime-statistics/issue113-final-hardened-2026-08-27/statistical-summary.json --artifact-root . --require-artifacts
```

The raw packet is 456 MB at `app/artifacts/runtime-statistics/raw/issue113-final-hardened-2026-08-27` and is intentionally retained as a local artifact.
The committed summaries carry canonical normalized paths, byte sizes, SHA-256 checksums, producing method, and measurement source commit.

## Merge verification

The source-consistent statistical run passed six warm-up scenarios, 200 surface repetitions, 10 lifecycle sequences, two lifecycle heap-profile sequences, and 40 browser-profile repetitions.
Strict local validation verified 992 retained artifacts and no missing artifact.
Clean-checkout validation accepted the schema and reported all 992 raw artifacts as intentionally external.
`npm run verify:ticket` passed type checking, the production build, 40 Vitest files with 240 tests, and four required navigation Playwright tests.
`npm run perf:runtime:baseline` passed two Vitest files with 11 tests and both desktop and mobile Playwright runtime scenarios.
The focused runtime-statistics Vitest file passed 10 tests.
`python -m pytest test_runtime_evidence.py` passed seven schema, canonical-path, traversal, alias, and checksum-integrity regressions.
