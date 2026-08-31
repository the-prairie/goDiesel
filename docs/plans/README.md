# Plans

Plans describe future work, order, acceptance, and verification.
They do not override `CONTEXT.md`, accepted ADRs, executable contracts, or live state.

## Current

| Plan | Status | Next decision |
| --- | --- | --- |
| [Agent Operating System](2026-08-31-agent-operating-system-plan.md) | Ready | Approve or revise the Phase 1 read-only experiment; keep ADR-0016 proposed until the interface proves leverage |

## Reference plans

The remaining dated plans in this directory preserve design and delivery history.
Treat them as reference unless an issue or current plan explicitly reactivates them.

- `2026-06-13-001-feat-earth-replay-lab-plan.md`
- `2026-06-21-feat-godiesel-react-migration-plan.md`
- `2026-07-12-globe-first-structural-implementation-plan.md`
- `2026-07-16-field-guide-design-system-plan.md`
- `2026-07-20-spatial-atlas-region-exploration-spec.md`
- `daydream-production-implementation.md`

Root `PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md` is implementation history for ADR-0014.
It is not a current repository reorganization instruction.

## Plan contract

A current plan must state:

- status and last update date;
- problem and desired outcome;
- current evidence and assumptions;
- explicit scope and non-goals;
- architecture decisions it depends on or proposes;
- phases small enough to verify independently;
- acceptance and evidence for every phase;
- authority checkpoints and external effects;
- rollback or recovery behavior where writes are involved;
- what becomes obsolete when the plan is complete.

When a plan completes, record the resulting decision in an ADR when appropriate and move durable vocabulary or invariants into `CONTEXT.md`.
Do not keep a completed plan alive by appending unrelated future work.
