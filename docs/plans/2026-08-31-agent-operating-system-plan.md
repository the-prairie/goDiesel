---
status: in-progress
last_updated: 2026-09-01
architecture: docs/architecture/agent-operating-system.md
decision: docs/adr/0016-agent-control-plane-is-manifest-driven.md
---

# Agent Operating System Plan

## Outcome

Build one small operator interface over goDiesel's existing deep modules so an agent can inspect state, produce a safe plan, apply an approved change, select proportionate proof, release an exact artifact, and leave a compact evidence receipt.

The system must improve agent control without weakening domain truth, owner authority, provider honesty, worktree isolation, atomic publication, or privacy.

## Why now

The guarded prompt-to-route workflow proved that goDiesel can expose a complex cross-language workflow through a coherent state machine.
It also exposed the broader inconsistency: route sharing is legible end to end, while other jobs require an agent to assemble repository state, environment checks, writers, test commands, and release evidence manually.

The next improvement should generalize the proven operating pattern before more independent scripts and guides accumulate.

## Current evidence

- `scripts/route.sh` already composes route status, proposal, creation, preview, validation, and publication.
- `route_create.py` already produces closed, fingerprinted proposals and structured creation reports.
- `build.py` already owns generated route data and publishes atomically.
- `curation_publish.py` already provides focused mutation and recoverable failure behavior.
- `pipeline_verification.py` and `runtime_evidence.py` already produce structured evidence.
- `docs/agents/testing.md` already defines risk-based gates and proof validity rules.
- ADR-0011 already scopes single-route release artifacts at build time.
- ADR-0012 already prevents unavailable live dependencies from appearing as skipped success.
- The application source structure and tests already enforce the product's module direction.

## Scope

This plan covers:

- a versioned capability manifest;
- a read-only system inspector and doctor;
- a five-verb operator interface;
- structured result and evidence receipt contracts;
- impact-directed verification selection;
- route-share, curation, generation, and release adapters;
- mechanical documentation and manifest drift checks;
- staged retirement of redundant invocation paths after parity.

## Non-goals

This plan does not introduce:

- a second route model;
- a database, queue, daemon, or remote control process;
- autonomous owner approval or unattended publication;
- a generic workflow engine;
- a new frontend dashboard;
- a provider abstraction without two real adapters;
- committed raw run logs or private source values;
- a replacement for Git, issues, PRs, ADRs, or tests.

## Design constraints

1. Existing domain modules remain authoritative.
2. The unified interface must remove caller coordination rather than merely forward arguments.
3. The manifest describes capabilities and effects, not route fields.
4. Every write path stays atomic, idempotent, or recoverable.
5. Every external effect requires explicit target authority.
6. Every machine-readable command keeps standard output parseable.
7. Every proof declares its covered inputs and provider assumptions.
8. A phase cannot delete an old path until parity is proven through the new interface.

## Phase status

| Phase | Status | Dependency |
| --- | --- | --- |
| 0. Knowledge topology | Complete in this documentation branch | None |
| 1. Manifest and doctor | Complete | Phase 0 |
| 2. Route-share adapter | Complete | Phase 1 manifest accuracy |
| 3. Proof receipts and impact graph | Complete | Phase 2 result envelope |
| 4. Canonical local adapters | Pending | Phase 3 verification contract |
| 5. Release adapters | Pending | Phase 4 ownership coverage |
| 6. Mechanical accretion | Pending | Stable manifest and receipts |
| 7. Interface consolidation | Pending | Proven parity and at least two real capability adapters |

## Phase 0: Establish the knowledge topology

### Work

- Add the architecture design under `docs/architecture/`.
- Add proposed ADR-0016.
- Add this current plan and a plans index.
- Make `AGENTS.md` a concise orientation and task router.
- Remove dynamic counts from canonical domain prose and point agents to status commands.
- Add documentation authority and proof-reporting rules to the focused agent guides.
- Add mechanical local-link and index checks to the plan for Phase 1 rather than claiming they exist now.

### Acceptance

- A cold reader can identify the authority for domain language, architecture decisions, workflows, plans, executable behavior, run evidence, and live status.
- Proposed behavior is visibly distinguished from current behavior.
- Historical plans cannot be mistaken for active instructions.
- No current command or capability is falsely documented as implemented.

### Evidence

- Markdown local-link validation.
- `git diff --check`.
- Manual authority and terminology pass against `CONTEXT.md` and accepted ADRs.

## Phase 1: Add a read-only capability manifest and system doctor

Status: complete on 2026-08-31.

