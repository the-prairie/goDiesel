---
status: proposed
date: 2026-09-28
deciders: owner (pending)
---

# ADR-0017: Adventures are an editorial layer over canonical recordings

## Context

The owner's adventure Sites (the shared adventure player and its Final Boss,
Arnica and BVP publications) proved a content-rich form: chapters along a
route, the owner's own footage, an approved captured 3D scene with an authored
tour, and a short film. Each Site carries its own route model (a `RideTrack`
built from GPX), copy, media and brand, and is published separately.

goDiesel already owns the canonical route model: slug identity, lifecycle,
provenance, discontinuities and replay eligibility (CONTEXT.md sections 2-4,
7). Bringing the adventure form into goDiesel must not create a second route
model, and must not copy the whole player per adventure.

Two facts shaped the contract:

- The Final Boss pack's 22.4 km track is two canonical goDiesel recordings
  (`14130772463`, 7.4 km, and `14130782031`, 15.1 km) separated by a 205 s
  stop. Merging them would bridge an unrecorded interval.
- The repository is public, and the adventure content (footage, copy,
  captured-scene choices) belongs to Sites whose audiences are set separately.

## Decision

An **adventure** is editorial content anchored to canonical recordings. It
carries no geometry of its own.

- It names an ordered list of **legs**, each an existing canonical route slug
  that is replay-eligible. Legs are never joined; Replay shows one recording at
  a time and links to the neighbouring leg.
- **Chapters** and **captured scenes** are anchored by `{ slug, atDistanceM,
  source }`, where `source` is the prepared-pack coordinate the distance was
  derived from.
- The importer places each anchor by projecting the pack coordinate onto the
  canonical recording (never inside a discontinuity), and refuses anchors more
  than 75 m from every leg.
- The runtime confirms every anchor against the current geometry. An anchor
  beyond the recording, inside a recording gap, or more than 75 m from its
  source coordinate is **withheld** with a reason, never drawn elsewhere.
- **Footage** has no position. It is associated with a chapter by the owner and
  is labelled that way.
- A **captured scene** is another author's capture, credited throughout and
  labelled as not being the recorded route or its terrain. The film's scene
  beat must carry a footage fallback.
- Every interruption (footage, scene, film, inspecting another chapter) holds
  the whole Replay control state and releases it exactly.

The contract is strict (`app/src/domain/adventure/parse.ts`): unknown fields,
unknown legs, media paths outside the adventure directory, films longer than
three minutes, and scene passages outside their tour are errors.

Adventure content lives in the ignored repository-root store `.adventures/`,
written only by `app/scripts/import-adventure.mjs` and served only by the Vite
dev and preview servers. A build contains no adventure content; the product
treats the absence as the normal state of a route without an adventure.

## Consequences

- One route model. An adventure cannot introduce geometry, speeds or
  locations; a changed recording visibly withholds anchors that no longer fit
  rather than silently misplacing them.
- The shared runtime is content-driven: no route-specific code. A second
  adventure is an import, not a build.
- Publication is opt-in per adventure. `make-dist.sh` stages one adventure
  into the full-site build only with `GODIESEL_PUBLISH_ADVENTURE=<id>` and the
  owner's approval `GODIESEL_ADVENTURE_PUBLICATION_APPROVED=<id>`, copying just
  its document, referenced media (digest-checked) and a one-entry index; every
  leg must be in the bundle, so single-route microsites cannot carry one. The
  deploy target and audience remain an owner decision outside the build.
- Captured scenes depend on Sketchfab's hosted viewer and its browser support
  (it rejects Playwright's headless shell). That is third-party availability,
  covered by a stall-based fallback, not a product guarantee.
- `app/public/scene-viewer.html` is tracked and content-agnostic; it loads the
  Sketchfab Viewer API only when a scene is opened.
- Both Replay stages render the layer: the Google photorealistic stage
  (ADR-0009), where owner chapters replace the track-derived moments, and the
  shared stage used by the notebook, Atlas and Cesium engines.
- Owner edits go through a writer in the Vite dev server only. It writes only
  the ignored store, accepts loopback, same-Host, same-Origin JSON PUTs, and
  refuses changes to legs, media, digests or scene credits. It does not
  replace ADR-0010's writer for canonical route state.
- Repository gates run with `GODIESEL_LOCAL_ADVENTURES=0`, so their result
  never depends on ignored local content.
- The World Pack work on `feat/sovereign-adventure-worlds` numbers its own ADR
  0015. If both land, one of the two records needs renumbering.

## Evidence

- `app/src/domain/adventure/` and its tests: parser, projection, placement,
  film and tour timelines.
- `app/src/surfaces/replay/adventure/` and `replay-hold.ts`.
- `app/scripts/import-adventure.mjs`: Final Boss placements within 6.1 m of
  the canonical recordings.
- `app/scripts/verify-adventure-replay.mjs` and
  `app/scripts/verify-adventure-journey.mjs`: real-browser journey evidence in
  `.godiesel/evidence/`.
- Reference: the adventure player's `lib/adventure.ts`, `lib/scene-tour.ts`,
  `lib/adventure-film.ts` and `public/scene-viewer.html`, whose tour
  interpolation and bridge were ported.
