# Runtime statistical baseline and profiling protocol

**Issue:** #113
**Predecessor:** PR #112, merged as `9d82ce0be05012a6a17e0f93bf06425158e926ed`
**Scope:** repeated measurement and profiling only
**Production optimization:** prohibited in this stage

## Deliverables

The profiling pull request must commit:

- this protocol;
- a machine-readable provider-disabled statistical summary;
- an explicit live-provider result or unavailable-prerequisites record;
- environment and repetition metadata;
- CPU, allocation, heap, network, React, renderer, WebGL lifecycle, generated-data, and relevant I/O profile summaries;
- checksums and source-commit provenance for every retained raw artifact;
- a ranked opportunity matrix tied to measured evidence; and
- exact commands and verification results.

Raw browser and Node reports may remain workflow artifacts when their aggregate size makes Git unsuitable.
Every uncommitted raw artifact must have a committed checksum, byte size, producing command, workflow or local artifact location, and summarized result.

## Reference environments

Provider-disabled runs use hermetic production builds with `GODIESEL_DISABLE_LIVE_PROVIDERS=1`.
Desktop and mobile projects retain the Stage 0 viewport, device-scale, input, and reduced-motion contracts.
Every independent surface sample uses a fresh BrowserContext and document, except the explicitly paired Atlas cold and warm samples.

Live-provider runs require all of the following:

- `GODIESEL_LIVE_PROVIDER_PERF=1`;
- `GODIESEL_FIXED_GPU_HOSTNAME` matching the executing host exactly;
- a real Google Maps credential;
- hardware acceleration;
- successful global and `region-ready` provider settlement without fallback; and
- an explicit owner-approved repetition count because live calls consume provider quota.

When any prerequisite is unavailable, the packet records the missing prerequisite and does not fabricate provider distributions.

## Repetition protocol

Warm-up observations are recorded separately and excluded from distributions.
Measured observations retain their execution order, monotonic start time, cache state, motion preference, viewport, and source run identifier.
Provider-disabled scenario order is deterministic and rotated between repetitions so thermal or background drift does not always affect the same surface.
Cold samples use fresh contexts and documents.
Warm Atlas samples reload only the paired cold Atlas document.
The lifecycle workload runs five independent twenty-transition sequences, producing 100 observations for each detail, Replay, and Atlas-return latency.

Node benchmarks use at least five warm-ups and 100 measured samples per benchmark in statistical mode.
Browser surface workloads use at least three warm-ups and 100 measured observations per project and scenario for a final p99 claim.
Development smoke runs may use fewer observations, but their p95 or p99 fields must be marked `insufficient-samples` when the minimum is not met.

## Statistical method

Quantiles use the nearest-rank method over finite observations sorted in ascending order.
The minimum independent sample counts are:

| Quantile | Minimum observations |
| -------- | -------------------: |
| p50      |                    2 |
| p95      |                   20 |
| p99      |                  100 |

The summary reports count, minimum, maximum, arithmetic mean, sample standard deviation, coefficient of variation, median absolute deviation, p50, p95, and p99.
A quantile whose minimum count is not met is `null` with status `insufficient-samples`.
Warm-ups, failed readiness oracles, unavailable-provider attempts, and retries are never silently mixed into successful distributions.

## Profile inventory

The profiling packet captures:

| Profile             | Required evidence                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node CPU            | V8 CPU profile spanning generated-data parse, lookup, region build, filter, Finder, route pose, and scene-frame benchmarks.                         |
| Node memory and I/O | Process memory before and after each benchmark plus manifest/detail read counts, bytes, and elapsed time.                                           |
| Browser CPU         | CDP CPU profiles for Atlas cold, the 2,500-route Atlas, route detail, and Replay.                                                                   |
| Allocation          | CDP sampling heap profiles for the same representative browser workloads.                                                                           |
| Heap                | GC-normalized heap before and after each representative workload and after each twenty-transition lifecycle sequence.                               |
| Network             | Phase-bounded resource waterfalls with start time, duration, transfer size, decoded size, initiator type, and local versus provider classification. |
| React               | Commit count, actual duration, and tree base duration captured through the injected DevTools hook without production component changes.             |
| Renderer and WebGL  | Connected, non-lost context counts and cumulative context creation diagnostics at every settled surface boundary.                                   |
| Live provider       | Global readiness and regional settlement separated from local application time, plus the available CPU/network/heap evidence.                       |

Browser profiles use five measured profile repetitions after the unprofiled distribution is complete.
The selection rule is the successful profile repetition nearest to the scenario's unprofiled median action latency.
Profile contents are summarized only after that latency-only selection; every unselected raw profile remains checksummed.

## Opportunity matrix

Every candidate must cite a statistical distribution and at least one profile artifact.
Candidates are scored with:

```text
score = (expected impact x confidence) / implementation effort
```

Impact, confidence, and effort use integer scales from 1 to 5.
The matrix records the measured hotspot, share or latency contribution, proposed lever, expected metric movement, equivalence class, regression risk, golden oracle, and score.
The matrix may recommend no production change when profiles do not support a material lever.

## Merge gates

This stage is complete only when:

- no production runtime behavior has changed;
- every committed summary validates against the evidence schema;
- every retained raw artifact checksum verifies;
- provider-disabled desktop and mobile distributions are complete;
- live-provider evidence is complete or has an explicit prerequisite or quota blocker;
- the opportunity matrix cites measured evidence;
- the ticket gate and affected performance suites pass; and
- fresh specification and engineering reviews find no merge blocker.
