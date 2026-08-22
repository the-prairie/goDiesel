# Architecture Decision Records

System-wide architecture decisions for goDiesel. This is a single-context
repository: these ADRs cover the whole system, and shared vocabulary lives in
root `CONTEXT.md`.

## How to use these

Read the relevant ADRs before changing the area they cover.

Surface any conflict with an accepted ADR explicitly. Do not silently override
one. When a decision genuinely changes, add a new ADR that supersedes the old one
and update the old record's status — do not edit history in place.

## Format

Each record has front matter (`status`, `date`, and `supersedes` /
`superseded-by` where relevant) and the sections Context, Decision, Consequences,
and Evidence.

`Consequences` records costs and known weaknesses as well as benefits. An ADR
that lists only benefits is not finished.

`Evidence` points at the spike, dogfood report, plan, commit, or code that
supports the decision. Decisions here are backed by artifacts in the repository,
not by recollection.

## Status values

| Status | Meaning |
| --- | --- |
| `accepted` | Current. Build with it. |
| `superseded` | Replaced by a later ADR, named in `superseded-by`. Retained for history. |
| `proposed` | Under consideration. Not yet binding. |

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-single-page-react-application-replaces-generated-static-app.md) | A React application replaces the generated static app | accepted |
| [0002](0002-hash-routing-for-static-hosting.md) | Hash routing for static hosting | accepted |
| [0003](0003-python-generator-is-the-only-writer-of-route-data.md) | The Python generator is the only writer of route data | accepted |
| [0004](0004-two-tier-route-data-with-lenient-summaries-and-strict-details.md) | Two-tier route data, lenient summaries and strict details | accepted |
| [0005](0005-photorealistic-3d-via-cesium.md) | Photorealistic 3D replay via Cesium and 3D Tiles | superseded by 0009 |
| [0006](0006-cesium-is-the-production-atlas-world.md) | Cesium is the production Atlas world; Three.js is retired | accepted |
| [0007](0007-named-degradation-instead-of-silent-failure.md) | Named degradation instead of silent failure | accepted |
| [0008](0008-playable-earth-remains-an-isolated-lab.md) | Playable Earth remains an isolated lab | accepted |
| [0009](0009-native-google-maps-3d-is-the-primary-replay-renderer.md) | Native Google Maps 3D is the primary replay renderer | accepted |
| [0010](0010-owner-curation-through-a-loopback-only-writer.md) | Owner curation through a loopback-only writer | accepted |
| [0011](0011-single-route-microsites-are-build-time-scoped.md) | Single-route microsites are scoped at build time | accepted |
| [0012](0012-risk-based-verification-with-a-no-skip-live-gate.md) | Risk-based verification with a no-skip live gate | accepted |
| [0013](0013-earth-engine-enrichment-stays-out-of-the-runtime.md) | Earth Engine enrichment stays out of the runtime | accepted |
| [0014](0014-app-src-is-organised-by-surface.md) | app/src is organised by surface, with labs separated | accepted |
| [0015](0015-route-studio-stages-imported-routes-before-atomic-promotion.md) | Route Studio stages imported routes before atomic promotion | accepted |

## Renderer history

Three decisions interact and are easy to confuse. Current state:

- **Replay** uses native Google Maps 3D (`maps3d`) by default — ADR-0009,
  superseding ADR-0005. Cesium remains reachable at `?renderer=cesium`.
- **Atlas** uses Cesium: bundled Natural Earth II globally, Google Photorealistic
  3D Tiles regionally — ADR-0006.
- **MapLibre with OpenFreeMap** is the credential-free 2D floor for both, and the
  fallback target — ADR-0007.
- **Three.js** is retired and no longer a dependency — ADR-0006.

## Outstanding obligations

Recorded so they are not lost:

- **ADR-0009** was promoted to primary without the broader route scorecard its
  own spike required. That scorecard is still owed.

## Backfill note

ADRs 0001–0013 were written on 2026-08-08, after the fact, from the spikes,
brainstorms, plans, dogfood reports, and commits listed in each record's
`Evidence` section. The `date` field is the date the decision was made or
delivered, not the date it was written down. Earlier decisions were recorded only
in those artifacts, which is what made a reversal like ADR-0009 possible without
review. New decisions should get an ADR at the time they are made.
