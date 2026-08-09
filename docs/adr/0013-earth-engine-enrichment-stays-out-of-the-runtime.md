---
status: accepted
date: 2026-07-26
deciders: owner
---

# ADR-0013: Earth Engine enrichment stays out of the runtime

## Context

The route intelligence field test explored describing a route's character from
Earth observation data — land cover, elevation, annual satellite embeddings and
their year-over-year change, and surface reflectance — sampled at 48 points per
route and organised as a **Route Genome** with five evidence layers: recorded
truth, derived effort, Earth observation, narrative interpretation, and visual
artifacts.

This is genuinely useful for understanding a route. It is also a credentialed,
quota-bound, slow external dependency, and its outputs are interpretations rather
than recordings.

## Decision

> Earth Engine enriches route understanding without becoming a runtime
> dependency of Replay.

Run enrichment offline via `scripts/route_intelligence/earth_engine_enrich.py`
and commit its output as static data under
`app/public/data/route-intelligence/`. Do not leak temporary Earth Engine tile
URLs to the client.

Label every value as `recorded`, `derived`, `measured`, or `hypothesis`:

> The lab must label every value as recorded, derived, measured, or hypothesis.
> Editorial language must never silently become source truth.

Keep the surface a lab (`#/lab/route-intelligence`) per ADR-0008.

## Consequences

- Replay and Atlas never block on Earth Engine. A quota or credential problem
  cannot degrade the core product.
- The evidence labels became general vocabulary for the whole system; they are
  now recorded in `CONTEXT.md` section 4.
- `ea41e73c` exists specifically to enforce the labelling rule on derived
  signals.
- Enrichment is refreshed only when someone runs the script, so intelligence data
  can silently age relative to route data.
- The current `route-genome.ts` module is explicitly a prototype: it contains
  hardcoded per-activity-id hypotheses and fixed quarter chapters. It should not
  be mistaken for a general model.

## Evidence

- `docs/spikes/2026-07-21-route-intelligence-field-test.md`
- `scripts/route_intelligence/earth_engine_enrich.py`
- `app/src/domain/route-genome.ts`, `app/src/pages/route-intelligence-lab-page.tsx`
- `ea41e73c`