The landed interface is deliberately read-only.
It describes four existing capabilities, reports their authority boundaries and current commands, diagnoses local readiness, checks generated route identity inventory, and emits stable redacted JSON envelopes.
It does not execute manifest commands or contact providers.

### Work

- Define `system/capabilities.schema.json`.
- Add `system/capabilities.json` using the standard-library JSON parser.
- Add a dependency-free Python control module with a stable structured result envelope.
- Add `./scripts/godiesel inspect system --json`.
- Add `./scripts/godiesel doctor --json` as a read-only environment and drift inspection.
- Report repository, worktree, runtime versions, required files, generated-data drift, configuration presence, writer health, provider configuration presence, and safe next actions.
- Redact secret values and private route values by construction.
- Validate ADR and plan indexes against files on disk.
- Validate capability documentation links and command references.

### Interface

The first implementation exposes only read-only operations.
It must not add a generic execution engine in this phase.

### Acceptance

- `inspect system` returns one schema-versioned result with repository commit, worktree state, capability inventory, blockers, warnings, and next transitions.
- `doctor` never changes canonical, generated, or external state.
- Missing dependencies are reported with stable error codes and remediation, not stack traces.
- No result includes a credential value or private source record.
- Manifest and documentation drift fail a focused test.
- The command works with repository Python 3.12 and no new runtime dependency unless a dependency is explicitly justified.

### Verification

- Unit tests for manifest schema, redaction, state classification, and error envelopes.
- Fixture tests for clean, dirty, stale-generated, missing-config, and missing-dependency repositories.
- One CLI acceptance test that parses standard output as JSON.

Implemented by `test_godiesel_control.py` and the focused commands documented in the repository README.

## Phase 2: Generalize the route-share vertical slice

### Work

- Register route sharing as the first full capability in the manifest.
- Map existing `status`, `propose`, `create`, `check`, `preview`, and `publish` behavior onto the five verbs.
- Preserve `route_create.schema.json` as the domain plan contract.
- Add a shared result envelope around existing route results without changing their domain payloads.
- Produce ignored run receipts that link proposal digest, creation report, verification, and release target.
- Keep `scripts/route.sh` working as a compatibility adapter.

### Acceptance

- The unified interface exercises the same route-share invariants and errors as the existing interface.
- Reapplying an approved proposal remains idempotent.
- Preview remains loopback-only and never invokes Wrangler.
- Release still refuses an existing alias without explicit replacement authority.
- A live release receipt records both immutable deployment URL and stable alias.
- The compatibility path and unified path produce equivalent observable results for the acceptance fixtures.

### Verification

- Existing Python route-share suite.
- Existing shell acceptance suite.
- Existing single-route Playwright journey.
- New interface-equivalence tests.
- Public smoke only when release behavior itself changes or a real release is authorized.

## Phase 3: Add proof receipts and impact-directed verification

Status: complete on 2026-09-01.

The implementation emits closed evidence receipts for route verification, explains manifest-owned path and invariant impacts without executing gates, and represents focused, ticket, release, and live tiers explicitly.
The route-share receipt and proof fingerprint are derived from the same manifest-declared route check and its complete build, test, data, and runtime dependency set.
Fingerprints include file content, file type, executable mode, configuration presence, and target identity; unavailable live targets or proof contracts block rather than fall through.
Route release validates that reusable proof before any external effect.

### Work

- Define a versioned evidence receipt schema.
- Map capability paths and invariants to focused, ticket, release, and live gates.
- Compute a proof fingerprint from covered implementation, contract, fixture, configuration, data, and provider inputs.
- Add `verify --explain` to show why each gate is selected.
- Add `verify --reuse` only when every covered input fingerprint remains valid.
- Preserve explicit manual selection as an escape hatch that is recorded in the receipt.

### Acceptance

- A changed path maps to at least one capability or fails as unclassified.
- The selector cannot downgrade a manifest-required live gate.
- A missing live dependency reports `blocked`, never `passed` or skipped success.
- A documentation-only change does not invalidate unrelated runtime proof.
- A changed test, fixture, build configuration, or provider target invalidates the proof it affects.
- Receipts remain compact and contain no raw private input or secret.

### Verification

- Table-driven path-impact tests.
- Proof invalidation tests for each input category.
- Redaction tests.
- Comparison against the current testing matrix for representative route, UI, provider, build, and documentation changes.

## Phase 4: Add canonical local capability adapters

### Work

