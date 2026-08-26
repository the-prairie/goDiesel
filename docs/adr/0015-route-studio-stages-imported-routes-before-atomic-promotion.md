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
The local Export Inbox discovers direct-child files in configured owner folders, refuses symlinks and oversized sources, and imports eligible files through the existing checksum-addressed upload boundary.
GPX, KML, and KMZ are importable; FIT and FIT.GZ remain visible but blocked until their binary source-faithfulness contract is covered independently.

Stable identity is generalized to a route id.
Existing Strava routes retain their numeric activity id and URLs unchanged.
Imported routes use a deterministic `route-<geometry fingerprint>` id and omit `activity_id`.
Source kind and source format are separate fields; legacy `imported-gpx` inputs remain compatible.

Promotion writes the canonical source, receipt, and route specification, invokes the atomic generator, verifies the generated public detail and manifest for public routes or verified public exclusion for private routes, then marks the job promoted.
Any failure restores `quests.json`, removes new canonical source metadata, preserves the staged job, and leaves the previously published atlas intact.

Private promotion also writes an atomic source backup outside the ignored checkout under `GODIESEL_PRIVATE_ROUTE_SOURCE_ROOT`.
The route specification stores a relative backup key, the `private-durable-backup` policy, and a checksum of the canonical GPX.
The shared source adapter accepts the canonical checkout copy or the durable backup only when that checksum matches, so a clean checkout can recover locally and corruption fails closed.

Private promoted routes compile on demand into a loopback-only owner read model.
Completed owner routes join local Atlas memories and discovered owner routes feed Finder from their recorded metadata, replacing Finder's former fixed candidate list.
This local model is never written into public generated detail or manifest bundles.

Future and reference routes use Preview language and cinematic timing.
Replay and owner-recorded timing require explicit owner completion and trustworthy source timestamps.
Preview preserves third-party timestamps as provenance but never displays their elapsed time or pace.
Missing elevation remains unavailable through route compilation, mesh-relative camera placement, telemetry, and cinematic analysis.
Local film export retains deterministic frame verification but does not grant or assert provider permission for public downloadable imagery.

## Consequences

The normal owner journey no longer needs manual `quests.json` edits, slug lookup, or terminal commands.
Downloaded route exports can enter that journey from the local Export Inbox without a second file-picker step.
Original sources, jobs, decisions, renders, artifacts, errors, cancellation, retry, and promotion state survive restarts.
SQLite and source artifacts remain single-owner local state and are not suitable for a deployed multi-user service.
Private promoted routes intentionally remain absent from public generated detail data, so their canonical verification proves exclusion rather than public presence.
They remain available on the owning machine only while a checksum-valid canonical or durable backup source exists.
Stable imported identity follows geometry; a materially edited geometry becomes a new route identity.

## Evidence

- `route_studio.py` and `route_studio_store.py`
- `route_compiler.py` and `route_studio_compiler.py`
- `route_studio_importers.py`
- `app/src/data/studio-repository.ts`
- `app/e2e/route-studio.spec.ts`
- `test_route_studio.py`
