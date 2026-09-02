# Agent Instructions

## Start here

goDiesel is one bounded context with one route model.

Before changing the system:

1. Inspect Git branch, worktree, and dirty state.
2. Read root `CONTEXT.md` for domain language and invariants.
3. Read [the architecture map](docs/architecture/README.md) and relevant accepted ADRs.
4. Read only the focused workflow and implementation area needed for the task.
5. Identify the requested effect, required authority, and proof before writing.

Do not treat plans, screenshots, generated data, terminal output, or remembered external state as current authority.
Query dynamic state and preserve unrelated work.

## Operator loop

Use the accepted unified control model from ADR-0016 for every implemented capability:

```text
orient -> inspect -> plan -> apply -> verify -> release -> learn
```

- **Orient:** Resolve repository, worktree, branch, domain terms, and relevant decisions.
- **Inspect:** Read current local or external state without changing it.
- **Plan:** Make intended writes, assumptions, authority checkpoints, and proof explicit.
- **Apply:** Use the owning writer or workflow; do not hand-edit generated projections.
- **Verify:** Run the smallest gate that proves the affected interfaces and invariants.
- **Release:** Act only with explicit authority for the exact external target and replacement effect.
- **Learn:** Promote only durable knowledge to the narrowest authoritative document or test.

## Task router

| Task | Start with | Owning interface today |
| --- | --- | --- |
| Orient to repository and capability health | `./scripts/godiesel inspect system --json` | Read-only capability manifest and doctor |
| Diagnose local agent readiness | `./scripts/godiesel doctor --json` | Read-only capability manifest and doctor |
| Understand product language or invariants | `CONTEXT.md`, relevant ADR | Domain modules and tests |
| Inspect route or atlas readiness | `docs/agents/route-share.md` | `./scripts/route.sh status [slug]` |
| Create, update, preview, or publish a route share | `docs/agents/route-share.md` | `./scripts/route.sh` |
| Curate owner guide content | `docs/agents/local-capabilities.md`, ADR-0010 | `./scripts/godiesel` and the shared local owner writer |
| Change generated route data | `docs/agents/local-capabilities.md`, ADR-0003 and ADR-0004 | `./scripts/godiesel` over `rebuild.sh` / `build.py` |
| Inspect planned-route persistence | `docs/agents/local-capabilities.md` | Browser-local storage metadata through `./scripts/godiesel` |
| Change Atlas, Finder, Routes, Replay, or Admin | `CONTEXT.md` section 6, `app/DESIGN.md` | Owning folder under `app/src/surfaces/` |
| Change route contract or derivation | `app/src/domain/route/`, relevant ADR | Pure domain interface and its tests |
| Change provider, terrain, imagery, or camera behavior | `docs/agents/local-capabilities.md`, ADR-0006, ADR-0007, ADR-0009 | Provider or renderer interface plus named live gate |
| Change deployment or public artifact scoping | ADR-0011 and ADR-0012 | `make-dist.sh`, scoped publisher, smoke tests |
| Select verification | `docs/agents/testing.md` | Focused, ticket, release, or live gate |
| Triage repository work | `docs/agents/issue-tracker.md` | `the-prairie/goDiesel` issues |
| Change the agent operating model | `docs/architecture/agent-operating-system.md` | Manifest-driven control module, ADR-0016, and current plan |

## Authority

Read-only inspection may proceed when it is in scope.
Ignored staging, local previews, and test artifacts are ephemeral local effects.
Tracked source changes require a user request that clearly authorizes the change.
Deployment, publication, replacement of a stable alias, or another remote mutation requires explicit authority for that target.
Destructive or difficult-to-recover actions require exact resolved targets and explicit approval.

Creation approval is not publication approval.
Publication approval for a new target is not replacement approval for an existing target.

## State ownership

- Private activity exports and supplied files are external source state.
- `quests.json` and `route_sources/` are canonical authored route state.
- `build.py` is the only writer of generated route projections.
- `app/src/data/generated/` and `app/public/data/routes/` are generated projections, never hand-edited sources.
- Provider and deployment status is external runtime state and must be rechecked.
- Proposals, reports, screenshots, and test artifacts are evidence, not product truth.

## Documentation

Use `docs/agents/domain.md` to place knowledge correctly.

- Domain language and invariants belong in `CONTEXT.md`.
- Durable architecture decisions belong in ADRs.
- Current mechanics belong in `docs/architecture/`.
- Focused procedures belong in `docs/agents/`.
- Future work belongs in the current plan under `docs/plans/`.
- One run's observations belong in its result or evidence artifact.
- Dynamic counts and live status never belong in canonical prose.

## Issue tracker

Issues are tracked in the personal GitHub repository `the-prairie/goDiesel`.
External pull requests are not a triage surface.
Use the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`.
See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## Verification

Use risk-based verification.
Run focused tests while implementing, the ticket gate once before merge, and live-provider tests only when the result depends on providers, terrain, imagery, or cameras.
Run the complete release gate only for production cutover or shared application infrastructure.

A successful proof remains valid only while its covered implementation, contracts, fixtures, configuration, data, and provider target remain unchanged.
Missing live evidence is `blocked`, never skipped success.

See `docs/agents/testing.md` for the verification matrix, evidence contract, and commands.
