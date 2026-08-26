# Sovereign Adventure Worlds documentation reality check

**Branch base:** `main` at `9d82ce0be05012a6a17e0f93bf06425158e926ed`
**Assessment date:** 2026-08-26
**Scope:** route-scoped World Pack acquisition, compilation, preservation, runtime, physics, cinema, and proof

This assessment separates current rules from historical descriptions before World Pack requirements are derived.

| Claim | Source | Current evidence | Treatment |
| --- | --- | --- | --- |
| Recorded route data is truth, and all other evidence must remain labelled. | `CONTEXT.md` section 4 | Strict route-detail parsing enforces recorded geometry, temporal provenance, discontinuities, and evidence labels. | Enforce in every source, quality cell, transform, runtime diagnostic, and cinematic manifest. |
| `build.py` is the only writer of canonical generated route data. | ADR-0003 | The generator still stages and publishes public route records atomically. | Enforce. The World Pack compiler consumes strict route records or an explicit future Route Studio adapter and never writes canonical route data. |
| Route summaries are lenient and route details are strict. | ADR-0004 | The bundled manifest and lazy per-route detail repository still implement the two tiers. | Enforce at the boundary. A World Pack build requires a strict route detail and fails closed on invalid geometry. |
| Cesium owns the production Atlas world. | ADR-0006 | `CesiumAtlasWorldEngine` is still selected for global and regional Atlas. | Preserve. A World Pack runtime is not an Atlas replacement in the first slice. |
| Provider failure must become named degradation. | ADR-0007 | Atlas and Replay expose explicit loading, ready, partial, and unavailable states with active probes. | Enforce and extend with pack health, coverage, integrity, and physical-readiness states. |
| Playable Earth remains an isolated lab. | ADR-0008 | The lab remains under `app/src/labs/playable-earth` and production imports are structurally prevented. | Enforce. Playable Route World v2 stays a lab until all World Pack quality and durability gates pass. |
| Native Google Maps 3D is the primary Replay renderer. | ADR-0009 | Replay still selects the native Google engine by default. | Preserve for current Replay. A local World Pack renderer is an explicit lab adapter until a later promotion decision. |
| Deterministic tests are provider-free and live-provider proof is separate. | ADR-0012 and `docs/agents/testing.md` | Default Playwright disables live providers; dedicated live configurations do not skip missing credentials. | Enforce. Offline World Pack acceptance is a new provider-free gate, not a substitute for provider comparison. |
| Earth Engine stays out of the runtime. | ADR-0013 | Enrichment remains an offline static-data process. | Enforce. Earth Engine may be an acquisition adapter only when outputs and attribution are retained locally. |
| Production code is organised by layer and surface, and production cannot import labs. | ADR-0014 | `app/src/structure.test.ts` enforces the current tree. | Enforce. Compiler contracts belong outside a product surface; the first local runtime remains in `labs/`. |
| Playable Earth is the immersive production reference. | `README.md` | ADR-0008 and current folder placement classify it as a lab with no production commitment. | Treat only as an experimental comparison baseline. |
| Playable Earth provides free-world navigation and collision. | Goal-adjacent wording in older plans | The controller permits route-relative lateral steering and camera look only; dogfood explicitly records no locomotion physics or semantic collision. | Reject as stale or unsupported. |
| A ready Playable Earth scene means its required visual neighbourhood is complete. | Historical lab behavior | Dogfood observed a flat green or unsettled scene after the lab reported ready. | Reject. World Pack readiness must separately prove local visual and physical neighbourhood readiness. |
| Existing Atlas global imagery is a preserved route world. | Current bundled Natural Earth imagery | The imagery is provider-free but global, coarse, and not a route-scoped terrain, structure, collision, or source archive. | Reuse only as a distant visual fallback, not as World Pack completion evidence. |
| Current Replay or cinema is deterministic after a provider changes. | ADR-0009 and current engines | Camera and route calculations are deterministic, but required visual geography is requested from live providers. | Reject. Reuse pure camera and timeline logic only after it references a sealed World Pack identity. |
| The runtime baseline proves the World Pack exit criteria. | `docs/performance/runtime-gauntlet/` | It measures current application paths on hosted Linux and intentionally has no live-provider credential or fixed owner hardware. | Adopt as comparative infrastructure only. It does not prove offline geography, collision, clean-room restore, owner-Mac performance, or deterministic films. |
| Route Studio is approved current architecture available on this branch. | `/private/tmp/godiesel-route-studio` draft files | The directory is not a registered Git worktree in the current checkout, and none of its commits are in this branch. | Treat as non-authoritative future integration context. Reuse requires reviewed commits or an explicit adapter after isolated World Pack proof. |
| Current route totals and paths are permanent product facts. | `CONTEXT.md`, historical reports, and generated data | Counts are time-sensitive and accepted ADR evidence links contain superseded pre-ADR-0014 paths. | Use current files and compute counts; never hardcode historical totals or paths into the compiler. |

## Current implementation findings

- Atlas global mode has a provider-free Natural Earth visual layer, but regional terrain and structures are live Google Photorealistic 3D Tiles.
- Replay defaults to native Google Maps 3D, with Cesium and MapLibre as explicit alternatives; none is a sealed route-scoped world.
- Playable Earth loads a second Cesium version from a CDN, uses live Google tiles, permits only a bounded route corridor, and has no stable physical world.
- `route-scene-contract.ts`, route grounding, playback pose calculation, and cinematic timeline logic are reusable pure seams after their inputs are bound to a World Pack version.
- Strict route details are the current public, versioned normalized route input, but the original owner GPX or FIT evidence remains private and cannot be copied into this public repository.
- Existing media paths are published route assets, not a complete source inventory or licence record.

## Authority order for this goal

1. Recorded owner route source and its existing canonical strict route contract.
2. The Sovereign Adventure Worlds goal and its numeric exit criteria.
3. `CONTEXT.md` vocabulary and invariants.
4. Accepted ADRs that this goal does not explicitly supersede.
5. Current tested implementation behavior.
6. Current dogfood and performance evidence within its stated scope.
7. Historical plans, screenshots, draft Route Studio files, and provider demonstrations as non-authoritative context.

## Gate conclusion

Stage -1 may proceed without changing production behavior.
The first implementation must be an isolated compiler plus lab runtime, must consume strict normalized route data, and must preserve ADR-0008 until offline, integrity, traversal, performance, and human-quality evidence supports a separate promotion decision.
