# goDiesel production runtime performance gauntlet

**Status:** implementation contract
**Base:** `main` at `0b8dd50836f4faaf1e66dc1dec41e5dd5a2cd60b` or later
**Branch:** `perf/runtime-performance-gauntlet`
**Merge policy:** draft PR only until every exit criterion is supported by reproducible evidence

## Goal

Make the production goDiesel Atlas, Finder, Routes, route detail, and Replay extraordinarily fast, responsive, memory-stable, and scalable while preserving their behavior, evidence, accessibility, and visual quality.

The quality reference is the official CesiumJS Photorealistic 3D Tiles quickstart running on the same machine, browser, viewport, device scale factor, provider credentials, cache state, and network conditions. goDiesel must remain substantially more informative than the reference while feeling comparably fluid.

This is a measured optimization gauntlet, not a speculative rewrite. Profile first. Implement one performance lever at a time. Keep only changes that produce material gains and satisfy their equivalence obligations.

## Required reading and documentation reality check

Before changing production code, read and assess:

- `AGENTS.md`
- `README.md`
- `CONTEXT.md`
- `STRATEGY.md`
- `app/DESIGN.md`
- `docs/agents/testing.md`
- `docs/agents/domain.md`
- ADRs relevant to route generation, two-tier route data, Atlas, Finder, Replay, providers, and testing

These documents are required evidence, not automatically current truth.

Create a concise Documentation Reality Check before deriving implementation requirements. Classify every material claim as one of:

- current normative rule;
- current descriptive fact;
- intended but not implemented;
- historical context;
- superseded;
- contradicted by current code or tests;
- ambiguous and requiring an explicit decision.

Use chronology, accepted ADRs, current code, generated contracts, tests, screenshots, traces, and recent merged work to establish freshness.

Use this authority order when sources conflict:

1. This goal, current user constraints, and safety requirements.
2. Privacy, provenance, source-truth, public/private, and data-loss protections.
3. The most recent accepted ADR or canonical design/domain contract.
4. Current production behavior and generated contracts.
5. Tests that protect intentional product, domain, security, accessibility, or provenance invariants.
6. `CONTEXT.md` and `README.md` descriptive claims.
7. `STRATEGY.md`, plans, brainstorms, reports, and historical comments.

Do not silently treat stale documentation as a requirement. Do not use this performance goal to make an undocumented product-policy decision.

Before production edits, commit or attach a table:

| Claim | Source | Freshness | Evidence | Treatment |
| --- | --- | --- | --- | --- |
| … | … | current / stale / ambiguous | code / test / ADR / history | enforce / preserve / update / exclude |

Also classify affected tests by intent:

- product invariant;
- domain/provenance invariant;
- security/privacy invariant;
- exact-output oracle;
- accessibility invariant;
- implementation detail;
- historical compatibility;
- visual snapshot.

Do not weaken a test merely because it blocks an optimization. Replace implementation-detail tests with stronger invariant tests only after documenting their original intent.

## Scope

This goal covers the production runtime and the route-data structures directly required by it:

- Atlas;
- Finder;
- Routes;
- route detail;
- Replay;
- shared route repositories;
- generated summary and index payloads;
- renderer lifecycle;
- browser memory;
- runtime accessibility and interaction behavior.

## Non-goals

This goal does not cover:

- Route Studio film-render throughput;
- MP4 artifact delivery;
- Route Studio remediation;
- curation workflow redesign;
- plan-to-completion functionality;
- broad `build.py` cleanup unrelated to runtime data;
- new product features;
- visual redesign;
- weakening route fidelity, provenance, accessibility, or named provider degradation to improve a metric.

## Stage -1 — Current truth specification

Before benchmarking:

1. Build the Documentation Reality Check.
2. Build a source-backed runtime architecture map.
3. Compare documented architecture with executable architecture.
4. Identify stale performance assumptions.
5. Identify tests that protect invariants versus implementation details.
6. Record unresolved product-policy conflicts.
7. Freeze a goal-specific Current Truth Specification.

The architecture map must cover:

1. generated route summaries and route details;
2. initial application loading;
3. route-manifest transfer and parsing;
4. Atlas global rendering;
5. Atlas regional rendering;
6. route selection;
7. Finder index construction and search;
8. Routes filtering and progressive loading;
9. route-detail loading and intent prefetching;
10. Replay startup, renderer selection, and teardown;
11. transitions among Atlas, Finder, Routes, route detail, and Replay.

The Current Truth Specification must state:

