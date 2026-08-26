# Reference Core World Packs

The fixed reference corpus is published under `app/public/world-packs` for provider-independent browser proof.
The committed `index.json` is the machine-readable authority for route, world, pack, base path, and manifest SHA-256 bindings.

## Sealed identities

| Class | Route | World | Sealed pack |
| --- | --- | --- | --- |
| Dense urban | `17665674778` | `tokyo-urban` | `wp_72a5535ba78c3de302568dc341bbd6e3e6542dbc239c8be3f926411fad709248` |
| High-relief mountain | `15573295095` | `banff-mountain` | `wp_a29b4d97d6f2363bfff8e1a226bee9f5bd480527a85540de2c04b1d8ba3657c7` |
| Remote coastal | `6496900063` | `ucluelet-coastal` | `wp_69410732b128dbe730c57f16cd186c3015e4d920597e35a4a088e42fb7493bef` |

## Reproducibility

Run `.venv/bin/python -m scripts.publish_reference_world_packs` from the repository root.
The publication source is the exact strict route detail at commit `9d82ce0be05012a6a17e0f93bf06425158e926ed`.
The acquisition timestamp is that source commit's committer timestamp, `2026-08-25T23:54:10-06:00`.
The script uses no network adapter and admits the route details under `owner-controlled-derived-route-data` with attribution to the goDiesel route pipeline.
Repeated publication must produce the same three pack identities and the same bytes.
Publication is append-only: a new identity advances `index.json` atomically and does not remove an earlier sealed version.

## Current quality claim

These are Core packs, not Detailed or Archival packs.
They preserve exact route truth and provide deterministic procedural terrain, separate collision geometry, a traversable route ribbon, recovery anchors, a camera timeline, coverage cells, attribution, and retained build inputs.
They explicitly declare structures, roads, paths, trails, reconstruction, annotations, and media unavailable where the compiler has admitted no retainable source.
They now pass browser integrity, separate collision-mesh loading, bounded Core free roam, checkpoint recovery, camera-mode, ghost, and rejoin proofs with all non-local requests blocked.
Tokyo and Banff navigation, route-thread, and traversable-ribbon artifacts omit edges that cross recorded discontinuities; the browser also refuses to interpolate or rejoin across an absent edge.
The browser parses the sealed indexed traversable surface as a layered physical support and proves every recorded route node is supported within 1 cm without replacing recorded elevation with the procedural heightfield.
They do not yet satisfy the visual fidelity, full-route repeated traversal, real-structure collision, deterministic film, blind quality, or clean-room archive gates required for promotion beyond the Playable Earth lab.

## Browser readiness

The local loader first checks the route-to-pack index and manifest hash.
It then recomputes the content-derived pack identity, reconciles the checksum ledger, and SHA-256 verifies every artifact marked `requiredRuntime`.
Terrain, terrain collision, structures collision, traversable surfaces, navigation, coverage, camera timeline, canonical route, local material, LOD policy, and experience binding must all verify before the physical-neighbourhood readiness phase completes.
No API key or non-local network request is part of this readiness path.
