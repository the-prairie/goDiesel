---
status: accepted
date: 2026-08-08
deciders: owner
---

# ADR-0014: app/src is organised by surface, with labs separated

## Context

`app/src` had grown to 147 files across ten top-level folders whose names no
longer described their contents. A full import-graph audit found that the
architecture was sound — the dependency direction was already layered — but the
structure hid it:

- The Atlas world was split across `atlas/` and `components/globe/`, which
  imported each other. The port lived under `components/`, its implementation
  under `atlas/`.
- `replay/` had two competing organising axes and an eight-file residue, and
  `replay/atlas/` collided by name with the Atlas surface.
- `components/` mixed design-system primitives, application chrome, feature UI,
  and two modules that were not components at all.
- `domain/` mixed the core contract, derived geometry, single-surface feature
  logic, and lab experiments.
- Changing one surface meant opening up to five top-level folders.
- Labs sat beside production code, and the boundary had already eroded twice.

## Decision

Organise `app/src` into seven top-level folders:

| Folder | Charter |
| --- | --- |
| `app/` | How the application boots, routes, and frames itself. |
| `domain/` | The route model and pure derivation. No React, no IO. |
| `data/` | Reading route data and holding client state. |
| `providers/` | Third-party renderer plumbing shared by more than one surface. |
| `surfaces/` | The five surfaces of `CONTEXT.md` §6: atlas, routes, replay, finder, admin. |
| `labs/` | Experiments with no production commitment (ADR-0008). |
| `ui/` | Design system primitives and components shared by more than one surface. |

Use the word **surface**, not "feature", because `CONTEXT.md` §6 already
establishes it and `docs/agents/domain.md` forbids synonyms for established
terms. Keep the maximum depth at four segments below `src`.

Enforce the boundaries with `app/src/structure.test.ts` rather than convention.

## Consequences

- The tree mirrors the documented product model, so a reader of `CONTEXT.md`
  can predict the layout.
- Work on one surface touches one folder.
- Both import cycles and both layering violations are gone. The renderer port is
  separate from its factory, grounding is production code rather than a lab
  import, and the Atlas surface no longer depends on the Replay folder.
- Three structural invariants are now tested, so they cannot silently rot.
  Invariant 11 needs one exemption: `app/router.tsx` is the composition root and
  must import every lab page to build the route table.
- The guard found four placement errors during the migration itself, including a
  domain module that had been misfiled as Finder-only.
- Two filename couplings survive and are documented in `CONTEXT.md` and in the
  reorganization plan: the lazy chunk basenames `replay-page` and
  `route-detail-page` that `check-bundle-budget.mjs` asserts, and the 16
  `app/src` paths that `test_react_app.py` reads as text.
- `app/src/data/generated/` deliberately did not move. Moving it would touch
  `build.py`, `vite.config.ts` and two Python verifiers, and has a silent
  failure mode that would weaken the ADR-0011 microsite guarantee.

## Evidence

- `PROPOSED_CODE_FILE_REORGANIZATION_PLAN.md`
- `app/src/structure.test.ts`
- The migration commits from `refactor(labs)` to
  `test(app): enforce the new structure`, each verified independently.
