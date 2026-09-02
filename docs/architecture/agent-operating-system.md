---
status: partially-implemented
last_updated: 2026-09-02
decision: ADR-0016
---

# Agent Operating System

## 1. Purpose

This document designs goDiesel as one system that an agent can understand and control accurately with minimal context, commands, and external work.

The target is not more automation for its own sake.
The target is a system in which an agent can answer five questions before it acts:

1. What is true now?
2. What capability changes that state?
3. What authority does the requested change require?
4. What evidence will prove the intended result?
5. What durable knowledge should remain after the run?

An agent should not need to reconstruct these answers from repository archaeology on every task.
The system should expose them through a small interface backed by the existing domain model, writers, validators, tests, and provider adapters.

This is a control design for the existing goDiesel bounded context.
It is not a second domain model, a generic agent framework, or a reason to move product logic into orchestration code.

## Implementation status

| Capability | Status |
| --- | --- |
| Domain model, writer ownership, provenance, generated data tiers, and risk-based verification | Implemented |
| Route inspect, proposal, creation, preview, publication, and public smoke workflow | Implemented through `scripts/godiesel`; `scripts/route.sh` remains compatible |
| Five-verb operator vocabulary used by agent guidance | Implemented for route share, generation, owner curation, planned-route inspection, and provider readiness |
| Machine-readable capability manifest | Implemented in `system/capabilities.json` |
| Unified `scripts/godiesel` interface | System inspection, doctor, route share, generation, owner curation, planned-route inspection, and provider readiness implemented |
| Shared result envelope and evidence receipts | Route-share lineage plus generation, curation, and exact provider verification receipts implemented |
| Impact-directed proof selection and reuse | Manifest-owned selection, exact-command fingerprints, `verify --explain`, and guarded reuse implemented for canonical adapters |

Use `./scripts/godiesel inspect system --json` and `./scripts/godiesel doctor --json` for current read-only control-plane inspection.
Use the route-share commands in `docs/agents/route-share.md` and canonical local commands in `docs/agents/local-capabilities.md`.
Application release remains outside the unified release adapter until Phase 5.

## 2. Design objective

The ideal cold-start experience is:

```text
orient -> inspect -> plan -> apply -> verify -> release -> learn
```

Each transition has one observable input, one declared authority class, one result, and one proof state.
The same control interface serves a human at a terminal and an agent requesting structured output.

The system is agent-intuitive when its nouns match `CONTEXT.md`, its commands match real state transitions, and its errors say what remains safe to do.
It is agent-ergonomic when common work crosses one deep interface rather than requiring callers to coordinate implementation details.
It is agent-accretive when a run improves executable contracts, decision records, or focused guidance without accumulating unstructured narrative memory.

## 3. The abstraction tower

Each layer knows less implementation detail than the layer below it.
An upper layer may depend on the interface of a lower layer, but it must not duplicate the lower layer's rules.

| Layer | Responsibility | Current authority or target |
| --- | --- | --- |
| 1. Owner intent | Desired outcome and explicit authority for durable or external effects | Owner request |
| 2. Product semantics | Domain language, provenance, lifecycle, and product invariants | `CONTEXT.md`, `PRODUCT.md`, `STRATEGY.md` |
| 3. Architecture policy | Durable decisions about writers, data tiers, renderers, privacy, and verification | Accepted ADRs |
| 4. Capability model | What the system can inspect or change, required inputs, effects, gates, and artifacts | `system/capabilities.json` |
| 5. Control interface | The small set of verbs an operator learns | Current read-only inspection plus target `inspect`, `plan`, `apply`, `verify`, `release` interface |
| 6. Capability modules | Deep implementations for route intake, curation, generation, preview, replay, and publication | Existing Python, TypeScript, shell, and Node modules |
| 7. Adapters | Filesystem, Strava export, browser, Google, MapLibre, Earth Engine, and Cloudflare integrations | Existing provider and command adapters |
| 8. State and evidence | Canonical source, generated projections, runtime state, external state, and run receipts | Existing state plus target receipts |

