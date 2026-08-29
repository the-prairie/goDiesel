# Reference Core World Packs

The fixed reference corpus is published under `app/public/world-packs` for provider-independent browser proof.
The committed `index.json` is the machine-readable authority for route, world, pack, base path, and manifest SHA-256 bindings.

## Sealed identities

| Class | Route | World | Sealed pack |
| --- | --- | --- | --- |
| Dense urban | `17665674778` | `tokyo-urban` | `wp_db41d4a21168071bd09e67553dea9d755d8b03a49945ab658652218fefdcdfa9` |
| High-relief mountain | `15573295095` | `banff-mountain` | `wp_05202b59d818c60bf93a5b7def1b16c840d77faba87c0f1aa8c36ee5eacdcffe` |
| Remote coastal | `6496900063` | `ucluelet-coastal` | `wp_c26dca2c4573447722b90223b037cda5681ea248605765bbbe588353bb41b90c` |

## Reproducibility

Run `.venv/bin/python -m scripts.publish_reference_world_packs` from the repository root.
The publication source is the exact strict route detail at commit `9d82ce0be05012a6a17e0f93bf06425158e926ed`.
The acquisition timestamp is that source commit's committer timestamp, `2026-08-25T23:54:10-06:00`.
The script uses no network adapter and admits the route details under `owner-controlled-derived-route-data` with attribution to the goDiesel route pipeline.
It compiles only committed normalized terrain and retained PLATEAU and OpenStreetMap inputs whose public-source receipts have already passed admission.
Repeated publication must produce the same three pack identities and the same bytes.
Publication is append-only: a new identity advances `index.json` atomically and does not remove an earlier sealed version.

## Current quality claim

These are Core packs, not Detailed or Archival packs.
They preserve exact route truth and provide measured terrain where admitted, separate collision geometry, a traversable route ribbon, recovery anchors, a camera timeline, coverage cells, attribution, and retained build inputs.
Banff and Ucluelet render normalized measured terrain with explicit no-data semantics and residual vertical accuracy.
Tokyo retains 87 route-corridor PLATEAU 2025 LOD1 tiles across Chiyoda, Chuo, Minato, and Koto from 200.8 MB of source content as a 47 MB local structure layer.
Each Tokyo ward declares its route-to-region vertical alignment offset, sample count, and residual P95; the current residual P95 range is 11.04-15.65 m.
The runtime applies those offsets without changing recorded route elevation or source geometry.
All three packs retain exact OSM query responses and a normalized transportation network.
They compile 49,873 Tokyo, 2,062 Banff, and 429 Ucluelet route-safe OSM building footprints into polygon-prism collision, with 172, 7, and 1 source footprints respectively excluded and recorded because they conflict with the canonical route actor clearance.
The browser uses a deterministic 64 m spatial index for collision candidates, so structure density does not create a per-tick linear scan.
They explicitly declare reconstruction, annotations, and media unavailable where the compiler has admitted no retainable source.
They now pass browser integrity, separate collision-mesh loading, bounded Core free roam, checkpoint recovery, camera-mode, ghost, and rejoin proofs with all non-local requests blocked.
Tokyo and Banff navigation, route-thread, and traversable-ribbon artifacts omit edges that cross recorded discontinuities; the browser also refuses to interpolate or rejoin across an absent edge.
The browser parses the sealed indexed traversable surface as a layered physical support and proves every retained edge three times at 2 m or finer spacing without replacing recorded elevation with the procedural heightfield.
The maximum observed route grounding error is below 0.09 mm, and each pack has a deterministic 600-second free-roam trace with no structure entry or unexplained teleportation.
The provider-blocked browser gate requires Cesium to refine into retained Tokyo B3DM content after loader verification, which prevents a verified-but-invisible structure hierarchy from passing.
They do not yet satisfy deterministic film, blind quality, or clean-room archive gates required for promotion beyond the Playable Earth lab.

## Browser readiness

The local loader first checks the route-to-pack index and manifest hash.
It then recomputes the content-derived pack identity, reconciles the checksum ledger, and SHA-256 verifies every artifact marked `requiredRuntime`.
Terrain, terrain collision, structures collision, traversable surfaces, navigation, coverage, camera timeline, canonical route, local material, LOD policy, and experience binding must all verify before the physical-neighbourhood readiness phase completes.
No API key or non-local network request is part of this readiness path.