- which externally observable behavior is preserved;
- which route corpus and generated data are under test;
- which renderer is production;
- which fallbacks are intentional;
- which documents are normative for this goal;
- which stale claims are excluded;
- which unresolved decisions are explicitly out of scope.

## Stage 0 — Baseline and evidence

Do not modify production code until a baseline evidence packet exists.

Run the existing deterministic test and release gates and record exact commands and results.

Create committed, repeatable workloads for:

A. The current real generated route library.
B. A synthetic library of at least 2,500 source-backed route summaries.
C. A synthetic Finder index of at least 10,000 candidates.
D. Twenty consecutive Atlas → route detail → Replay → Atlas transitions.
E. Cold-start and warm-start desktop runs.
F. Cold-start and warm-start mobile runs.
G. Reduced-motion mode.
H. Live-provider mode.
I. Deterministic provider-disabled mode.

For each relevant workload, record:

- p50, p95, and p99 latency;
- frame-time and frame-rate distribution;
- long-task count and duration;
- Interaction to Next Paint where available;
- JavaScript transfer, parse, and execution time;
- route-manifest transfer and parse time;
- Finder index construction and search time;
- Routes filtering and list rendering time;
- route-selection preparation time;
- route-detail load time;
- Replay startup time;
- peak heap;
- settled heap;
- heap after twenty transitions;
- active WebGL context count;
- network request count and transferred bytes;
- provider-settlement time separated from local application time;
- React commit count and expensive commit duration for affected surfaces.

Commit benchmark commands, fixture-generation commands, machine/environment metadata, and machine-readable baseline results.

## Stage 1 — Profile before proposing

Capture:

- Chrome CPU profiles;
- allocation and heap profiles;
- network waterfalls;
- React profiles;
- renderer and WebGL lifecycle evidence;
- generated-data parse and lookup profiles;
- I/O profiles where relevant.

Identify the top three to five hotspots by measured share of:

- main-thread time;
- route-selection latency;
- Finder query latency;
- Routes filtering/rendering latency;
- memory retention;
- transferred bytes;
- renderer work;
- repeated computation.

Do not propose or implement an optimization without tying it to a measured hotspot.

Create and maintain an opportunity matrix:

```text
score = (expected impact × confidence) / implementation effort
```

For every candidate, record:

- measured hotspot;
- proposed lever;
- expected metric movement;
- equivalence class;
- implementation effort;
- regression risk;
- verification oracle.

Select the highest-ranked defensible candidate, not the most technically interesting candidate.

## Stage 2 — Exact-isomorphic optimization lane

First optimize only changes for which the same valid inputs produce the same externally observable outputs.

Patterns to investigate only when supported by profiling include:

- N+1 route-detail or provider request elimination;
- duplicate fetch and parse elimination;
- memoization of pure immutable computations with explicit invalidation;
- precomputed lookup indexes;
- indexed lookup instead of repeated linear scans;
- binary search over monotonic distance or temporal arrays;
- prefix sums and cumulative aggregates;
- lazy parsing and deferred computation;
- typed arrays and reusable buffers;
- avoiding repeated allocation in render loops;
- list virtualization;
- route-detail intent prefetching;
- stable data references that prevent unnecessary React rendering;
- worker-backed pure computation;
- renderer and WebGL cleanup;
- request scheduling;
- bounded queues and backpressure only if measured contention exists;
- serialization changes only when a reversible, versioned value-equivalence contract is proven.

This list is a set of investigative lenses, not a checklist.

For each change:

1. Implement exactly one performance lever.
2. Add or update its benchmark.
3. Add permanent regression tests.
4. Run the smallest relevant correctness suite.
5. Rerun the representative workload.
6. Write an isomorphism proof.
7. Keep the change only if the gain is material and repeatable.
8. Revert the change if the gain is noise, moves cost elsewhere, or weakens behavior.

Every proof must state:

- equivalent inputs;
- outputs guaranteed identical;
- preserved ordering guarantees;
- preserved lifecycle and provenance guarantees;
- cache/index invalidation correctness;
- how the golden oracle proves equivalence.

### Exact-equivalence oracles

Define and preserve golden outputs for:

- generated route-summary values;
- strict route-detail values;
- route ordering;
- region membership;
- Finder candidate membership and ranking;
- Routes filter membership and ordering;
- selected-route identity;
- route geometry and segment boundaries;
- URL state;
- camera destination and intended route target;
- user-visible copy;
- accessibility tree and names;
- keyboard behavior;
- named provider degradation;
- route provenance;
- lifecycle semantics.

Byte-compare generated artifacts where appropriate. When byte comparison is inappropriate, compare parsed canonical values and document why.

