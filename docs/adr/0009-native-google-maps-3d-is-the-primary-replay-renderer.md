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
  others. The owner chose 210 seconds on 2026-08-08; the constants are not yet
  unified.
- **The decision removed the terrain-clearance guarantee from the shipping path,
  and that was not recorded at the time.** Cesium samples photogrammetry height
  and can measure how far the camera sits above the surface. Google's `maps3d`
  runtime owns its camera and exposes no surface height, so the primary renderer
  had no such measurement and could not have one. Photorealistic 3D has no
  collision detection, so a camera that sinks into a building or hillside simply
  looks broken.

  Resolved on 2026-08-09 (`1f20ebd8`). Clearance no longer comes from a
  renderer. `route-scene-contract.ts` already placed the camera above a local
  terrain envelope derived from recorded elevation, scaling margin by relief,
  turn severity and grade; it now also publishes the resulting clearance and its
  floor, and the stage exposes them. Both terms are the product's own data, so
  the guarantee holds on whichever engine is mounted, and a unit test asserts it
  across four camera modes, three range scales and five points along a route
  with no browser involved.

  Honest limit: recorded elevation describes the route surface, not a hillside
  the camera may sit behind. The placement adds margin for that reason. It is a
  strong approximation, not a substitute for sampling the surface, and Cesium
  still reports its measured value where it can.

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

Partial evidence arrived on 2026-08-09. The live pipeline gate passed for the
first time, and all 23 hardware-backed live journeys passed against real
photorealistic imagery, including six Google route navigator cases. That
demonstrates the renderer works on the routes it was tested against. It is not
the scorecard: the 2026-06-15 Cesium scorecard rated all 66 approved routes for
experience quality, and no equivalent exists for Google.

## Evidence

- `docs/spikes/2026-07-22-native-google-3d-route-navigation.md`
- `3ed3afc8` (PR #100)
- `app/src/replay/google/google-route-navigator-engine.ts`,
  `app/src/pages/replay-page.tsx`
