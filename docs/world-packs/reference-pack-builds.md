# Reference Core World Packs

The fixed reference corpus is published under `app/public/world-packs` for provider-independent browser proof.
The committed `index.json` is the machine-readable authority for route, world, pack, base path, and manifest SHA-256 bindings.

## Sealed identities

| Class | Route | World | Sealed pack |
| --- | --- | --- | --- |
| Dense urban | `17665674778` | `tokyo-urban` | `wp_82e3f27f51154a24a7000bf1a1b4ace6efed81a5312b83dac96744c14724d4a3` |
| High-relief mountain | `15573295095` | `banff-mountain` | `wp_c342858c2e11f9c4d82a1853f76117b2b092e6a57b706a59eb3355684098f4f5` |
| Remote coastal | `6496900063` | `ucluelet-coastal` | `wp_4815261602b01da51ca56651ed886fadf7fcf989c8ab6485469515417b8d1eac` |

## Reproducibility

Run `.venv/bin/python -m scripts.publish_reference_world_packs` from the repository root.
The publication source is the exact strict route detail at commit `9d82ce0be05012a6a17e0f93bf06425158e926ed`.
The route acquisition timestamp is that source commit's committer timestamp, `2026-08-25T23:54:10-06:00`.
Terrain, structure, and OSM inputs retain their own receipt-backed acquisition timestamps from 2026-08-26.
Those receipts and their checksum-verified licence evidence bytes are sealed into the pack with licence URI, public-use obligations, and third-party-rights terms.
The script uses no network adapter and admits the route details under `owner-controlled-derived-route-data` with attribution to the goDiesel route pipeline.
It compiles only committed normalized terrain and retained PLATEAU and OpenStreetMap inputs whose public-source receipts have already passed admission.
Repeated publication must produce the same three pack identities and the same bytes.
Publication is append-only: a new identity advances `index.json` atomically and does not remove an earlier sealed version.

## Current quality claim

These are Core packs, not Detailed or Archival packs.
They preserve the exact public derived strict route detail at the pinned commit.
They do not claim equality to private GPX or FIT originals that are outside the repository.
They provide measured terrain where admitted, separate collision geometry, a traversable route ribbon, recovery anchors, a camera timeline, coverage cells, attribution, and retained build inputs.
Banff and Ucluelet render normalized measured terrain with explicit no-data semantics and residual vertical accuracy.
Tokyo retains 87 route-corridor PLATEAU 2025 LOD1 tiles across Chiyoda, Chuo, Minato, and Koto from 200.8 MB of source content as a 47 MB local structure layer.
Each Tokyo ward declares its route-to-region vertical alignment offset, sample count, and residual P95; the current residual P95 range is 11.04-15.65 m.
The runtime applies those offsets without changing recorded route elevation or source geometry.
All three packs retain exact OSM query responses and a normalized transportation network.
They compile 49,873 Tokyo, 2,062 Banff, and 429 Ucluelet route-safe OSM building footprints into polygon-prism collision, with 172, 7, and 1 source footprints respectively excluded and recorded because they conflict with the canonical route actor clearance.
The browser uses a deterministic 64 m spatial index for collision candidates, so structure density does not create a per-tick linear scan.
They retain recorded route context and explicit recording-gap annotations.
They explicitly declare reconstruction and media unavailable where the compiler has admitted no retainable source.
They now pass browser integrity, separate collision-mesh loading, bounded Core free roam, checkpoint recovery, camera-mode, ghost, and rejoin proofs with all non-local requests blocked.
Tokyo and Banff navigation, route-thread, and traversable-ribbon artifacts omit edges that cross recorded discontinuities; the browser also refuses to interpolate or rejoin across an absent edge.
The browser parses the sealed indexed traversable surface as a layered physical support and proves every retained edge three times at 2 m or finer spacing without replacing recorded elevation with the procedural heightfield.
The maximum observed route grounding error is below 0.09 mm, and each pack has a deterministic 600-second free-roam trace with no structure entry or unexplained teleportation.
The provider-blocked browser gate requires Cesium to refine into retained Tokyo B3DM content after loader verification, which prevents a verified-but-invisible structure hierarchy from passing.
Deterministic film and same-Mac clean-room archive proofs are implemented and checksum-bound to the active pack identities.
Cross-machine cinema equivalence, real schema N-1 migration, and blind human quality remain explicit promotion gates.

## Browser readiness

The local loader first checks the route-to-pack index and manifest hash.
It then recomputes the content-derived pack identity, reconciles the checksum ledger, and SHA-256 verifies every artifact marked `requiredRuntime`.
Terrain, terrain collision, structures collision, traversable surfaces, navigation, coverage, camera timeline, canonical route, local material, LOD policy, and experience binding must all verify before the physical-neighbourhood readiness phase completes.
No API key or non-local network request is part of this readiness path.
