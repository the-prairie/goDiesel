---
status: accepted
date: 2026-07-12
deciders: owner
---

# ADR-0004: Two-tier route data, lenient summaries and strict details

## Context

Every surface needs some data about all routes: the Atlas globe must draw 67
route threads, and the Routes library must list and filter them. Only one surface
at a time needs full fidelity: a route's guide, and its replay, need the complete
recorded trace, provenance, and curation.

Shipping full geometry for all routes in the initial bundle is not viable. The
full generated set is 4.3 MB, against a tested 500 KiB budget for the initial
shell.

A second, subtler problem: a single malformed route record should not be able to
blank the entire application.

## Decision

Generate two artifacts from one source of truth.

- **Summaries** — `routes.manifest.json`, bundled and imported eagerly. Geometry
  is simplified to at most 96 tuple points per route, enough to draw a
  recognisable thread. Curation is reduced to a `guide_preview`.
- **Details** — `app/public/data/routes/<slug>.json`, fetched lazily per route
  and byte-identical to its element of the generated set.

Parse the two tiers with deliberately different strictness:

- `parseRouteSummary` is **lenient**. It falls back on bad scalar fields and does
  not throw. A bad manifest entry degrades one card, not the app.
- `parseRouteDetail` is **strict**. It throws on any contract violation, and the
  repository surfaces that as `{ status: "invalid", message }`.

## Consequences

- The initial shell stays inside budget while Atlas still renders every route.
- Replay and route detail are separately code-split, and the bundle budget test
  asserts that both remain lazy chunks and that Cesium and the Google
  photorealistic tileset never enter the entry chunk.
- Detail loading is deduplicated per slug, and only `error` results are evicted,
  so a transient network failure can be retried but a genuine contract violation
  is not retried in a loop.
- The strict tier is where the invariants in `CONTEXT.md` are actually enforced:
  monotonic distance and time, `kind`/`source` agreement, `bestInEarth` implying
  `earth`, closed curation schema, valid IANA timezones.
- Cost: the bundled manifest is about 496 KiB against a 500 KiB shell budget, so
  the budget is nearly exhausted by data. Additionally, a 4.3 MB
  `quests.generated.json` is committed under `app/src/data/` and is not imported
  by the application.

## Evidence

- `app/src/domain/routes.ts`, `app/src/data/route-repository.ts`,
  `app/src/data/use-route-detail.ts`
- `app/scripts/check-bundle-budget.mjs`
- `build.py` (`react_route_manifest_record`, `simplify_route_for_manifest`)
- `6b071504`
