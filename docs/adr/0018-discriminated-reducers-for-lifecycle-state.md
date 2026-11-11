---
status: accepted
date: 2026-11-10
supersedes: none
---

# ADR-0018: Lifecycle state stays a discriminated reducer

## Context

[ADR-0016](0016-explicit-state-transitions-at-lifecycle-boundaries.md) already chose pure reducers for related lifecycle state, and left XState as a narrow exception. A later audit, recorded in [the lifecycle inventory](../architecture/state-machines.md), found 26 reducers already in the app and 10 lifecycles that were still implicit.

None of the remaining lifecycles is a hierarchy of invoked actors. The costly ones are a shared route fetch, the Replay renderer choice, and the admin classification worker. A library would add a dependency and a second way to read the same transitions.

## Decision

Keep modeling a lifecycle as a discriminated union plus a pure reducer. Do not add XState or another state-machine library.

The reducer is the transition table. It returns the same state for an event the current phase cannot accept. The component, hook, or worker owns IO. A behavior change is a separate commit from the extraction.

This confirms ADR-0016. It does not replace the exception in that record. A future machine still needs a new ADR before it may take a dependency, and that ADR has to show that the machine is the lifecycle owner.

## Consequences

Agents and reviewers can test a transition without rendering the app or calling a provider. Illegal combinations such as a loading route that also carries another route's payload are absent from the type.

The cost is a module and an event union for each lifecycle that earns one. A boolean, a disclosure, or a URL parameter does not earn one. Render-time updates, used when a prop must change the phase before paint, are part of the adapter and need a test that names the frame they protect.

The admin classifier now refuses a second start. Replay drops a remembered Atlas fallback in the same render as the URL or route change. Both are called out in the inventory.

## Evidence

- [Lifecycle inventory](../architecture/state-machines.md)
- [Route detail load](../../app/src/data/route-detail-state.ts)
- [Replay surface choice](../../app/src/surfaces/replay/playback/replay-surface-state.ts)
- [Admin classifier](../../admin_classify.py)
