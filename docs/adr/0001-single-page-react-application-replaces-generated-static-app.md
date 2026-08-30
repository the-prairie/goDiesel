---
status: accepted
date: 2026-06-21
deciders: owner
supersedes: none
---

# ADR-0001: A React application replaces the generated static app

## Status

Accepted. Deployment cut over on 2026-07-14 (`d59f2801`).

## Context

goDiesel began as a Python script that generated a single static `index.html`
(`55965ef0`, 2026-05-23). That prototype proved the product idea, but by
2026-06-21 the cost of change had become the binding constraint. The migration
brainstorm named the cause directly: the static prototype

> concentrated too much product, state, layout, and rendering logic inside
> `build.py`, making foundational UI work harder with each iteration.

Product direction also required things the static shell could not carry: a
globe-first home instead of a card gallery, and a clear separation between Atlas
(memories) and Finder (planning).

## Decision

Build the product as a React single-page application under `app/`, using
TypeScript, Vite, Tailwind, and shadcn/ui. Retain `build.py` as a data generator
only (see ADR-0003).

Port the existing Earth Replay behaviour before inventing new replay ideas. Keep
the static application deployable as a fallback until parity is reached. That
temporary fallback period ended after the 2026-07-14 production cutover.

## Consequences

- The React application is the canonical product and opens directly into Atlas.
- Presentation, state, and data generation are separated for the first time.
- The static application remains available only as repository history at the
  annotated tag `static-fallback-2026-07-14`; it is not a current deployable.
- Since 2026-08-29, `build.py` is a data-only generator. The superseded static
  HTML, CSS, JavaScript, route SVG, and share-card generation paths were removed
  after the fallback period expired.

## Evidence

- `docs/brainstorms/2026-06-21-godiesel-react-migration-requirements.md`
- `docs/plans/2026-06-21-feat-godiesel-react-migration-plan.md`
- `docs/plans/2026-07-12-globe-first-structural-implementation-plan.md` (Gate D)
- `117b5dac`, `99ceb78e`, `d59f2801`
