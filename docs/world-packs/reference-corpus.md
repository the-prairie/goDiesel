# Stage 0 reference corpus

The canonical machine-readable declaration is `reference-corpus.json`.
The three selected routes already have strict generated detail records in the repository and were included in the historical 66-route live Earth scorecard.
That scorecard is comparative provider evidence, not proof of a saved world.

## Dense urban: Tokyo

- Route slug: `17665674778`.
- Recorded distance: 21.8 km.
- Recorded elevation gain: 286 m.
- Current strict detail points: 377.
- Known route evidence includes two explicit temporal or position discontinuities.
- Historical provider result: Useful.
- Primary challenge: dense structures, road alignment, tunnels or crossings, visual occlusion, and route legibility.
- Reason for selection: it is the most direct dense-city stress case and provides a harder comparison than an already scenic provider route.

## High-relief mountain: Banff/Kananaskis

- Route slug: `15573295095`.
- Recorded distance: 22.0 km.
- Recorded elevation gain: 965 m.
- Current strict detail points: 397.
- Known route evidence includes one explicit recording gap.
- Historical provider result: Magical.
- Primary challenge: steep slopes, cliffs, terrain accuracy, trail continuity, horizon quality, and collision recovery.
- Reason for selection: it is a running-scale route with substantially more relief than the earlier low-climb Playable Earth mountain disposition route.

## Remote coastal: Ucluelet

- Route slug: `6496900063`.
- Recorded distance: 11.3 km.
- Recorded elevation gain: 236 m.
- Current strict detail points: 203.
- The current strict detail declares no route discontinuity.
- Historical provider result: Magical.
- Primary challenge: coastline, forest, sparse structures, trails, water boundary, and source gaps outside mapped roads.
- Reason for selection: it exercises a remote coastal world with different source coverage and visual character from the city and mountain routes.

## Fixed corpus requirements

Each route fixture must retain:

- the exact strict route-detail bytes and SHA-256 from the selected source commit;
- a normalized canonical route with exact coordinates, distances, elevations, elapsed time where recorded, segment boundaries, annotations, and provenance;
- start, midpoint, and end control points derived from recorded geometry;
- a declared route corridor and exploration boundary;
- deliberately source-absent quality cells resolved only through explicitly labelled derived or procedural fallback, used to prove honest gap handling and repair behavior;
- synthetic or source-cleared media fixtures that never imply owner capture;
- cases for structures, crossings, slopes, paths, and world edges when source evidence supports them;
- expected artifact, archive, tamper, repair, and deterministic-build results.

The committed corpus may contain only public generated route data and explicitly source-cleared fixtures.
Original owner GPX, FIT, photos, or videos remain in local restricted storage and may be referenced in private Archival-pack evidence by checksum only.

## Baseline evidence adopted

- The runtime-gauntlet baseline at `9d82ce0b` provides current application navigation, memory, context, request, and frame-time comparison infrastructure.
- The Playable Earth reports establish known route-relative agency, provider-settle, grounding, control, and no-collision limitations.
- The historical Earth scorecard provides broad live-provider reachability and a weak heuristic quality comparison for all three routes.
- Atlas regional dogfood establishes provider-backed urban and mountain framing, not local World Pack durability.
- `baseline/current-runtime-provider-disabled.json` proves that every current immersive path fails or attempts a non-local request for all three fixed routes when credentials and non-local network access are removed.

## Baseline evidence status

- The owner-Mac current-runtime workload is committed in `baseline/live-reference-runtime.json` and `baseline/live-reference-runtime.md`.
- The workload covers all three routes in Atlas, native Google Replay, and Playable Earth with an aggregate ten-minute observation.
- The harness captures readiness, frame distribution, route progress, Chromium JS heap, active WebGL contexts, request counts, response errors, and Playable Earth grounding offsets.
- Screenshots, recording, and trace remain in ignored local evidence with committed hashes because they contain provider-derived imagery.
- Collision failure is unavailable because the current product has no physical actor or collision world.
- Numeric route alignment and camera discontinuity are unavailable because the current renderer contracts expose no fixed control-set or camera-pose oracle.
- A blind human baseline remains required before runtime promotion.

The deterministic fixed corpus and locally obtainable baseline evidence are now committed prerequisites for production implementation.
Owner-subjective evidence remains an explicit promotion gate.
