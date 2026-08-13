# Daydream Production Implementation

Last updated: 2026-08-12

This checklist tracks the approved Daydream direction as it moves from the isolated lab prototype into the production application.

Status vocabulary:

- `Planned` means the slice is defined but implementation has not started.
- `In progress` means code or verification is underway.
- `Implemented` means the slice works locally but has not completed its required verification.
- `Verified` means the slice passed its focused tests, visual review, and ticket gate.

## Vertical Slices

### 1. Story Flight shell for real Google 3D Replay

Status: Implemented

- [x] Remove the persistent product spine from immersive production Replay.
- [x] Preserve the real Google 3D renderer, camera modes, route picker, settings, fallback, repairs, and playback state.
- [x] Use the personal activity title as the replay identity.
- [x] Add a chapter timeline derived from recorded route geometry.
- [x] Add an active chapter title and honest route telemetry over the terrain.
- [x] Use progressive disclosure so the route and terrain remain visually dominant.
- [x] Resolve the mobile telemetry collisions and title truncation found in the UX audit.
- [x] Preserve keyboard playback, seeking, camera selection, fallback, and accessible names.
- [ ] Extract the Story Flight HUD and chapter derivation from the renderer stage before the next Replay feature expansion.
- [x] Verify desktop and mobile behavior with the provider fixture.
- [x] Verify desktop composition with the live local Google renderer.
- [ ] Verify phone composition with the live local Google renderer.

### 2. Regional Atlas as the primary discovery model

Status: Verified

- [x] Open Atlas at the regional memory scale when a meaningful recent or selected region exists.
- [x] Keep the global globe as an overview and escape hatch.
- [x] Bring the Daydream region rail and route lens into production data and URL state.
- [x] Preserve Cesium interaction, provider fallback, activity filters, search, and keyboard navigation.

### 3. Spatial continuity from route cards to terrain

Status: Verified

- [x] Make card hover and focus isolate the corresponding route.
- [x] Fit or reframe the selected route without disorienting camera movement.
- [x] Surface one derived terrain distinction for each route.
- [x] Keep selection synchronized between desktop rail, mobile surface, map, and URL.

### 4. Routes as a memory library

Status: Planned

- [ ] Make place, personal title, date, trace, and remembered context the primary scan hierarchy.
- [ ] Move lifecycle and guide-review language into Admin.
- [ ] Replace the overflowing desktop ledger with a responsive comparison model.
- [ ] Preserve search, filters, canonical route URLs, and large-library performance.

### 5. Cross-surface quality and continuity

Status: Planned

- [ ] Add explicit scroll restoration for hash-route transitions.
- [ ] Fix Finder desktop overflow and improve no-match recovery.
- [ ] Ensure cinematic chapter controls retain accessible names on mobile.
- [ ] Validate reduced motion, focus restoration, touch targets, and safe-area behavior.
- [ ] Complete the production visual consistency pass across Atlas, Finder, Routes, Replay, and Admin.

## Decisions

- The real Google 3D renderer remains the production replay engine.
- Story chapters must come from recorded, derived, measured, or visibly labelled editorial evidence.
- The production replay should inherit the Daydream Story Flight interaction model without importing prototype-only scenic imagery as route evidence.
- Direct Replay entry returns to the selected route story; Atlas-launched Replay preserves its Atlas return path.
- Admin remains an operational surface and does not need to adopt the immersive visual language.

## Verification Record

### Slice 1

- TypeScript build and production bundle passed on 2026-08-11.
- All 242 unit tests passed on 2026-08-11, including final-point summit truthfulness and co-located chapter grouping.
- All 7 focused production Replay tests passed, including Story Flight structure, Google renderer selection, full-height fallback, long-title layout, phone telemetry, progressive disclosure, and throttled playback state.
- The 7 navigation checks affected by the immersive shell passed, including direct URLs, route history, mobile viewport ownership, and primary navigation legibility.
- The ticket-gate navigation subset passed independently after the combined gate's test server was denied permission to bind port 8791.
- Desktop and phone fallback frames were inspected at 1440 x 960 and 390 x 844; both had exact viewport width and no document overflow.
- The earlier local `unavailable` result was a verification-origin bug: the check used `http://127.0.0.1:8787`, while the Google browser key authorizes `http://localhost:8787`.
- On 2026-08-12 the production Replay was inspected on the authorized localhost origin. The stage reported `ready`, rendered a full-size `gmp-map-3d`, showed photorealistic Crete terrain and the recorded route thread, and emitted no browser warnings or errors.
- Phone behavior and layout remain covered by the provider fixture at 390 x 844. Live Google terrain at phone width is the only remaining visual acceptance item; the in-app browser blocked changing the localhost tab's viewport under its local-URL safety policy.

### Slice 2

- A clean Atlas entry now replaces its URL with the region containing the latest completed route; direct region, route, search, and activity URLs retain priority.
- `view=world` is the explicit, reload-stable global overview and is reached through the named All places control or the second Escape hierarchy step.
- The production region rail exposes URL-backed Routes and Terrain lenses. Terrain mode derives high point, recorded relief, and climbing only from route track evidence and labels that provenance in the interface.
- TypeScript, the production build, all 245 unit tests, and the four-check navigation ticket gate passed on 2026-08-12.
- The 40-case Atlas browser matrix passed after its two small-height collision failures were fixed and the affected seven responsive cases were rerun.
- Desktop and phone screenshots at 1440 x 960 and 390 x 844 were inspected; a phone terrain-panel collision was fixed and guarded with a geometry assertion.
- Live Cesium verification passed for source-backed Kyoto terrain on desktop and phone, including settled camera state, selected-route contrast, regional framing, route rail selection, and document width.

### Slice 3

- Card hover and keyboard focus now preview one recorded route on both Cesium and the regional fallback without changing URL state or camera position.
- Route activation from cards, carousel drag, keyboard navigation, or the map commits the URL selection and reframes the recorded route with a 650 ms transition; reduced motion uses 120 ms.
- Escape clears the route selection and restores the whole-region camera frame before the existing second Escape returns to the world overview.
- Every route card exposes one terrain distinction derived only from recorded elevation samples: recorded relief when meaningful, otherwise high point.
- TypeScript, the production build, all 246 unit tests, the 20-case Atlas fixture suite, and the four-check navigation ticket gate passed on 2026-08-12.
- Live Cesium screenshots at 1440 x 960 and 390 x 844 were inspected; hover isolation, map-first framing, card rhythm, 44 px mobile controls, and zero horizontal document overflow were verified.
