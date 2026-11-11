# Agent Instructions

## Agent skills

### Issue tracker

Issues are tracked in the personal GitHub repository `the-prairie/goDiesel`.
External pull requests are not a triage surface.
See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.
See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using root `CONTEXT.md` and system-wide ADRs under `docs/adr/`.
See `docs/agents/domain.md`.

### Testing

Use risk-based verification.

Do not run the complete release suite after every change or ticket.

Run focused tests while implementing.

Run the ticket gate once before merge.

Run live-provider tests only for provider, terrain, imagery, or camera changes.

Run the complete release gate only for production cutover or changes to shared application infrastructure.

A successful gate remains valid unless subsequent edits touch behavior covered by that gate.

See `docs/agents/testing.md` for the verification matrix and commands.

### State management

Model a lifecycle as a discriminated union and a pure reducer. Do not add a state-machine library.

Use pure reducers for coordinated lifecycle state and preserve existing behavior
through characterization tests. Keep IO in the owning component, hook, or engine.
A boolean, a disclosure, or a URL parameter stays local.
Follow `docs/adr/0016-explicit-state-transitions-at-lifecycle-boundaries.md`
and `docs/adr/0018-discriminated-reducers-for-lifecycle-state.md`.
The inventory is `docs/architecture/state-machines.md`.
