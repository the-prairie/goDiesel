# Daydream Production Implementation

Last updated: 2026-08-16

This checklist tracks the approved Daydream direction as it moves from the isolated lab prototype into the production application.

Status vocabulary:

- `Planned` means the slice is defined but implementation has not started.
- `In progress` means code or verification is underway.
- `Implemented` means the slice works locally but has not completed its required verification.
- `Verified` means the slice passed its focused tests, visual review, and ticket gate.

## Vertical Slices

### 1. Story Flight shell for real Google 3D Replay

Status: Verified

- [x] Remove the persistent product spine from immersive production Replay.
- [x] Preserve the real Google 3D renderer, camera modes, route picker, settings, fallback, repairs, and playback state.
- [x] Use the personal activity title as the replay identity.
- [x] Add a chapter timeline derived from recorded route geometry.
- [x] Add an active chapter title and honest route telemetry over the terrain.
- [x] Use progressive disclosure so the route and terrain remain visually dominant.
- [x] Resolve the mobile telemetry collisions and title truncation found in the UX audit.
- [x] Preserve keyboard playback, seeking, camera selection, fallback, and accessible names.
- [x] Extract the Story Flight HUD and chapter derivation from the renderer stage before the next Replay feature expansion.
- [x] Verify desktop and mobile behavior with the provider fixture.
- [x] Verify desktop composition with the live local Google renderer.
- [x] Verify phone composition with the live local Google renderer.

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

### 4. Finder as a Daydream planning map

Status: Verified

- [x] Make the recorded regional map the primary Finder surface.
- [x] Replace the persistent filter grid with a compact intent summary and responsive edit sheet.
- [x] Render every matched candidate trace together and link card hover/focus to map emphasis.
- [x] Commit route selection through the `candidate` URL parameter while keeping previews transient.
- [x] Keep planned-route saving, recorded-source honesty, no-match behavior, and Atlas totals intact.
- [x] Verify desktop and phone composition, responsive filtering, accessible controls, and horizontal fit.

### 5. Route detail as an immersive field story

Status: Verified

- [x] Lead with a source-backed route image or the recorded route trace when no image exists.
- [x] Build the story from recorded annotations, track-derived high point, and recorded start and finish evidence.
- [x] Add a responsive timeline of compact chapter cards that follows and seeks within the story.
- [x] Keep the real map, elevation profile, and factual guide available as recorded geography.
- [x] Hand off clearly to cinematic Replay and preserve return to the same route story.
- [x] Preserve loading, retry, missing-geometry, provider-failure, draft-guide, and replay-ineligible states.
- [x] Verify desktop and phone composition, source honesty, responsive fit, and Replay continuity.

### 6. Routes as a memory library

Status: Verified

- [x] Make place, personal title, date, trace, and remembered context the primary scan hierarchy.
- [x] Remove lifecycle and guide-review workflow language from memory cards while keeping evidence form and route relationship legible.
- [x] Replace the overflowing desktop ledger with a responsive comparison model.
- [x] Preserve search, filters, canonical route URLs, and large-library performance.

### 7. Cross-surface quality and continuity

Status: Verified

- [x] Add explicit scroll restoration for hash-route transitions.
- [x] Fix Finder desktop overflow and improve no-match recovery.
- [x] Ensure cinematic chapter controls retain accessible names on mobile.
- [x] Validate reduced motion, focus restoration, touch targets, and safe-area behavior.
- [x] Complete the production visual consistency pass across Atlas, Finder, Routes, Replay, and Admin.

### 8. Release-readiness proof

Status: Verified

- [x] Isolate Story Flight chapter derivation and the production HUD from the Google renderer lifecycle.
- [x] Add a production-specific live Google 3D phone acceptance scenario to the explicit provider gate.
- [x] Capture and inspect live Story Flight evidence at 390 x 844.
- [x] Pass the complete production release gate after the extraction.

### 9. Story Flight timeline clarity

Status: Verified

- [x] Replace unexplained compact chapter dots with a named previous and next chapter stepper.
- [x] Identify recorded route-data notes without competing with the elevation profile.
- [x] Preserve labeled direct chapter jumps where the viewport has room.
- [x] Keep 44 px targets, safe-area clearance, and the compact terrain-visibility budget.

### 10. Story Flight terrain thread

Status: Verified