## Stage 3 — Bounded-equivalence lane

Begin this lane only if exact-isomorphic changes cannot satisfy the required budgets.

Potential representation-changing hypotheses include:

- multi-resolution route geometry;
- route primitive batching;
- alternative Cesium representations;
- route-thread simplification;
- request-driven rendering;
- reduced update frequency;
- screen-space culling;
- visual level of detail;
- alternative serialization representations.

Before implementing one, define explicit budgets for:

- maximum spatial deviation;
- endpoint preservation;
- segment-boundary preservation;
- route-order preservation;
- screen-space visual error at tested camera distances;
- label and control stability;
- screenshot-regression tolerance;
- accessibility equivalence;
- camera behavior;
- user-perceived responsiveness.

Never describe a representation-changing optimization as strictly isomorphic. Require a fresh visual critic and domain critic to approve it.

## Numeric exit criteria

The completed system must:

- sustain at least 45 fps at p95 during desktop Atlas interaction with 2,500 routes;
- sustain at least 30 fps at p95 on the agreed mobile test device/profile;
- keep p99 main-thread tasks below 100 ms after provider startup;
- search and rank 10,000 Finder candidates in under 50 ms at p95 after index load;
- keep client-side route-selection and region-preparation work below 200 ms at p95, excluding live-provider settlement;
- retain no more than one intended active world renderer and WebGL context;
- preserve the approved settled lifecycle invariant of exactly one connected, non-lost WebGL context on route detail, Replay, and Atlas; route detail's context belongs to its intentional production MapLibre renderer;
- return to within 10% of settled heap baseline after twenty Atlas ↔ Replay cycles;
- keep the existing initial-shell budget;
- keep Replay and route detail lazy;
- avoid loading full-detail geometry for every route at startup;
- preserve route truth, lifecycle, provenance, accessibility, URL state, and named degradation;
- pass deterministic browser, live-provider, memory, visual, and domain tests.

If a numeric target is physically impossible on the documented reference hardware, do not silently lower it. Produce evidence, isolate provider-bound or hardware-bound cost, and propose a replacement target for explicit approval.

The route-detail lifecycle target was explicitly approved on 2026-08-25 after the corrected Stage 0 evidence showed that a settled route detail intentionally owns one production MapLibre context. The earlier requested zero-context route-detail oracle is superseded by the surface-specific invariant above. This approval changes only the lifecycle oracle; it does not waive cleanup, heap, provider, fidelity, or any other exit criterion.

## Performance guardrails

Add stable deterministic CI gates for measurements such as:

- Finder query latency;
- manifest parse time;
- route-index construction;
- route lookup;
- Routes filtering;
- geometry preparation;
- React render counts;
- memory-leak regressions;
- bundle and payload budgets;
- exact golden outputs.

Do not place highly variable live-provider frame-rate thresholds in ordinary CI.

Add a reproducible live performance release gate with:

- fixed hardware/browser profile;
- warm-up protocol;
- multiple repetitions;
- variance reporting;
- p50/p95/p99 results;
- committed machine-readable evidence.

## Gauntlet loop

For every iteration:

1. A profiling agent identifies the current measured bottleneck.
2. A builder implements exactly one lever.
3. A correctness critic reviews isomorphism and domain truth.
4. A performance critic reruns benchmarks and profiles.
5. A visual/accessibility critic checks the affected experience.
6. The change is kept, revised, or reverted.
7. The opportunity matrix is updated before selecting the next lever.

Do not stop after a fixed number of iterations or a percentage improvement.

Stop only when:

- every numeric exit criterion passes or an explicitly approved replacement target exists;
- a fresh blind critic chooses goDiesel over the reference for responsiveness;
- all exact or bounded equivalence obligations are satisfied;
- full deterministic and required live-provider tests pass;
- remaining material cost is demonstrated to be provider-bound or irreducible.

## Required delivery

Keep the implementation in a draft pull request. Do not merge or enable auto-merge.

The PR must contain:

- Documentation Reality Check;
- Current Truth Specification;
- runtime architecture map;
- baseline commands and machine-readable results;
- CPU, allocation, network, React, and memory profiles;
- ranked opportunity matrix;
- one performance lever per reviewable commit;
- an isomorphism or bounded-equivalence proof for every lever;
- before/after traces and recordings;
- benchmark scripts and fixtures;
- golden-output fixtures;
- permanent regression thresholds;
- exact test commands and outcomes;
- remaining provider-bound costs;
- residual risks.

The PR must stay draft until a final independent review confirms the evidence and exit criteria.