- Add generation as a capability owned by the existing Python writer.
- Add curation as a capability owned by the loopback writer and focused publisher.
- Add planned-route persistence inspection without inventing a server-side source of truth for browser-local state.
- Add provider-readiness inspection through existing provider loaders and live checks where practical.
- Keep capability-specific plan schemas when a mutation needs owner review.

### Acceptance

- No canonical write bypasses its current owning writer.
- The unified interface does not import product logic from application surfaces.
- Curation failure preserves the existing recovery guarantees.
- Generation still stages and publishes both artifact tiers atomically.
- Browser-local planned routes are reported as a distinct runtime state, not folded into `quests.json`.
- Provider configuration presence is distinguishable from provider success.

### Verification

- Existing writer and recovery tests through the unified interface.
- Interface-level tests replace redundant wrapper tests where they prove the same behavior.
- No internal seam is exposed only to make testing convenient.

## Phase 5: Add release adapters

### Work

- Model route microsite publication and production application deployment as separate release targets.
- Require an immutable built artifact digest before release.
- Record explicit target, replacement intent, remote result, stable alias, and immutable deployment id.
- Re-inspect remote state after ambiguous failures.
- Add provider-specific live review requirements to release results without claiming headless proof of hardware rendering.

### Acceptance

- Release cannot rebuild a different artifact after approval without invalidating the plan.
- Production and route-share targets cannot be confused by a default branch.
- Existing stable aliases require exact replacement authority.
- Ambiguous remote failures block blind retries and trigger remote inspection.
- A successful release reports what is live and what remains unverified.

### Verification

- Deterministic Wrangler adapter tests.
- Existing deployment command tests.
- Authorized real Pages branch smoke for the release path.
- Hardware-accelerated browser evidence only when the claim includes Google 3D or terrain fidelity.

## Phase 6: Make accretion mechanical

### Work

- Generate a human capability index and command reference from the manifest.
- Validate that every capability links to current domain, ADR, workflow, and test authorities.
- Add a documented failure-promotion checklist to receipts.
- Add a stale-plan check based on status metadata and referenced paths.
- Add an unclassified-path report for files not owned by a capability.
- Add a deliberate command for promoting privacy-safe evidence into a committed report.

### Acceptance

- Adding a capability requires its manifest entry, owning module, interface tests, documentation link, and gate map in one change.
- Removing or renaming a command breaks the generated reference check.
- Repeated operational failures can be traced to the test or guidance that prevents recurrence.
- Canonical documents contain no live counts or one-run status claims.
- Run artifacts remain ignored unless deliberately promoted.

## Phase 7: Consolidate interfaces

### Work

- Measure which compatibility commands still have callers.
- Delete wrappers that no longer add behavior after parity is proven.
- Keep domain-focused commands when they remain the clearest direct interface for a human.
- Update ADR-0016 from `proposed` to `accepted` only when the unified interface has at least two real capability adapters and proves leverage.

### Acceptance

- The deletion test passes for the control module: removing it would force real coordination back into multiple callers.
- Every retained adapter varies in behavior or caller need; hypothetical seams are removed.
- The external interface remains five verbs even if internal implementations continue to evolve.
- Documentation and tests reference the retained interfaces only.

## Delivery order

The smallest coherent sequence is:

1. Phase 0 documentation topology.
2. Phase 1 read-only manifest and doctor.
3. Phase 2 route-share adapter and receipts.
4. Phase 3 impact-directed verification.
5. Phase 4 canonical local adapters.
6. Phase 5 release adapters.
7. Phase 6 accretion checks.
8. Phase 7 consolidation.

Do not start with mutation orchestration.
The read-only model must prove that the capability manifest accurately describes the current system before it is trusted to select or perform writes.

## Suggested ticket slices

1. Define and validate capability manifest schema.
2. Implement redacted `inspect system` result.
3. Implement read-only doctor checks.
4. Register route-share capability and equivalence tests.
5. Define evidence receipt schema and route-share receipt.
6. Implement path-to-capability impact explanation.
7. Implement proof fingerprint and invalidation.
8. Register generation capability.
9. Register curation capability.
10. Register route-share release target.
11. Register production release target.
12. Add documentation and stale-plan validation.
13. Audit and remove redundant wrappers.

Each ticket must declare its blocking predecessor, owning files, external effects, and verification evidence.

## Final done state

This plan is complete when an agent can begin in an unfamiliar clean worktree, run one read-only inspection, choose a capability from the returned transitions, carry an owner-approved change through the five-verb interface, run only the proof justified by the impact graph, release only when explicitly authorized, and hand back a compact result whose claims can be independently rechecked.