The control interface is deliberately small.
Its implementation can remain internally composed, but callers should not have to know which language, script, server, provider, or test runner performs the work.

## 4. The control interface

The target external seam has five verbs:

| Verb | Contract | Durable effects allowed |
| --- | --- | --- |
| `inspect` | Return current state, health, authority requirements, and available next transitions | None |
| `plan` | Validate intent and produce a reviewable, fingerprinted plan | Ignored staging only |
| `apply` | Apply one approved plan to canonical local state atomically | Canonical repository or owner state, never external publication |
| `verify` | Prove selected invariants and behavior against the resulting state | Local and ephemeral test effects only |
| `release` | Publish one verified artifact to one named external target | Explicitly authorized external effects |

These verbs describe state transitions rather than implementation tools.
They are not synonyms for every existing command.

The route-share workflow is the first strong vertical slice of this model:

| Target verb | Current route command |
| --- | --- |
| `inspect` | `./scripts/route.sh status` |
| `plan` | `./scripts/route.sh propose --request ...` |
| `apply` | `./scripts/route.sh create --proposal ...` |
| `verify` | `./scripts/route.sh check ...` and `preview ...` |
| `release` | `./scripts/route.sh publish ...` |

That workflow should be generalized, not bypassed or wrapped in another shallow command layer.
During migration, the unified control interface delegates to existing modules and preserves their validation and recovery behavior.

Phase 4 adds three more operator shapes without creating a generic executor.
Route generation delegates to the sole full-catalogue Python writer.
Owner curation produces a fingerprinted plan and calls the same owner-writer service as the loopback HTTP endpoint.
Planned-route inspection reports browser-local ownership and unknown current state instead of projecting it into canonical files.
Provider readiness separates configuration presence from one explicitly selected live check against one exact target.

## 5. Capability manifest

The system has one machine-readable capability manifest whose closed contract is published in `system/capabilities.schema.json`.
The dependency-free runtime enforces the same fields, enums, and per-verb relationships before exposing capability data.
The manifest describes operator knowledge, not domain truth.
It points to domain modules and commands rather than restating their rules.

Each capability entry declares:

- a stable capability id;
- the domain entity and state transition it owns;
- its accepted control verbs;
- required and optional inputs;
- files, external systems, and secrets it reads;
- local and external effects it may produce;
- its authority class;
- preconditions and conflict checks;
- idempotency and recovery behavior;
- affected invariants;
- focused, ticket, release, and live verification gates;
- result and evidence artifact schemas;
- relevant `CONTEXT.md`, ADR, workflow, and plan links.

An illustrative entry is:

```json
{
  "id": "route-share",
  "entity": "route",
  "verbs": ["inspect", "plan", "apply", "verify", "release"],
  "authority": {
    "apply": "canonical-local",
    "release": "external-durable"
  },
  "reads": ["quests.json", "route_sources/**"],
  "writes": [
    "quests.json",
    "route_sources/imported/**",
    "app/src/data/generated/**",
    "app/public/data/routes/**"
  ],
  "external_effects": ["cloudflare-pages-branch"],
  "plan_schema": "route_create.schema.json#/$defs/proposal",
  "result_schema": "route-share-creation-report",
  "invariants": [
    "source-truth",
    "stable-route-identity",
    "single-route-microsite"
  ],
  "verification": {
    "focused": ["python-route-create", "single-route-microsite"],
    "live": ["public-microsite-smoke"]
  }
}
```

This is an abbreviated example of the implemented schema.
The checked-in manifest is descriptive and cannot invoke its declared write or release commands.

The manifest should generate or validate task indexes, command help, and verification routing.
It must never generate `CONTEXT.md` or ADR decisions.

## 6. State model

An agent must be able to distinguish five kinds of state.

