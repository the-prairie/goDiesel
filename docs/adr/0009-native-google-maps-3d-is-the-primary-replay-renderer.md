---
status: accepted
date: 2026-08-01
supersedes: ADR-0005
deciders: owner
---

# ADR-0009: Native Google Maps 3D is the primary replay renderer

## Context

Cesium with Photorealistic 3D Tiles (ADR-0005) worked, but the integration was
heavy: camera control, route geometry, terrain sampling, and grounding all had to
be reconciled by hand between two runtimes — Cesium's scene and Google's
photogrammetry.

A spike evaluated Google's native `maps3d` library (`Map3DElement`,
`Polyline3DElement`) for the same narrow job and concluded:

> Native Google 3D Maps is substantially simpler than the Cesium integration for
> this narrow experience because camera and route geometry share the same
> provider runtime.

It also recorded honest limits: photogrammetry distortion at low altitude,
visible GPS drift near buildings, headless Chromium showing Google's
unsupported-3D state, and a local key that allows `http://localhost:8787` while
rejecting the equivalent `127.0.0.1` origin.

## Decision

Make the native Google `maps3d` engine the default renderer for Replay and for
the cinematic surfaces. Keep Cesium reachable at `?renderer=cesium` and MapLibre
at `?renderer=atlas`.

Use `RELATIVE_TO_MESH` as the default route placement with `CLAMP_TO_GROUND` as a
diagnostic fallback, and chase as the most legible default camera.

## Consequences

- Replay gains a genuine readiness signal: `gmp-steadychange` with `isSteady`
  means the photorealistic scene actually rendered, which is far stronger than
  counting loaded tiles.
- The engine port widened beyond `ReplayEngine` to include
  `setGrounding`, `setCinematicRoute`, and `setRouteReveal`, because the
  cinematic work needs them.
- Cesium is now legacy for replay but still production for the Atlas regional
  world (ADR-0006), so both stacks remain in the bundle.
- `CesiumCinematicRenderer` — with its custom grade shader, depth of field,
  bloom, and fog — is now imported type-only. The `CinematicLook` grading
  vocabulary is effectively dead on the shipping path. Either port the grading to
  the native renderer or delete it.
- Replay duration is 180 seconds in `replay-controller.ts` and
  `playable-earth-controller.ts` but 210 seconds in
  `google-route-navigator-controller.ts`. The primary path disagrees with the
  others.

## Process note

This decision **did not meet its own stated precondition**, and that is recorded
here deliberately. The spike recommended:

> Do not replace the existing replay yet… Run this implementation beside it until
> a broader route scorecard shows that the native world is usable across most of
> the atlas.

`3ed3afc8` promoted it to primary without such a scorecard; no corresponding
document exists in `docs/dogfood-reports/`. Compare ADR-0005, which was promoted
only after a 66-route scorecard, and ADR-0008, which was declined on evidence.

The outstanding obligation is a route scorecard for native Google 3D across the
atlas. Until it exists, this ADR is accepted on implementation but unproven at
the scale its own spike asked for.

## Evidence

- `docs/spikes/2026-07-22-native-google-3d-route-navigation.md`
- `3ed3afc8` (PR #100)
- `app/src/replay/google/google-route-navigator-engine.ts`,
  `app/src/pages/replay-page.tsx`
