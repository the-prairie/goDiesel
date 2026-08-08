---
status: superseded
date: 2026-06-13
superseded-by: ADR-0009
deciders: owner
---

# ADR-0005: Photorealistic 3D replay via Cesium and 3D Tiles

## Status

**Superseded by ADR-0009** for immersive replay. Still accepted for the Atlas
regional world (ADR-0006).

## Context

The prototype replayed routes on a 2D map. The open question was whether a real
photorealistic Earth was reachable at all. A spike probed
`https://tile.googleapis.com/v1/3dtiles/root.json` and recorded `HTTP/2 200` with
`asset.version: 1.0`:

> That means the next prototype can be a real Earth-style route viewer, not a
> fake terrain-map approximation.

Two options were weighed. Option A: Google Maps JavaScript 3D Maps. Option B:
Google Photorealistic 3D Tiles rendered with CesiumJS.

## Decision

Choose Option B, Cesium with Photorealistic 3D Tiles, because it offered direct
control over camera, route geometry draping, and terrain sampling.

Introduce it as a lab first, behind `?lab=earth`, on the principle that
"Earth is a lab mode first" and "route truth beats visual embellishment".
Demote Street View to at most an optional windshield layer.

## Consequences

- Earth Replay graduated from lab to default desktop replay on 2026-06-15 after a
  scorecard across all 66 approved routes: 54 Magical, 12 Useful, 0 Weak, with
  66/66 reaching Earth-ready and zero partial tile reports. The stated threshold
  had been 16 or more Magical or Useful.
- Cesium brought real machinery that is still in use: ground-clamped route
  polylines classified against the 3D tileset, throttled terrain height
  sampling, tile-failure thresholds, and blank-canvas pixel probes.
- Cesium also brought its weight: a roughly 5.5 MB lazy chunk, and a large
  amount of imperative lifecycle code duplicated across four mount sites.
- For immersive replay this decision was reversed; see ADR-0009.

## Evidence

- `docs/spikes/2026-06-13-google-earth-route-navigation.md`
- `docs/brainstorms/2026-06-13-earth-replay-lab-requirements.md`
- `docs/plans/2026-06-13-001-feat-earth-replay-lab-plan.md`
- `docs/dogfood-reports/2026-06-15-earth-replay-scorecard.md`
- `app/src/replay/cesium/cesium-replay-engine.ts`