| State | Examples | Rule |
| --- | --- | --- |
| External source | Private Strava export, supplied GPX, provider responses | Read and fingerprint; never silently rewrite |
| Canonical authored state | `quests.json`, durable source files, owner curation | Change only through the owning writer or an approved plan |
| Generated projection | Route manifest, route details, deployable bundle | Rebuild from canonical state; never hand edit |
| Runtime and external state | Browser state, local server, Cloudflare deployment, provider availability | Re-inspect before claiming current status |
| Evidence state | Proposals, creation reports, test results, screenshots, deployment ids | Tie to inputs and commit; do not confuse with canonical product state |

The source of truth is chosen per fact, not per file extension or tool.
For example, a GPX source owns recorded geometry, `quests.json` owns curation, `build.py` owns generated projections, and Cloudflare owns whether a deployment currently resolves.

Dynamic state must be queried.
Counts, health, credentials, branch status, provider availability, and deployment status should not be maintained as prose facts in canonical documents.

## 7. Authority model

Every capability verb declares one authority class before execution.

| Class | Meaning | Default behavior |
| --- | --- | --- |
| `read-only` | Read local or external state without changing it | Proceed when in scope |
| `ephemeral-local` | Write ignored staging, caches, previews, or test artifacts | Proceed and report cleanup or persistence |
| `canonical-local` | Change tracked source, owner state, or generated projections | Requires a user request that clearly authorizes the change |
| `external-durable` | Publish, deploy, send, or mutate a remote system | Requires explicit authorization for the exact target and effect |
| `destructive` | Delete, overwrite, roll back, or replace difficult-to-recover state | Resolve exact targets and obtain explicit authorization |

Approval is attached to a specific plan digest, target, and effect.
Approval to create is not approval to publish.
Approval to publish a new target is not approval to replace an existing stable target.

The interface must report the next required authority checkpoint instead of merely failing with a generic permission error.

## 8. Plan contract

A plan is a durable, reviewable description of one intended transition.
It contains normalized inputs, observations, intended writes, external effects, warnings, blockers, verification requirements, and a digest.

A plan must be:

- closed against unknown fields;
- deterministic for the same observed state;
- redacted by construction;
- invalidated when relevant source state changes;
- idempotent when safely reapplied;
- explicit about facts, derivations, hypotheses, and owner choices;
- independent from a public name or mutable display title when identity requires stability.

The existing route-share proposal demonstrates this contract.
Future write capabilities should reuse the pattern while retaining their own domain-specific schemas.

## 9. Result and receipt contract

Every command returns a result.
A result states what happened in the command's own domain.

Every multi-step run may additionally produce an evidence receipt.
A receipt composes results without becoming a new source of product truth.
Phase 2 implements narrower route-transition receipts for proposal-specific lineage and release evidence.
Phase 3 adds the system-wide receipt contract, manifest-owned impact selection, complete covered-input fingerprints, and guarded route verification reuse.
Other capabilities begin emitting and reusing these receipts only when their canonical adapters are implemented.

A receipt records:

- run id and capability id;
- verb and authority class;
- repository commit and relevant dirty-state fingerprint;
- input, plan, and output digests;
- start and finish timestamps;
- normalized status: `passed`, `failed`, `blocked`, or `not_run`;
- executed gates and their observable outcomes;
- warnings and named degradation;
- external target, immutable deployment id, and stable alias when applicable;
- recovery paths and safe next actions;
- redacted configuration presence, never secret values.

Human-readable output is a projection of the structured result.
Progress belongs on standard error and machine output belongs on standard output.
A parseable command must never mix narration into its result stream.

Receipts live under an ignored run-artifact directory by default.
Only deliberately curated, privacy-safe evidence is committed.

## 10. Verification as an impact graph

Verification selection should be derived from capabilities and invariants, not memory or a fixed maximal suite.

```text
changed paths
    -> affected capability modules
    -> affected interfaces and invariants
    -> focused tests
    -> ticket gate
    -> live or release gate when required
```

