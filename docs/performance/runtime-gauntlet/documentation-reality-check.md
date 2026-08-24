# Documentation reality check

**Branch base:** `main` at `0b8dd50836f4faaf1e66dc1dec41e5dd5a2cd60b`
**Assessment date:** 2026-08-24
**Scope:** production runtime only — Atlas, Finder, Routes, route detail, Replay, and the data structures they consume

This assessment separates product rules from historical descriptions before any production optimization is attempted.

| Claim | Source | Freshness | Evidence | Treatment for this goal |
| --- | --- | --- | --- | --- |
| Atlas is the product home; Finder plans future routes; Routes is the library; Replay presents recorded routes. | `STRATEGY.md`, `CONTEXT.md` §§6–7 | Current normative rule | Current router, navigation, and browser tests use these exact surfaces and URLs. | Enforce. Performance work may not collapse or rename surfaces. |
| Recorded data is truth; derived, measured, and hypothesis values remain visibly distinct. | `CONTEXT.md` §4 | Current normative rule | Strict detail parsing and provenance tests enforce the vocabulary. | Enforce as a non-negotiable equivalence invariant. |
| The React SPA is canonical and `build.py` is a data generator. | ADR-0001 | Current normative architecture | Current Vite application and release package are canonical. | Enforce. The old static template is outside this runtime goal. |
| `build.py` is the only canonical writer and publication is atomic. | ADR-0003 | Current normative architecture | Generator, owner writer, and pipeline-verification tests still implement this boundary. | Enforce. Runtime indexes must be generated or derived without introducing a browser writer. |
| Route data uses lenient summaries and strict lazy details. | ADR-0004 | Current normative architecture | `routes.manifest.json`, `parseRouteSummary`, `parseRouteDetail`, and lazy per-slug fetches are active. | Enforce. Any new index must preserve one-route failure isolation and lazy detail loading. |
| The manifest is about 496 KiB and nearly consumes the 500 KiB shell budget. | ADR-0004 | Current descriptive fact, still materially accurate | Current manifest is 498,249 bytes; current route count is 67. | Treat as a measured baseline, not a permanent target. The manifest may change only with explicit equivalence and payload evidence. |
| `app/src/domain/routes.ts` and older `app/src/replay/*` paths describe current code. | ADRs 0004–0009 and older evidence links | Superseded paths | ADR-0014 reorganized code into `domain/route/` and `surfaces/*`. | Use the current paths. Do not infer current coupling from historical filenames. |
| Cesium is the production Atlas world. | ADR-0006 | Current normative architecture | `CesiumAtlasWorldEngine` is unconditionally selected and covered by deterministic/live tests. | Enforce unless an explicit superseding product decision is made. Alternative representations inside Cesium require bounded-equivalence review. |
| Native Google Maps 3D is the primary Replay renderer; Cesium and MapLibre remain explicit alternatives. | ADR-0009 | Current normative architecture, incompletely validated at atlas scale | Current Replay composition selects Google by default; live route scorecard obligation remains open. | Preserve renderer selection and named alternatives. Performance work cannot silently auto-switch or remove them. |
| Provider failure must become named degradation, never a blank or silently degraded world. | ADR-0007 | Current normative rule | Active probes, explicit status state, and browser tests cover this. | Enforce. Request/render scheduling changes must preserve readiness and fallback semantics. |
| Earth Engine never becomes a runtime dependency. | ADR-0013 | Current normative architecture | Enrichment remains static under `app/public/data/route-intelligence/`. | Enforce. Exclude Earth Engine from runtime profiling except static payload observations. |
| `app/src` is organized by app/domain/data/providers/surfaces/labs/ui, with no cross-surface imports. | ADR-0014 and `structure.test.ts` | Current normative architecture | Current tree and structural test match the decision. | Enforce. Shared performance utilities belong in pure domain/data or shared UI/provider layers, not cross-surface imports. |
| There is no CI and every release gate is manual. | ADR-0012 consequence | Superseded on 2026-08-24 | PR #110 installed a permanent read-only `Verify main` workflow. | Update documentation when this gauntlet changes adjacent testing text. Do not reintroduce self-modifying CI. |
| The current testing policy is risk-based, with deterministic tests provider-free and live tests explicit. | `AGENTS.md`, `docs/agents/testing.md`, ADR-0012 | Current normative workflow | `playwright.config.ts` disables live providers; live configs are separate. | Enforce. Add deterministic performance guardrails to normal CI; keep variable live frame-rate gates separate. |
| The initial shell budget is 500 KiB and Replay/route detail must remain lazy. | ADR-0012, `check-bundle-budget.mjs` | Current normative performance guardrail | Current gate asserts one entry, forbidden runtime markers, and named lazy chunks. | Enforce. Strengthen rather than weaken. |
| Region is a stable taxonomy. | None; `CONTEXT.md` explicitly says the opposite | Known domain gap | Regions are free-text labels and several Python maps can disagree. | Do not redesign Region in this performance goal. Preserve current labels/order as golden output. |
| Finder is a general large-catalog recommendation engine. | Strategy direction, not current implementation | Intended but not implemented | Current provider searches four hardcoded owner-curated candidates. | Benchmark current logic and a synthetic scalability harness, but do not turn this goal into Finder product redesign. |
| Current route totals are durable product facts. | Historical docs and screenshots | Descriptive and time-sensitive | Current manifest: 67 routes, 66 completed, 1 discovered, 29 regions. | Record as baseline fixture metadata only; do not hardcode counts into new runtime logic. |
| `requestRenderMode: false`, `preserveDrawingBuffer: true`, and entity-per-route rendering are required product behavior. | Current Cesium implementation only | Current implementation detail, not an accepted rule | No ADR requires these exact options. | Treat as profiling hypotheses. Change only with measured evidence and exact/bounded equivalence proof. |
| Route summaries always contain exactly 96 trace points. | Current generated manifest | Current descriptive fact, not domain invariant | All 67 current summaries contain 96 points; generator caps summaries at 96. | Preserve current output during exact-isomorphic work. A new LOD belongs only in the bounded-equivalence lane. |
| `quests.generated.json` is a runtime input. | Historical generator artifact | Contradicted by current import graph | 4.3 MiB file is committed but not imported by the application. | Exclude from browser runtime metrics. Do not delete in this goal because generator/publication implications are out of scope. |

## Explicit unresolved items kept out of scope

- The native Google Replay renderer still lacks the broad route scorecard requested by ADR-0009.
- Replay duration differs between the Google controller and the other controllers.
- Region taxonomy and overloaded Difficulty remain domain-modeling gaps.
- Route Studio and private owner-route work remain isolated in PR #107.

None of these may be silently resolved inside an optimization commit.
