---
status: accepted
date: 2026-11-11
supersedes: none
---

# ADR-0019: Recovery dispositions, marker-file protocols, and a checked lifecycle registry

## Context

[ADR-0018](0018-discriminated-reducers-for-lifecycle-state.md) covers runtime lifecycles: a discriminated union and a pure reducer. Two other kinds of lifecycle turned up in the repository.

Crash recovery runs after a process died. It finds a generator backup or an owner journal on disk and decides what to do with it. There is no stream of events to reduce.

Release scripts run in order and can stop at any step. The dist build, the single-route share publish, and the live gate each need a record of how far they got that survives the process.

The prose inventory in `docs/architecture/state-machines.md` was written from one audit. It was wrong within a day: it listed converted lifecycles as implicit, described reducers that had changed, and left out everything outside `app/src`.

## Decision

Crash recovery uses a pure disposition function. `publication_disposition` in `publication_protocol.py` maps the observed markers and lock to one outcome. `build.py` and `owner_publication.py` both use it. Callers observe the disk, call the function, then act.

A script lifecycle is a marker-file protocol. The script writes the marker atomically and last, and a missing marker reads as a failure. `.dist-manifest.json`, the publish receipts under `.route-share/publish/`, and the live-gate `status.json` follow this rule.

The lifecycle inventory is `docs/architecture/lifecycles.json`, validated by `docs/architecture/lifecycles.schema.json`. `scripts/check-lifecycles.mjs` compares it with the code and runs inside `npm run typecheck`. The inventory tables in `state-machines.md` are generated from the registry.

## Consequences

A new `*-state.ts` module or exported reducer fails typechecking until it has a registry entry. A renamed transition, a deleted test, or a removed state name fails the same way.

The check reads the code with simple text patterns. It proves that names and paths exist and that a test mentions the transition. It does not prove that the test covers the behaviour, or that a listed state is reachable.

A lifecycle that is left implicit on purpose needs an entry with a reason. That costs a line of JSON, and it keeps the decision visible.

## Evidence

- [Lifecycle registry](../architecture/lifecycles.json) and [schema](../architecture/lifecycles.schema.json)
- [Registry check](../../scripts/check-lifecycles.mjs) and [its tests](../../test_check_lifecycles.py)
- [Publication disposition](../../publication_protocol.py) and [its tests](../../test_publication_protocol.py)
- [Dist manifest](../../scripts/dist-manifest.mjs), [share publish](../../scripts/publish-route-microsite.sh), and [live-gate status](../../scripts/live-gate-status.sh)
- [Decision log](../architecture/state-machine-decisions.tsv)