- [x] Replace the scratchy route filament with a camera-aware terrain thread.
- [x] Distinguish travelled route in coral and upcoming route in pearl without obscuring terrain.
- [x] Mark the exact current route position with a terrain-anchored coral playhead and short blush lead.
- [x] Verify the four semantic thread layers against live Google 3D terrain at overview, playback, and chase distances.

### 11. Story Flight production cutover

Status: Verified

- [x] Give direct map gestures camera ownership without pausing route playback.
- [x] Expose an explicit, accessible Recenter action that restores the authored camera.
- [x] Condition render-only filament geometry by camera range while preserving recorded endpoints and route detail.
- [x] Record a bounded 30-second frame, dropped-frame, and long-task report in the Replay stage.
- [x] Verify following and free-camera composition on desktop and phone against live Google 3D terrain.
- [x] Pass the complete release gate and the affected live-provider matrix.

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
- Before the release-readiness slice, phone behavior was covered by the provider fixture at 390 x 844 while the in-app browser's local-URL safety policy prevented live phone-width evidence.
- On 2026-08-15 the production Story Flight route was verified in a headed Chromium session at 390 x 844 on the authorized localhost origin. The native Google 3D stage reached `ready`, rendered photorealistic Crete terrain and four route filaments, played the recorded route, kept all Story Flight controls within the viewport, and produced no runtime errors.
- The durable live scenario is `google-route-navigator-live.spec.ts` and captures `e2e/evidence/auto-director/14023448720-story-flight-mobile-live.png`. A headless diagnostic run correctly failed closed because Google 3D requires the accelerated headed browser used by the explicit live command.

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

### Slice 4

- Finder now renders every matching recorded trace in a single MapLibre source and uses card hover/focus or map hover to preview one route without mutating history.
- Candidate activation from the card or route line commits `candidate=<source route slug>` in the URL and preserves the submitted planning intent.
- Desktop and phone frames were inspected in the live local app; the initial oversized form and clipped mobile chips were corrected before acceptance.
- The mobile bottom sheet preserves the submitted form state, exposes a named dialog, fits 390 x 844, and leaves the regional route visible behind the modal surface.
- The production build and all seven focused Finder browser scenarios passed on 2026-08-13, including the negative unsupported-place case and the completed-Atlas-total isolation check.

### Slice 5

- Route detail now opens as a source-backed field story with an editorial hero, evidence-labelled chapters, a sticky Director-style timeline of compact chapter cards, recorded geography, and a deliberate cinematic Replay transition.
- Chapter order comes from recorded annotations and route distance. The high-point chapter is track-derived and is omitted when it would duplicate an endpoint or nearby recorded annotation.
- Replay accepts only the matching route story or a valid Atlas URL as a return destination, retaining the existing protection against arbitrary redirect paths.
- Desktop and phone frames were inspected at 1440 x 900 and 390 x 844. The route photograph, editorial hierarchy, mobile navigation clearance, chapter access, and zero horizontal overflow were verified.
- The production build, seven focused unit assertions, all eleven focused Route Story browser scenarios, and the single-route microsite contract passed on 2026-08-14, including provider failure, missing geometry, transient retry, mobile active-card visibility, and the story-to-Replay-to-story loop.

### Slice 6

- Routes now presents a two-column desktop memory library and a single-column phone library, led by recorded trace, place, date, personal activity title, remembered context, and aligned effort facts.
- Consumer cards no longer expose lifecycle or guide-review workflow language; evidence form stays visible, and the existing lifecycle filter remains URL-compatible under the canonical Collection label.
- Search and six filters live in a compact responsive tray, while readable applied-filter chips preserve context and support one-step removal when the tray is closed.
- Desktop and phone frames were inspected at 1440 x 900 and 390 x 844; card hierarchy, filter fit, mobile navigation clearance, and zero horizontal overflow were verified.
- The production build, all 251 unit tests, all 18 focused Routes browser scenarios, and all seven affected Finder planning scenarios passed on 2026-08-14, including progressive 24-route loading, canonical URLs, return scroll, planned and discovered route separation, blocked storage, invalid parameters, and empty and unavailable states.

### Slice 7

