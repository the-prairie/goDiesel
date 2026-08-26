# Existing architecture reconciliation

## Keep

| Existing seam | Reason to keep | World Pack use |
| --- | --- | --- |
| Strict route-detail parser | It enforces route truth and fails closed. | Validate the normalized canonical route before acquisition or compilation. |
| Route scene contract | It derives route-relative pose, heading, terrain sampling positions, and camera state without owning a provider. | Bind deterministic scene and camera plans to a World Pack identity. |
| Grounding vocabulary and bounded offsets | It separates recorded elevation from measured provider height. | Preserve route truth while selecting a declared physical surface source. |
| Playback and cinematic controllers | Their pure timing and pose calculations already have focused tests. | Produce exact camera timelines and frame plans from sealed geometry. |
| Cesium 1.143 application dependency | It is typed and already owns the Atlas runtime. | Use it for the isolated local-pack lab instead of the Playable Earth CDN runtime. |
| Named degradation states | They make unavailable and partial worlds explicit. | Extend them with integrity, coverage, physical readiness, and quality state. |
| Atomic route publication precedent | It protects the last valid generated set. | Apply the same staging, verify, and atomic-promotion rule to pack versions. |
| Runtime performance gauntlet | It already captures navigation, contexts, memory, network, and frame-time evidence. | Add fixed World Pack journeys and owner-hardware offline evidence. |

## Modernize

| Existing seam | Current limitation | Required change |
| --- | --- | --- |
| Playable Earth controller | Movement is route-relative lateral steering with no navigation or collision world. | Separate fixed-timestep player state, guided route following, free roam, rejoin, and recovery from renderer state. |
| Playable Earth viewer | It loads Cesium from a CDN and live Google photorealistic tiles. | Replace it in v2 with the bundled Cesium dependency and a local World Pack provider. |
| Readiness | Existing ready can precede settled visual geography and says nothing about collision. | Gate movement on verified local visual and physical neighbourhood readiness. |
| Grounding | Provider mesh sampling is opportunistic and route-only. | Compile stable physical terrain, collision proxies, traversable surfaces, and declared accuracy. |
| Cinematic export | Camera plans are deterministic but provider visuals can change. | Reference sealed pack and artifact checksums in every experience and render manifest. |
| Atlas provider diagnostics | They detect blank frames and tile failures but do not expose retained evidence. | Reuse diagnostic patterns while making source coverage and pack health inspectable. |

## Isolate

- Live Google Photorealistic 3D Tiles remain an optional visual overlay and comparison source.
- Native Google Maps 3D remains the current production Replay renderer until a separate decision.
- MapLibre and OpenFreeMap remain an honest map fallback but are not offline unless their required assets are installed in a pack.
- Earth Engine, public elevation, OpenStreetMap, LiDAR, orthophoto, municipal 3D, and reconstruction tools are acquisition adapters only.
- Original owner source files remain local or in an owner-controlled archive and do not enter this public repository.
- Route Studio draft code remains future context and cannot be imported from its unfinished branch.

## Retire from the v2 path

- The Playable Earth CDN Cesium loader and `Record<string, any>` runtime boundary.
- Provider visual level of detail as an implicit collision or grounding surface.
- A single readiness flag for visual, physical, source, and integrity state.
- Any camera or runtime asset reference that is not bound to a World Pack version and checksum.
- Any assumption that a successful live-provider screenshot is preservation evidence.

## Current data flow

```text
private Strava activity row + original GPX/FIT
  -> build.py
  -> strict generated route detail
  -> Atlas / Replay / Playable Earth
  -> live or remote provider geography
```

## Target isolated data flow

```text
strict route detail + retained acquisition sources
  -> acquisition adapters
  -> normalized content-addressed source inventory
  -> deterministic transformation graph
  -> staged World Pack version
  -> verify integrity + coverage + physical graph
  -> atomically seal version
  -> local World Pack provider
       -> Playable Route World v2 lab
       -> deterministic cinematic renderer
       -> optional live visual overlay
```

## Route Studio future adapter

The observed Route Studio draft uses a content-addressed immutable source store, strict staged route details, and atomic promotion.
Those concepts align with the target boundary, but the current branch does not contain reviewed Route Studio commits.
The World Pack compiler therefore accepts a normalized route input contract rather than importing draft Route Studio modules.
A later adapter may submit a staged strict route plus retained source inventory after isolated World Pack proofs pass.
