# Reference Core World Packs

The fixed reference corpus is published under `app/public/world-packs` for provider-independent browser proof.
The committed `index.json` is the machine-readable authority for route, world, pack, base path, and manifest SHA-256 bindings.

## Sealed identities

| Class | Route | World | Sealed pack |
| --- | --- | --- | --- |
| Dense urban | `17665674778` | `tokyo-urban` | `wp_3e7977146528fdd13d0cf898dfe10fa1b2206b3252be67a4f46f8f5729f8faa1` |
| High-relief mountain | `15573295095` | `banff-mountain` | `wp_30c64b0cbd257315c466ffa546dbafe65781bac9c0f3fff66e9e45dfdaba3151` |
| Remote coastal | `6496900063` | `ucluelet-coastal` | `wp_9e5fbe74c2963d77e2dad71f6909d442c56d0cbb2b8b0d2aad44145082e5fb98` |

## Reproducibility

Run `.venv/bin/python -m scripts.publish_reference_world_packs` from the repository root.
The publication source is the exact strict route detail at commit `9d82ce0be05012a6a17e0f93bf06425158e926ed`.
The acquisition timestamp is that source commit's committer timestamp, `2026-08-25T23:54:10-06:00`.
The script uses no network adapter and admits the route details under `owner-controlled-derived-route-data` with attribution to the goDiesel route pipeline.
It compiles only committed normalized terrain and retained PLATEAU subset inputs whose public-source receipts have already passed admission.
Repeated publication must produce the same three pack identities and the same bytes.
Publication is append-only: a new identity advances `index.json` atomically and does not remove an earlier sealed version.

## Current quality claim

These are Core packs, not Detailed or Archival packs.
They preserve exact route truth and provide separate collision geometry, a traversable route ribbon, recovery anchors, a camera timeline, coverage cells, attribution, and retained build inputs.
Banff and Ucluelet render normalized measured terrain with explicit no-data semantics and residual vertical accuracy.
Tokyo retains 87 route-corridor PLATEAU 2025 LOD1 tiles across Chiyoda, Chuo, Minato, and Koto from 200.8 MB of source content as a 47 MB local structure layer.
Each Tokyo ward declares its route-to-region vertical alignment offset, sample count, and residual P95; the current residual P95 range is 11.04-15.65 m.
The runtime applies those offsets without changing recorded route elevation or source geometry.
They explicitly declare structures outside retained Tokyo tiles, roads, paths, trails, reconstruction, annotations, and media unavailable where the compiler has admitted no retainable source.
They now pass browser integrity, separate collision-mesh loading, bounded Core free roam, checkpoint recovery, camera-mode, ghost, and rejoin proofs with all non-local requests blocked.
Tokyo and Banff navigation, route-thread, and traversable-ribbon artifacts omit edges that cross recorded discontinuities; the browser also refuses to interpolate or rejoin across an absent edge.
The browser parses the sealed indexed traversable surface as a layered physical support and proves every recorded route node is supported within 1 cm without replacing recorded elevation with the procedural heightfield.
The provider-blocked browser gate requires Cesium to refine into retained Tokyo B3DM content after loader verification, which prevents a verified-but-invisible structure hierarchy from passing.
They do not yet satisfy full-route repeated traversal, real-structure collision, deterministic film, blind quality, or clean-room archive gates required for promotion beyond the Playable Earth lab.

## Browser readiness

The local loader first checks the route-to-pack index and manifest hash.
It then recomputes the content-derived pack identity, reconciles the checksum ledger, and SHA-256 verifies every artifact marked `requiredRuntime`.
Terrain, terrain collision, structures collision, traversable surfaces, navigation, coverage, camera timeline, canonical route, local material, LOD policy, and experience binding must all verify before the physical-neighbourhood readiness phase completes.
No API key or non-local network request is part of this readiness path.
