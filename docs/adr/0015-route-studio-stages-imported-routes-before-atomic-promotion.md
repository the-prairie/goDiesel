---
status: accepted
date: 2026-08-22
---

# Route Studio stages imported routes before atomic promotion

## Context

goDiesel previously assumed that every stable route identity was a numeric Strava activity id and that imported source meant GPX.
An owner workflow for GPX, KML, and KMZ needs durable inspection and rendering state without letting unreviewed uploads enter canonical generated data.
It must preserve ADR-0003, the loopback-only writer in ADR-0010, strict detail parsing in ADR-0004, and the renderer boundaries in ADR-0009 and ADR-0014.

## Decision

Route Studio is a local owner-only Admin workflow backed by SQLite and a content-addressed immutable source store.
Uploads compile to strict staged route details through the same pure one-route compiler used by `build.py`.
Staged details are served only by the loopback API and parsed through the production strict parser.

Stable identity is generalized to a route id.
Existing Strava routes retain their numeric activity id and URLs unchanged.
Imported routes use a deterministic `route-<geometry fingerprint>` id and omit `activity_id`.
Source kind and source format are separate fields; legacy `imported-gpx` inputs remain compatible.

Promotion writes the canonical source, receipt, and route specification, invokes the atomic generator, verifies the generated public detail and manifest for public routes or verified public exclusion for private routes, then marks the job promoted.
Any failure restores `quests.json`, removes new canonical source metadata, preserves the staged job, and leaves the previously published atlas intact.

Future and reference routes use Preview language and cinematic timing.
Replay and owner-recorded timing require explicit owner completion and trustworthy source timestamps.
Local film export retains deterministic frame verification but does not grant or assert provider permission for public downloadable imagery.

## Consequences

The normal owner journey no longer needs manual `quests.json` edits, slug lookup, or terminal commands.
Original sources, jobs, decisions, renders, artifacts, errors, cancellation, retry, and promotion state survive restarts.
SQLite and source artifacts remain single-owner local state and are not suitable for a deployed multi-user service.
Private promoted routes intentionally remain absent from public generated detail data, so their canonical verification proves exclusion rather than public presence.
Stable imported identity follows geometry; a materially edited geometry becomes a new route identity.

## Evidence

- `route_studio.py` and `route_studio_store.py`
- `route_compiler.py` and `route_studio_compiler.py`
- `route_studio_importers.py`
- `app/src/data/studio-repository.ts`
- `app/e2e/route-studio.spec.ts`
- `test_route_studio.py`
