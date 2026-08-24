# Test-intent audit

This audit identifies which existing tests are valid equivalence oracles for runtime optimization.

| Test area | Intent class | Authority for this goal | Treatment |
| --- | --- | --- | --- |
| `src/domain/routes.test.ts` and route parser tests | Domain/provenance and exact-output invariants | High | Preserve. Add golden summary/detail and lookup checks rather than weakening strictness. |
| `src/structure.test.ts` | Architecture invariant | High | Preserve. Performance utilities must respect layer and surface boundaries. |
| `src/data/route-repository.test.ts` | Data-access behavior and request deduplication | High | Preserve; extend if prefetch/cache behavior changes. |
| `src/surfaces/atlas/*test.ts` | Pure camera, selection, route rendering, and lifecycle invariants | High | Preserve outputs. Add performance-specific pure benchmarks separately. |
| `e2e/atlas-cesium.spec.ts` | Product, renderer lifecycle, named degradation, and interaction invariants | High | Required for Atlas engine changes. Live provider spec remains separate. |
| `e2e/atlas.spec.ts` | Cross-surface state, viewport, input, and accessibility behavior | High, but expensive | Preserve relevant scenarios. Do not use incidental timing as a performance oracle. |
| `e2e/atlas-pinch-stable.spec.ts` | Stable touch behavior after actual camera settlement | High | Preserve; it exists because readiness and camera transition are distinct. |
| `src/surfaces/routes/route-filters.test.ts` | Exact filter membership/order | High | Use as golden oracle for indexed or memoized filtering. |
| `e2e/routes-library.spec.ts` | URL, lazy detail, progressive reveal, mobile/desktop usability | High | Preserve. Visual layout assertions remain product behavior, not a throughput benchmark. |
| `e2e/finder-planning.spec.ts` | Honest candidate source, exact planning behavior, URL restoration | High | Preserve exact current candidate membership and unsupported behavior. |
| Replay controller/scene/camera tests | Exact controller and camera derivation | High | Use as golden oracle for binary search, memoization, and buffer reuse. |
| `e2e/google-replay-production.spec.ts` and `earth-replay.spec.ts` | Primary/fallback Replay behavior and cleanup | High | Required for Replay runtime changes. Live provider suites required only for provider/camera changes. |
| `check-bundle-budget.mjs` | Initial payload and lazy-boundary guardrail | High | Preserve and extend with manifest/payload budgets if evidence supports it. |
| Screenshot tests | Bounded visual composition | Medium-to-high | Preserve for representation-changing work; not proof of exact geometry. |
| Exact test titles embedded in `verify:ticket` | Historical implementation coupling | Low as a name, high as intended smoke behavior | Keep behavior covered; future cleanup may replace title grep with a dedicated smoke file. Not part of the first optimization. |
| Historical path assertions in Python verifier tests | Compatibility/packaging invariant | Medium | Assess per change. Do not update paths unless the runtime architecture actually moves. |
| Live pipeline gate | End-to-end release proof using private inputs/providers | High for cutover, unavailable in hosted public CI | Do not fake or silently skip. Record unavailable prerequisites explicitly. |

## New guardrail categories required by this gauntlet

- deterministic microbenchmarks for lookup, filtering, region building, and path interpolation;
- browser timing and resource evidence for cold/warm navigation;
- active WebGL context and heap-settling regression checks;
- synthetic 2,500-route and 10,000-candidate workloads;
- exact golden result matrices alongside any new index or cache;
- live performance release evidence kept separate from ordinary CI variance.