The capability manifest owns this mapping.
Each impact rule links paths to capability-owned invariant identifiers as well as to focused, ticket, release, or live gates.
Impact rules select required gates from changed paths.
Each exact gate command separately declares its proof inputs, so its reusable fingerprint includes all of that command's implementation and runtime dependencies without causing those dependencies to select unrelated commands.
When a tier has multiple provider commands, those same inputs select only commands covering a known changed path; if no command recognizes a classified provider path, selection expands to every command in that tier.
The command recorded in evidence and the command-specific proof inputs included in the reusable fingerprint come from the same manifest declaration.
The existing risk tiers in `docs/agents/testing.md` remain the policy.

A proof is reusable only while all covered inputs remain unchanged:

- implementation paths;
- contract and schema paths;
- fixture and test paths;
- build and runtime configuration;
- file type, executable mode, and symlink target for covered files;
- provider target when the proof is live;
- canonical data fingerprints when the proof covers real data.

A changed documentation file does not invalidate a runtime proof unless it changes an executable contract or command.
A provider-dependent claim is never proven by a deterministic test adapter.
A missing live dependency produces `blocked`, never a skipped green result.
Live-provider proof is reusable for at most 15 minutes and only against the same target and configuration-presence state.

## 11. Knowledge topology

Accretion requires putting each fact in exactly one durable place.

| Knowledge | Durable home |
| --- | --- |
| Domain noun or invariant | `CONTEXT.md` |
| Product purpose or direction | `PRODUCT.md` and `STRATEGY.md` |
| Visual and interaction rule | `app/DESIGN.md` |
| Architecture decision and consequences | ADR |
| Current system mechanics | `docs/architecture/` |
| Focused operating procedure | `docs/agents/` |
| Future work, order, and acceptance | Current plan under `docs/plans/` |
| Executable behavior | Code, schema, and tests |
| One run's observations | Result and evidence receipt |
| Live status | Read-only inspection output |

The following promotion rules prevent memory sprawl:

- A new domain ambiguity becomes a domain-modeling gap.
- A durable choice becomes an ADR.
- A repeated operational failure becomes a focused test and a workflow correction.
- A missing capability becomes plan work.
- A one-off observation remains in its receipt.
- Dynamic counts and current external state are never promoted into canonical prose.

An agent should update the narrowest authoritative artifact.
It should not append general notes to multiple files in case one is later discovered.

## 12. Current system assessment

### Existing strengths

goDiesel already contains several deep modules and strong system properties:

- `build.py` and its extracted Python modules form the only route-data writer.
- The two-tier generated data contract isolates fast, lenient summaries from strict route details.
- The TypeScript route domain isolates generated `snake_case` from application `camelCase`.
- Provenance and named degradation prevent plausible rendering from becoming source truth.
- The loopback curation writer owns validation, atomic publication, and recovery.
- The route-share proposal protects identity, media ownership, lifecycle evidence, idempotency, and publication authority.
- Build-time microsite scoping creates a real privacy property rather than a navigation convention.
- Risk-based verification already distinguishes deterministic, live-provider, and full-pipeline evidence.
- The application folder structure mirrors the five product surfaces and enforces dependency direction.

### Operator friction

The remaining friction is mostly in the mutation, proof, and release layers:

- The inspector provides one capability map, while focused guides remain necessary for domain-specific owner decisions.
- Route sharing, curation, generation, planned-route ownership, provider readiness, and evidence use the unified interface; application deployment still uses a separate release path.
- Local capability commands return the shared result envelope, while older compatibility paths retain their existing human output.
- Verification selection and reuse are manifest-owned, but application release does not yet enforce the shared receipt contract.
- The doctor proves route identity inventory and configuration presence, while explicit capability commands own generation and live-provider checks.
- The doctor checks architecture and plan indexes mechanically, but semantic contradictions between documents still require review.
- External deployments have good smoke tests but no shared receipt contract across release types.

These are leverage problems at the operator interface.
They do not justify replacing the proven domain implementations.

## 13. Resource discipline

The control system should minimize work in this order:

