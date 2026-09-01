---
status: proposed
date: 2026-08-31
deciders: owner
---

# ADR-0016: The agent control plane is manifest-driven

## Context

goDiesel has one coherent route domain and several strong deep modules, but the operator interface is uneven.
Route sharing now exposes a guarded state machine through `scripts/route.sh`, while curation, generation, provider checks, verification, and deployment still require an operator to compose several entry points and documents.

The repository already distinguishes canonical state, generated projections, runtime providers, and release evidence.
It also distinguishes creation approval from publication approval and deterministic verification from live-provider proof.
Those distinctions are correct but are not represented by one machine-readable capability model.

Adding more prose or more one-off wrapper scripts would increase discovery cost and create additional shallow interfaces.
Replacing the existing domain modules would discard proven validation, provenance, atomicity, and recovery behavior.

## Decision

Adopt a manifest-driven agent control plane with five external verbs: `inspect`, `plan`, `apply`, `verify`, and `release`.

The capability manifest will declare each capability's inputs, effects, authority class, invariants, verification gates, artifacts, recovery behavior, and documentation links.
It will reference the existing domain contracts rather than duplicate them.

The unified control interface will delegate to existing owning modules during migration.
The first adapter will be the existing route-share workflow.
Other adapters will be added only when the unified interface removes real caller coordination.

Commands will return structured results and may produce fingerprinted evidence receipts.
Human output will be a projection of the same result.

Proof validity will be tied to the implementation, configuration, data, and provider inputs it covers.
Dynamic state will be queried through read-only inspection rather than maintained in canonical prose.

Owner authority remains external to the control plane.
The control plane records and enforces the authority required for a plan or target, but it cannot manufacture approval.

## Consequences

- An agent can orient from one capability map instead of reconstructing the system from scripts and prose.
- The five verbs become a small external interface over deeper domain implementations.
- Existing route, curation, generation, provider, and release guards remain authoritative.
- Verification can become impact-directed without weakening the no-skip live gates.
- Run evidence becomes comparable across workflows and easier to invalidate correctly.
- Documentation indexes and command help can be checked against the capability manifest.
- The manifest and result schemas become new contracts that require versioning and tests.
- Migration temporarily retains old entry points as adapters, so there will be two invocation paths until parity is proven.
- A poorly designed manifest could become a second domain model; schema review must reject domain fields that belong in existing contracts.
- The control plane adds no value if it merely forwards arguments, so each migrated capability must pass the deletion test and remove caller coordination.

## Evidence

- `docs/architecture/agent-operating-system.md`
- `docs/plans/2026-08-31-agent-operating-system-plan.md`
- `scripts/route.sh`
- `route_create.py`
- `route_create.schema.json`
- `system/capabilities.schema.json`
- `system/capabilities.json`
- `godiesel_control.py`
- `test_godiesel_control.py`
- `docs/agents/route-share.md`
- `docs/agents/testing.md`
- ADR-0003, ADR-0010, ADR-0011, ADR-0012, and ADR-0015
