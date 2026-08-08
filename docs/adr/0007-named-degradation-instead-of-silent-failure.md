---
status: accepted
date: 2026-07-21
deciders: owner
---

# ADR-0007: Named degradation instead of silent failure

## Context

Every immersive surface depends on third-party imagery that can fail in ways that
are invisible to ordinary error handling: a key restricted to another origin, an
exhausted quota, a browser with no hardware renderer, a tileset that returns some
tiles and not others, or a canvas that composites to a blank frame while the
renderer reports success.

The product's core promise is honesty about what it knows. A blank or half-loaded
photorealistic scene presented as a finished replay breaks that promise more
seriously than an explicit fallback does.

## Decision

Model fidelity as explicit state, and detect failure positively rather than
waiting for exceptions.

Replay status is exactly one of `loading`, `ready`, `partial`, `unavailable`,
each carrying a human `title` and `message`. `partial` means playback continues
with known gaps.

Detect failure with active probes, not just error events:

- Count tile failures and treat 8 or more within a 15-second window as degraded.
- Read back canvas pixels periodically; two consecutive blank readings are
  treated as degraded.
- Check WebGL availability and route point count before mounting at all.
- Wait for a positive readiness signal — Google's `gmp-steadychange` with
  `isSteady`, or a bounded wait for initial Cesium tiles.
- Surface a Google authentication failure as a specific, actionable message
  about the browser origin rather than a generic error.

Provide MapLibre with OpenFreeMap as the honest 2D floor. It needs no credential,
so it is always available as a destination.

## Consequences

- Six independent Atlas failure triggers converge on one `reportRegionalFallback`
  path, which stops the render loop and hands off to the MapLibre regional
  fallback with matching framing.
- Engines expose their state to the DOM (`data-camera-*`, `data-grounding-*`,
  `data-geometry-points`) which is what the live provider gates assert on.
- Known inconsistency: an 8-second initial-tile timeout reports **ready** with a
  softer message on the replay and cinematic paths, while the Atlas path treats
  the same timeout as a fallback trigger. These should agree.
- Known limitation: the downgrade from Google 3D to Cesium or Atlas is
  **manual** — the user chooses "Use Atlas", or a `?renderer=` parameter selects
  an engine. There is no automatic engine failover.

## Evidence

- `app/src/replay/replay-engine.ts` (`ReplayStatus`), `app/src/replay/replay-health.ts`
- `app/src/replay/cesium/cesium-replay-engine.ts`,
  `app/src/replay/google/google-maps-loader.ts`
- `app/src/components/globe/atlas-regional-fallback.tsx`
- `app/src/replay/atlas/maplibre-atlas-replay-engine.ts`