1. Read manifest metadata and Git state before source records.
2. Compare hashes and generated inventories before parsing full geometry.
3. Load route summaries before route details.
4. Run focused pure tests before browsers.
5. Run deterministic browsers before live providers.
6. Reuse a valid proof when its covered inputs are unchanged.
7. Start local servers only for the duration of the evidence they provide.
8. Contact external providers only when the result depends on them.
9. Deploy only an immutable artifact that has already passed its applicable local gates.
10. Retain compact receipts and discard regenerable bulk output.

An optimization that weakens provenance, approval, isolation, or recovery is not a resource improvement.

## 14. Failure and recovery model

Errors should use stable categories:

| Category | Meaning | Safe response |
| --- | --- | --- |
| `input` | The request or supplied artifact is invalid | Correct the input and re-plan |
| `configuration` | Required local configuration is absent or unsafe | Repair configuration without changing product state |
| `precondition` | Canonical state is not ready for the transition | Inspect the named blocker |
| `conflict` | State changed after planning or identity collides | Re-inspect and produce a new plan |
| `effect` | A write failed before commitment | Use reported recovery state; do not guess |
| `verification` | The applied state does not satisfy its gate | Keep release blocked and diagnose the failed invariant |
| `external` | A provider or remote target failed or is unknown | Re-inspect remote state before retrying |

Every failed write reports whether canonical state is unchanged, committed, partially committed with recovery, or externally unknown.
The system must never advise a blind retry when an external effect may already have occurred.

## 15. Worktree and concurrency model

The operator begins by inspecting repository, branch, worktree, and generated-state status.
Unrelated local changes are preserved.

A new worktree is preferred when the primary checkout is dirty, the task is long-lived, or generated outputs could overlap another task.
The plan and receipt identify the worktree and commit they apply to.

Canonical writers use atomic publication and capability-specific locks where concurrent execution could corrupt state.
The Admin service and unified route creation, generation, and curation commands share one cross-process lock for every mutation of the owner-owned route catalogue or its generated projections.
The control layer does not invent a global lock unless two real writers compete for the same state.

## 16. System invariants

The agent operating system must preserve these invariants:

1. There is one goDiesel domain model.
2. The control layer never redefines route semantics.
3. Every capability has one external interface and one owning module.
4. Every durable effect has a declared authority class before execution.
5. Every write is atomic, idempotent, or paired with explicit recovery state.
6. Every result distinguishes fact, derivation, hypothesis, and unknown state where those concepts apply.
7. Every release identifies its exact target and immutable artifact.
8. Every proof names what it covered and what remains unproven.
9. Tests exercise the same interface used by callers.
10. Internal seams stay internal unless two real adapters justify exposing them.
11. Secrets and private route values never enter command transcripts, receipts, or committed evidence.
12. Dynamic state is inspected rather than documented as current truth.
13. A new wrapper must remove caller complexity or it is not a module worth adding.
14. A successful run leaves the system no harder to understand than it found it.

## 17. Success criteria

The target system is successful when:

- a cold-start agent can identify the relevant capability, authority, and verification path from one inspection result;
- the common path from request to verified local result uses no more than the five control verbs;
- no canonical write requires an agent to coordinate multiple implementation scripts manually;
- a release cannot occur without a named verified artifact and explicit target authority;
- a failed run reports a safe next action and recoverability state;
- focused verification is selected from impact metadata and remains reusable while its input fingerprint is valid;
- architecture, workflow, and plan indexes are mechanically checked for drift;
- repeated failures reduce future work by becoming executable tests or narrower guidance;
- committed documentation contains durable knowledge rather than run transcripts;
- the control layer remains substantially smaller than the capability implementations behind it.

## 18. Non-goals

Do not build:

- an autonomous publishing daemon;
- a second database or event store for repository state;
- a generic workflow engine;
- an agent-specific copy of the route model;
- a universal provider interface where only one adapter exists;
- a durable memory dump of conversations or terminal logs;
- a dashboard that merely restates command output;
- a test selector that can silently omit required live evidence;
- a wrapper that hides actionable errors or bypasses existing guards.

The implementation plan is [2026-08-31 Agent Operating System Plan](../plans/2026-08-31-agent-operating-system-plan.md).