- Hash-route transitions now move focus into the destination, reset new views to their start, and restore both window and opt-in immersive-region scroll positions through browser history without disturbing query-only state changes.
- Finder now fits without header and result-shelf overlap at 768 x 576, returns an unsupported search to a neutral world view, offers a source-honest Edit search recovery action, and restores focus to the control that opened its filter sheet.
- Mobile Replay chapter controls expose chapter position, route moment, and distance in their accessible names, retain 44 px targets, remain seekable under reduced motion, and clear the configured bottom safe area.
- Desktop, compact-desktop, and phone frames were inspected across Finder, Routes, route story, Admin, and shared navigation. Atlas control and loading states were checked in one restrained production load; the provider did not settle during this pass, so no new live-terrain acceptance claim is made beyond the verified Slice 2 evidence.
- The final release gate passed on 2026-08-14: production build, all 251 unit tests, bundle budget, and all 91 production browser scenarios. The gate caught a Routes return-scroll ordering regression; the destination-specific restoration policy was fixed, its focused scenario passed, and the complete gate then passed on rerun.

### Slice 8

- Story Flight chapter derivation, active-chapter selection, and climb calculation now live in a pure module with focused unit contracts; the production HUD is independently owned by a dedicated component.
- The production-specific live phone scenario passed on 2026-08-15 in the required headed browser mode and its captured frame was visually inspected for terrain visibility, route legibility, hierarchy, control fit, and horizontal overflow.
- The ticket gate passed on 2026-08-15: production build and all 253 unit tests.
- The complete release gate passed on 2026-08-15 after the final shared-presentation consolidation: production build, all 253 unit tests, bundle budget, and all 91 production browser scenarios.
- Independent standards and specification reviews found no remaining blockers after camera metadata, controls, duration formatting, and pace formatting were given one shared owner.

### Slice 9

- Compact Story Flight now names the active chapter and exposes familiar previous and next controls instead of presenting an unexplained row of dots.
- The chapter status identifies the gold elevation-profile diamonds as route-data notes. Desktop retains direct, labeled chapter markers.
- The ticket gate passed on 2026-08-15 with the production build and all 253 unit tests. All eight focused production Replay scenarios passed, including chapter navigation, 44 px targets, safe-area clearance, and a controls dock below the 170 px terrain budget.

### Slice 10

- The route thread now renders as four intentional states: a quiet pearl context trace, a fine pearl future, a coral travelled segment, and a short blush lead.
- A custom Google 3D marker anchors the coral playhead to the recorded position. Its restrained motion halo is disabled for reduced-motion users.
- Thread width responds conservatively to camera range. The final treatment removes the previous dark casing and oversized white glint so terrain remains dominant at overview and chase distances.
- The ticket gate passed on 2026-08-16 with the production build and all 254 unit tests, including the ten-assertion cinematic style contract.
- All eight deterministic production Replay scenarios passed after the final thread and playhead values were applied.
- A headed live Google 3D Crete journey passed on 2026-08-16 and asserted the final layer widths, opacities, casing removal, playhead visibility, and motion state in the provider DOM.
- Live overview, active-playback, and chase evidence frames were captured and visually inspected against ocean, pale rock, and detailed photogrammetry.

### Slice 11

- Manual pointer, wheel, and keyboard map input now releases the authored camera while playback, telemetry, the terrain thread, and the elevation cursor continue. Recenter restores the current directed pose in one explicit action.
- Render-only route geometry now uses a camera-range tolerance, preserves exact segment endpoints and sharp turns, and skips path writes for invisible thread roles. In the live Crete playback sample, the visible layers carried 2 to 26 points and the wide context trace carried 41 points instead of the complete densified route.
- The Replay stage now records a bounded 30-second performance report through data attributes. A headed live 10-second diagnostic measured a 18.5 ms p95 frame duration and a 0.34% over-34-ms frame ratio; the formal 30-second live gate passed its 34 ms p95 and 5% dropped-frame budgets.
- Desktop following, desktop free-camera, and 390 x 844 free-camera frames were inspected against live Google terrain. The Recenter action remained legible, the phone controls retained stable targets, and the document had zero horizontal overflow.
- The complete release gate passed on 2026-08-16: production build, all 260 unit tests, bundle budget, and all 93 production browser journeys.
- The live Google matrix passed 13 of 15 journeys on its first run. Two navigator checks identified hidden-layer style drift; the renderer was corrected to preserve style contracts while skipping only expensive hidden geometry, and both affected San Francisco and Crete journeys passed on rerun.
- Independent standards and product reviews identified performance-probe overhead, tap ownership, hidden Recenter, background-tab timing, and stale paused-camera rendering. All were corrected; the final 261-unit sweep, deterministic ownership journey, two live regional journeys, 30-second budget, and production phone free-camera journey passed, and both reviewers reported no remaining blockers.
