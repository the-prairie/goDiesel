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

### Route shares

Use the proposal, owner-approval, creation, local-preview, and publication state machine in `docs/agents/route-share.md`.
Never infer route geometry or treat creation approval as publication approval.

### Testing

Use risk-based verification.

Do not run the complete release suite after every change or ticket.

Run focused tests while implementing.

Run the ticket gate once before merge.

Run live-provider tests only for provider, terrain, imagery, or camera changes.

Run the complete release gate only for production cutover or changes to shared application infrastructure.

A successful gate remains valid unless subsequent edits touch behavior covered by that gate.

See `docs/agents/testing.md` for the verification matrix and commands.
