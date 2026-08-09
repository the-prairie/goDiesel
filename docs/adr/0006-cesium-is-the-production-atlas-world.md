---
status: accepted
date: 2026-07-21
deciders: owner
---

# ADR-0006: Cesium is the production Atlas world; Three.js is retired

## Context

The globe-first Atlas was first built with a hand-rolled Three.js globe. The
spatial Atlas specification then required one continuous 3D scene with two camera
scales — a global globe and a regional view with real terrain — where
"the world remains the interface throughout the journey". A separate Three.js
globe could not become a terrain-accurate regional view.

## Decision

Use a single `AtlasWorldEngine` port with Cesium as the production
implementation, in two tiers:

- **Global** — the bundled Cesium Natural Earth II imagery with 96-point route
  threads. No provider credential, no network dependency.
- **Regional** — Google Photorealistic 3D Tiles with 384-point route geometry.

Ship it behind `VITE_ATLAS_WORLD_ENGINE=cesium` first, then make it
unconditional (`f9b84545`) and delete the Three.js globe.

## Consequences

- Three.js is gone: no dependency, no feature flag, no fallback path to it.
  `AtlasGlobe` is now a thin `Suspense` wrapper that lazily loads
  `CesiumAtlasGlobe`.
- The global tier renders with no API key at all, so the Atlas home works before
  any credential is configured.
- Six independent failure triggers collapse to one honest outcome; see ADR-0007.
- `sampleRegionalRoutePoints` returns nothing unless `geometryStatus === "ready"`,
  so provenance gates rendering here as elsewhere.
- Region framing is solved from the inset-adjusted usable viewport, and the same
  insets pad the MapLibre fallback, so composition survives the engine swap.

## Evidence

- `docs/plans/2026-07-20-spatial-atlas-region-exploration-spec.md`
  (`status: approved-design`; the reference PNG is treated as normative)
- `docs/dogfood-reports/2026-07-21-issue-86-cesium-atlas.md` (12,665 desktop and
  16,162 mobile canvas colours sampled to prove non-blank pixels)
- `docs/dogfood-reports/2026-07-21-issue-87-regional-terrain.md`
- `f9b84545`
- `app/src/components/globe/atlas-world.ts`, `app/src/atlas/cesium-atlas-world-engine.ts`
