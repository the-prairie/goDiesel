# Lifecycle state machines

This is the guide to lifecycles across the repository: the React app, the standalone admin UI, the Python owner tools, and the release scripts.

The inventory is a checked registry, [`lifecycles.json`](lifecycles.json), with a [JSON Schema](lifecycles.schema.json) beside it. The tables below are generated from it. Do not edit them by hand.

The binding decisions are [ADR-0016](../adr/0016-explicit-state-transitions-at-lifecycle-boundaries.md), [ADR-0018](../adr/0018-discriminated-reducers-for-lifecycle-state.md), and [ADR-0019](../adr/0019-recovery-dispositions-marker-protocols-and-a-checked-registry.md).

## What a lifecycle is

A lifecycle is ordered work with a phase, an operation identity, or two values that can disagree. Loading a route, running an engine, saving a draft, and publishing a bundle are lifecycles.

A boolean, a disclosure, a filter, or a URL parameter is not a lifecycle. It stays local.

## The registry

Each entry names one lifecycle and its `kind`:

- `reducer`: a pure transition function for a runtime lifecycle.
- `disposition`: a pure function that decides what crash recovery does with what it finds on disk.
- `protocol`: marker files that a script writes and another script or person reads.
- `derived`: a value computed from another source, with no stored phase.
- `left-implicit`: kept as it is on purpose. The entry records the reason.

Each entry also names its `module`, its `transition` where it has one, its `test` files, its `adapters`, its `states` as they appear in the module, and its `identity`. The identity is what rejects a stale or superseded event.

`scripts/check-lifecycles.mjs` compares the registry with the code. It runs inside `npm --prefix app run typecheck`, so the ticket gate and the release gate run it too. It fails when:

- the registry does not match the schema, or two entries share an id;
- a registered module, test, or adapter path does not exist;
- a registered transition is not exported from its module;
- no registered test mentions the transition;
- a registered state name does not appear in the module;
- a `*-state.ts` file under `app/src` or `admin-ui` has no entry;
- an exported `reduce<Name>` function under `app/src` or `admin-ui`, or a top-level Python `def reduce_<name>` at the repository root, has no entry;
- the generated block in this file is stale.

To add or change a lifecycle, edit `lifecycles.json`, then run:

```sh
node scripts/check-lifecycles.mjs --write
```

That regenerates the block below. Commit both files.

## Decision rules

These rules are in force. Each one came from a defect fixed in a merged branch.

1. A runtime lifecycle is a discriminated union and a pure reducer. Do not add a state-machine library.
2. Crash recovery is a pure disposition function. Callers observe the disk and the lock, call the function, then act. `publication_disposition` is the one rule for the generator backup and the owner journal.
3. A script lifecycle is a marker-file protocol. Write the marker last, atomically, and treat a missing marker as a failure. `.dist-manifest.json`, the share publish receipts under `.route-share/publish/`, and the live-gate `status.json` follow this rule.
4. Derive a value or key a component. Do not copy a prop or the URL into state with an effect. A copy paints one stale frame.
5. A ref that mirrors reducer state has one writer: the dispatch wrapper.
6. A frame driver may keep its state in a ref and publish throttled snapshots to React. A migration is not permission to dispatch every frame.
7. An engine's outgoing status is derived from its reducer state in one place. The engine publishes only when the reducer records a new status.
8. An async outcome carries an operation identity, and the reducer accepts it only in the matching phase.

## Stage mounting

A slug change always unmounts a Replay stage or a lab stage. `useRouteDetail` moves to `loading` in the same render as the new slug, and every stage page renders a loading notice in place of the stage while the detail loads. The Earth Replay stage is also keyed by route slug and surface kind.

Only a same-slug query change can keep a stage mounted. A page that reads a query parameter only at mount keys the stage on it. Replay keys the Earth stage by surface kind, so a `?renderer=` change opens a fresh stage. The director lab keys its stage by cut, so a `?cut=` change opens a fresh stage.

A scenario in which the previous route's state paints once on the next route cannot happen. Do not write a fix or a test for it.

## Behaviours pinned by tests

These are product decisions. Do not change them as a side effect of a refactor. A change needs its own commit, a stated reason, and an updated test.

- Keyboard play intent is retained while the provider loads. The Google Replay stage and Playable Earth accept a play command in every provider phase, and playback advances once the world is ready.
- Playback intent is retained through provider loading and unavailable. Earth Replay accepts playback commands in every status and advances frames only while the scene is operational. The director and trailer reducers keep playback intent through provider failure.
- An authentication failure is a recoverable notice, not a terminal phase. The Google renderer records it with `reason: "authentication"`. A later scene error, a failed operation, or the 30 s scene deadline of the same operation keeps that notice, and only a later `sceneReady` replaces it.
- An Atlas world that reported unavailable stays unavailable for selection. A disposed engine is terminal. `atlasEngineAcceptsSelection` decides it.
- A selected Atlas region's route cards come from bundled data and never wait on the network. `reduceAtlasPresentation` presents a region (`ready`) when the world settles on it in any outcome: terrain, a regional fallback map that loaded (`fallbackReady`) or reported unavailable (`fallbackUnavailable`), or an unavailable world. A region selected after the world reported unavailable is presented at once. A region still `waiting` after `ATLAS_REGION_PRESENTATION_DEADLINE_MS` (4 s, a timer in `atlas-page.tsx`) moves to `shown` on `presentationDeadlinePassed`, and the cards stay while the world catches up. While the world is `opening`, or once it is unavailable, Atlas lists its places from bundled data in place of the globe.
- Earth Replay chrome may auto-hide only while playing over a ready or partial scene without reduced motion. `earthReplayChromeMayAutoHide` decides it.
- A failed course save keeps the unsaved preview. `courseFailureRecovery` offers a reload only for a failed load or list.
- The route leaf map keeps its previous ready or unavailable presentation while a replacement session waits.

## Lifecycle notes

These describe the code as it is. The tables below list each lifecycle; these notes explain the parts a table cannot.

- Google key rejection. On the 3D Maps path Google gives the page no rejection signal: `gm_authFailure` is not called and `gmp-error` does not fire. That is why `app/src/providers/google-key-preflight.ts` exists. Each load of the Maps script also asks the Map Tiles API's 3D Tiles root once, beside the load and never awaited. Only an explicit `API_KEY_INVALID` answer counts. It is routed through the loader's existing auth-failure report, so the renderer receives `authenticationRejected`. Every other answer is `unknown` and changes nothing. The outcome is cached in `sessionStorage` per browser session under a fingerprint of the key. The preflight is a one-shot derived value, not a reducer. The 30 s scene deadline in the Google engine is unchanged.
- Google statuses carry their reason. The Google Replay stage and the course preview session record the renderer's reason as `statusReason` on an unavailable status and clear it on any other status, so each screen can word a key rejection for visitors.
- MapLibre Replay arms its 15 s deadline before it constructs the map, so no failure between start and load can leave a run loading with no outcome. A map that cannot be constructed (no WebGL2 context) is `unavailable` with reason `unsupported`, which is final for that run.
- The route leaf map is `unsupported` when the browser cannot give it a renderer, at construction or on a lost WebGL context. The guide shows a static route trace, and only a new session retries.
- The Atlas regional fallback map gives up at once when the connection is lost (`connectionLost`, reason `offline`) instead of waiting for its deadline. Every session clears the route paths before its geometry guard, so a session without geometry cannot keep the previous region's overlay.
- Earth Replay keeps a zoom the person chose on the renderer itself (`cameraRangeChosen`, clamped to 30 m–90 km). A zoom request steps to the nearest preset in that direction. `presentationReset` takes `shortViewport` (a viewport no taller than 500 px, such as a phone in landscape) beside `isMobile`, and either one opens the HUD compact.
- The Earth and Atlas Replay dock fit is a measured value, not reducer state. The stage observes the dock's box with a `ResizeObserver` store read through `useSyncExternalStore`. When the dock's single row overflows its box, the stage uses the compact dock until the box is again as wide as the row needed.
- The route cover artwork loader (`app/src/data/route-covers/route-cover-artwork.ts`) loads the cover manifest once per session and is `loading`, `ready`, or `unavailable`. A failed load leaves covers on their thread fallback. It is not a `*-state.ts` module and exports no `reduce<Name>`, so the checker does not require an entry, and it has none.
- The course workspace reducer is unchanged. `course-page.tsx` places each operation's progress and failure beside the control that started it: generate and import under the form, save under the preview's Save button, and loading the workspace at the top of the page.
- Views open, load, and fail inside the shell. The router's view routes carry their own error boundary (`RouteError`) under the shell, so the navigation and every view already loaded stay usable. `RootRouteError` is the last resort for a failure in the shell itself. `chunkFailure` classifies a failed view once, when it fails: `offline` when a chunk did not download without a connection (Try again waits for the connection rather than opening the browser's offline page), `unavailable` when a chunk did not download while online (reload once, for a stale deploy), and `error` for anything else. An unknown path renders a not-found page inside the shell instead of redirecting to Atlas, and such a page marks no section current.

## Inventory

<!-- BEGIN GENERATED: lifecycles.json -->
<!-- Generated from docs/architecture/lifecycles.json by `node scripts/check-lifecycles.mjs --write`. Do not edit by hand. -->

| Kind | Entries |
| --- | --- |
| `reducer` | 40 |
| `disposition` | 1 |
| `protocol` | 3 |
| `derived` | 7 |
| `left-implicit` | 10 |
| total | 61 |

### Reducers

| Lifecycle | Owns | Module | Transition | States | Stale events rejected by |
| --- | --- | --- | --- | --- | --- |
| `route-detail-load` | Loads one route detail and remembers the last settled result for a return to the same slug and request key. | `app/src/data/route-detail-state.ts` | `reduceRouteDetailLoad` | `idle`, `loading`, `settled` | slug and requestKey; the hook dispatches loadStarted during render |
| `collection-search` | Loads the guide search index, then refines with embeddings or falls back to keywords. | `app/src/data/search/collection-search-state.ts` | `reduceCollectionSearch` | `idle`, `loadingIndex`, `basicFallback`, `keywordReady`, `embedding`, `semanticReady`, `keywordFallback` | requestId; indexFailed is accepted only in loadingIndex |
| `external-ranking` | Ranks discovered routes semantically, or falls back to keywords. | `app/src/data/search/external-ranking-state.ts` | `reduceExternalRanking` | `idle`, `embedding`, `semanticReady`, `keywordFallback` | requestId |
| `planned-route-cache` | The tab's view of planned routes in localStorage, including routes that storage refused. | `app/src/data/planned-route-store.ts` | `reducePlannedRouteCache` | `unread`, `persisted`, `memory-only` | the raw storage value; memory-only ignores reads and storage events until a write succeeds |
| `finder-discovery` | Finder external discovery: place resolution, place choice, route request, selection, and save feedback. | `app/src/surfaces/finder/discovery-state.ts` | `reduceDiscovery` | `idle`, `resolving-place`, `choosing-place`, `no-places`, `loading-routes`, `results`, `failed` | submission id per mounted component |
| `finder-draft` | The Finder form draft, which may differ from the submitted intent in the URL until the next search. | `app/src/surfaces/finder/finder-draft-state.ts` | `reduceFinderDraft` | none | baseKey, the submittedIntentKey the draft was edited against; visibleDraft ignores a draft for another submission |
| `course-workspace` | The course page view and its one pending operation, including which operation failed. | `app/src/surfaces/courses/course-workspace-state.ts` | `reduceCourseWorkspace` | `view:empty`, `view:preview`, `view:saved`, `progress:idle`, `progress:pending`, `progress:failed` | pending operation id |
| `course-place-search` | The start-place search beside the course form. | `app/src/surfaces/courses/course-form.tsx` | `placeReducer` | `idle`, `searching`, `choices`, `chosen`, `error` | search id |
| `course-preview-load` | Loads one course for preview. The page keys the loader by course id. | `app/src/surfaces/replay/playback/course-preview-state.ts` | `reduceCoursePreviewLoad` | `loading`, `ready`, `failed` | operationId |
| `course-preview-session` | Provider status and replay commands for one course preview section. | `app/src/surfaces/replay/playback/course-preview-state.ts` | `reduceCoursePreviewSession` | `loading`, `statusReason:authentication` | none in the reducer; the page keys each section by index and attempt |
| `replay-session` | Playback, camera, following, and grounding commands shared by the Google Replay stage and course preview. | `app/src/surfaces/replay/playback/replay-session-state.ts` | `reduceReplaySession` | none | nothing |
| `replay-chapter-controls` | Replay chapter and moment preview against following playback, at lens or whole-route scope. | `app/src/surfaces/replay/playback/replay-chapter-controls-state.ts` | `reduceReplayChapterControls` | `mode:following`, `mode:preview`, `scope:lens`, `scope:whole` | nothing |
| `replay-surface` | Which Replay renderer the page shows: the URL renderer, or Atlas after a Google start failure. | `app/src/surfaces/replay/playback/replay-surface-state.ts` | `reduceReplaySurface` | `kind:google`, `kind:atlas`, `kind:cesium`, `reason:requested`, `reason:degraded` | renderer query and route slug, compared by replaySurfaceMatches during render |
| `earth-replay-session` | One Earth Replay stage: renderer mode, provider status, playback, HUD mode, and mobile controls. | `app/src/surfaces/replay/playback/earth-replay-session-state.ts` | `reduceEarthReplaySession` | `status:loading`, `context:preview`, `context:compact` | sessionId minted by rendererMounted; the stage is keyed by route slug and surface kind |
| `google-replay-stage` | One Google Replay stage: provider status, replay commands, settings disclosure, and chapter expansion. | `app/src/surfaces/replay/playback/google-replay-stage-state.ts` | `reduceGoogleReplayStage` | `status:loading`, `status:unavailable`, `statusReason:authentication` | sessionId minted by sessionStarted |
| `google-renderer` | The native Google 3D engine: API load, scene load, ready, unavailable, destroyed. | `app/src/surfaces/replay/renderers/google-renderer-state.ts` | `reduceGoogleRenderer` | `idle`, `loadingApi`, `loadingScene`, `ready`, `unavailable`, `destroyed`, `reason:authentication` | operationId minted by mountStarted and destroyed |
| `cesium-fidelity` | The Cesium Replay engine run and every status it publishes. | `app/src/surfaces/replay/renderers/cesium-fidelity-state.ts` | `reduceCesiumFidelity` | `idle`, `loading`, `ready`, `partial`, `unavailable`, `disposed` | operationId minted by sessionStarted (cesiumRunIsCurrent); statusRevision marks each published status |
| `maplibre-replay` | The MapLibre Replay engine run and every status it publishes, including a map that cannot be constructed (unsupported). | `app/src/surfaces/replay/renderers/maplibre-replay-state.ts` | `reduceMapLibreReplay` | `idle`, `loading`, `ready`, `unavailable`, `reason:unsupported`, `disposed` | operationId minted by mapStarted (mapLibreRunIsCurrent); statusRevision marks each published status |
| `surface-sampling` | Throttled terrain surface sampling under the moving marker. | `app/src/surfaces/replay/renderers/surface-sampling-state.ts` | `reduceSurfaceSampling` | `idle`, `sampling`, `disposed` | requestId |
| `marker-photo` | Uploading and cropping the person's Replay marker photo. | `app/src/surfaces/replay/playback/marker-photo-state.ts` | `reduceMarkerPhoto` | `idle`, `loading`, `cropping` | requestId |
| `cinematic-director` | The director cut stage: playback, audio start, sound, and renderer status for one session. | `app/src/surfaces/replay/cinematic/cinematic-director-state.ts` | `reduceCinematicDirector` | `playback:paused`, `playback:playing`, `audioStart:idle`, `audioStart:pending` | sessionId for renderer status; audio requestId minted by playRequested; the lab page keys the stage by cut |
| `route-trailer` | The route trailer stage: playback, frame, and provider status for one session. | `app/src/surfaces/replay/cinematic/trailer-state.ts` | `reduceTrailer` | `playback:paused`, `playback:playing`, `status:loading`, `status:unavailable` | sessionId minted by sessionStarted; playback, skip, and frames are accepted only while ready |
| `playable-earth-session` | The Playable Earth lab stage: provider status, grounding, control, HUD mode, and mobile controls. | `app/src/labs/playable-earth/playable-earth-session-state.ts` | `reducePlayableEarthSession` | none | sessionId for provider and grounding reports |
| `overland-jump` | The Overland lab's jump from the pixel world into a route's Google 3D replay and back: dive, hold, the reveal under our pixel cover or the 3D town fading over the live map, the realm, surfacing, and the pixel fallback. | `app/src/labs/overland/overland-jump-state.ts` | `reduceOverlandJump` | `browsing`, `diving`, `holding`, `resolving`, `realm`, `surfacing`, `fallback`, `transition:wipe`, `transition:live`, `transition:town` | jumpId minted by jumpRequested; diveFinished, sceneStatusReceived, resolveStepElapsed, and surfaceFinished must name the current jump |
| `overland-town` | Opening one of her places as a 3D pixel town: the renderer chunk loads, WebGL starts and the town draws its first frame; a missing WebGL, a failed chunk, a renderer error or a lost context falls back to the pixel town; while ready the quality tier only steps down. | `app/src/labs/overland/overland-town-state.ts` | `reduceOverlandTown` | `idle`, `loading`, `ready`, `fallback` | loadId minted by loadStarted; rendererReady, rendererFailed, contextLost and qualityLowered must name the current load, and fallback is final for its load |
| `overland-moments` | Her annotations met along a route in the Overland realm: a moment ahead is approached (playback slows), shown when reached (slower), put away after a while or on request, paused while its photo is open; moments reached together queue; scrubbing forward skips and scrubbing back re-arms. | `app/src/labs/overland/overland-moments-state.ts` | `reduceOverlandMoments` | `idle`, `approaching`, `showing`, `mediaOpen`, `dismissed` | the annotation id: dismissRequested, mediaOpened and mediaClosed must name the moment on screen; progress is compared with the last progress the reducer saw |
| `route-intelligence` | The route intelligence lab load: complete, partial, empty, or failed. | `app/src/labs/route-intelligence/route-intelligence-state.ts` | `reduceRouteIntelligence` | `loading`, `complete`, `partial`, `empty`, `failed` | nothing |
| `admin-workspace` | The React Admin workspace, route detail loads, and per-route saves. | `app/src/surfaces/admin/workspace-state.ts` | `reduceAdminWorkspace` | `loading`, `ready`, `save:idle`, `save:saving`, `save:saved`, `save:failed` | requestId per route detail and per route save |
| `atlas-presentation` | Atlas world status, whether a world has opened, and whether the selected region waits for the world, is presented, or is shown at its deadline. | `app/src/surfaces/atlas/atlas-presentation-state.ts` | `reduceAtlasPresentation` | `region:none`, `region:waiting`, `region:ready`, `region:shown`, `world:opening`, `world:open` | engineId |
| `atlas-regional-fallback` | The MapLibre regional fallback map shown when Atlas terrain is unavailable. | `app/src/surfaces/atlas/regional-fallback-state.ts` | `reduceRegionalFallback` | `loading`, `ready`, `unavailable`, `reason:offline` | session |
| `atlas-regional-transition` | The Atlas globe's move into regional terrain and back to the global view. | `app/src/surfaces/atlas/regional-transition-state.ts` | `reduceRegionalTransition` | `global`, `loading`, `ready`, `fallback`, `disposed` | operationId (regionalOperationIsCurrent) |
| `atlas-world-engine` | One Cesium Atlas engine: mount, the global camera flight, the published status and canvas dataset. Composes the regional transition. | `app/src/surfaces/atlas/atlas-world-engine-state.ts` | `reduceAtlasWorldEngine` | `mount:idle`, `mount:mounting`, `mount:ready`, `mount:unavailable`, `mount:disposed`, `reason:webgl`, `reason:mount`, `reason:render`, `camera:settled`, `camera:flying` | operationId per mount run (atlasEngineRunIsCurrent) and flightId per global flight; unavailable is terminal for selection and disposed is terminal |
| `route-leaf-map` | The route guide's leaf map: waiting for the map, ready, unavailable after a deadline or errors, or unsupported when the browser cannot start a renderer. | `app/src/surfaces/routes/components/route-leaf-map-state.ts` | `reduceRouteLeafMap` | `inactive`, `waiting`, `ready`, `unsupported`, `status:loading`, `status:unavailable` | sessionId |
| `planning-map` | The planning route map: loading, ready, or unavailable after a deadline or errors. | `app/src/ui/planning-map-state.ts` | `reducePlanningMap` | `loading`, `ready`, `unavailable` | operationId |
| `admin-ui-mutation` | Standalone admin route drafts, save, route refreshes, and the rebuild it follows to an outcome. | `admin-ui/mutation-state.ts` | `reduceMutation` | `save:idle`, `save:saving`, `save:refreshing`, `rebuild:idle`, `rebuild:starting`, `rebuild:running`, `rebuild:succeeded`, `rebuild:failed` | requestId for save and rebuild start; only latestRefreshId may replace routes; rebuild run id |
| `admin-ui-classifier` | Standalone admin classifier start and status polling, including a run that stopped early. | `admin-ui/classifier-state.ts` | `reduceClassifier` | `start:idle`, `start:starting`, `poll:idle`, `poll:checking`, `poll:failed`, `poll:running`, `poll:complete`, `notice:runFailed` | requestId for start; pollId for status |
| `admin-rebuild` | One background build.py run at a time in the owner server. | `admin_rebuild.py` | `reduce_rebuild` | `idle`, `running`, `succeeded`, `failed` | run id; succeed and fail must name the running id |
| `admin-classify` | The owner server's background region classifier and its snapshot phase. | `admin_classify.py` | `reduce_classify` | `idle`, `running`, `finished`, `failed` | none; admin.py serialises events under a lock, a second start while running is a no-op, and progress must be the next count |
| `sketch-map` | The sketch world's MapLibre map: it loads, is ready once its style has drawn, is unavailable without WebGL, and is degraded (paper and her routes, still usable) while its tiles fail, recovering when they load again. | `app/src/labs/sketch/sketch-map-state.ts` | `reduceSketchMap` | `idle`, `loading`, `ready`, `degraded`, `unavailable` | a load id per map; events from an earlier load are ignored |
| `sketch-handover` | The sketch world's hand-over from the drawn (OpenStreetMap) city to the real-geometry (Google Photorealistic 3D) sketch: zooming into a covered city on a capable device loads the real city while the drawn one stays; it fades in once its first view is drawn, is declined if too slow or failing, and fades out and is torn down below the exit zoom. | `app/src/labs/sketch/sketch-handover-state.ts` | `reduceHandover` | `drawn`, `loading`, `fadingIn`, `real`, `fadingOut`, `declined` | a load id minted per attempt; firstViewDrawn, timedOut, failed and fadeFinished must name the current load |

### Dispositions

| Lifecycle | Owns | Module | Transition | Outcomes | Guarded by |
| --- | --- | --- | --- | --- | --- |
| `publication-disposition` | What crash recovery does with a generator backup or an owner journal it finds. | `publication_protocol.py` | `publication_disposition` | `none`, `discard`, `restore`, `committed-cleanup`, `blocked` | the generator lock; a journal with a live lock holder is blocked |

### Marker-file protocols

| Lifecycle | Owns | Module | States | Identity |
| --- | --- | --- | --- | --- |
| `dist-manifest` | What dist/ is: a full or single-route build, recorded as the last step of make-dist.sh. | `scripts/dist-manifest.mjs` | `full`, `single-route` | .dist-manifest.json content_digest and file_count; a missing manifest is a failed or interrupted build |
| `share-publish-receipt` | How far one single-route share publish got. | `scripts/publish-route-microsite.sh` | `validated`, `deployed`, `smoke-passed`, `smoke-failed`, `deploy-failed` | one receipt per run under .route-share/publish/, named by share name and UTC stamp |
| `live-gate-status` | Whether a live-pipeline evidence directory proves a passing live gate. | `scripts/verify-live-pipeline.sh` | `running`, `passed`, `failed`, `interrupted` | status.json in each timestamped evidence directory; no status.json reads as blocked |

### Derived, not stored

| Lifecycle | Owns | Module | Values | Why |
| --- | --- | --- | --- | --- |
| `mobile-breakpoint` | Whether the viewport is below the mobile breakpoint. | `app/src/ui/use-mobile.ts` | none | Read from matchMedia with useSyncExternalStore during render, so a phone never paints the desktop layout first. There is no stored phase. |
| `legacy-quest-link` | Legacy #quest/<slug> links. | `app/src/app/route-paths.ts` | none | The URL is the state. The router matches quest/:legacySlug itself and its loader replaces the entry with the route guide path, so no listener races the router. A link opened before the app starts is rewritten by canonicalizeLegacyQuestHash. |
| `route-film` | A route film record: queued, rendering, failed, or ready with a poster. | `app/src/labs/route-film/route-film.ts` | `queued`, `rendering`, `failed`, `ready` | A closed union validated at parse time. The app reads it and never transitions it. |
| `route-thumbnail` | A regional route card's satellite thumbnail state. | `app/src/surfaces/atlas/components/route-satellite-thumbnail.tsx` | `deferred`, `loading`, `loaded`, `failed`, `unavailable` | Only the image's own load or error outcome is stored. routeThumbnailState derives the rest from the URL and whether the card may load. Cards are keyed by route slug, so the URL is fixed while mounted. |
| `google-key-preflight` | Whether Google rejects the Maps key, asked once per browser session of the 3D Tiles root. | `app/src/providers/google-key-preflight.ts` | `invalid`, `unknown` | A one-shot answer, not a phase machine. On the 3D Maps path Google gives the page no rejection signal, so the loader asks the 3D Tiles root once, beside the script load, and caches the outcome in sessionStorage under the key fingerprint. Only an explicit API_KEY_INVALID answer is invalid; it is reported through the loader's auth-failure event. Anything else is unknown and changes nothing. |
| `geocode-outcome` | The result of one reverse-geocode lookup. | `admin_geocode.py` | `label`, `no_place`, `transient` | An outcome type, not a phase machine. A transient outcome is never cached. |
| `route-status` | A route's triage status in quests.json. | `quest_meta.py` | `pending`, `approved`, `archived` | A closed record set, not a transition. A missing or unknown value reads as pending, legacy rejected reads as archived, and only approved is published. |

### Left implicit on purpose

| Lifecycle | Owns | Module | Why |
| --- | --- | --- | --- |
| `atlas-search-panel` | The Atlas search panel phase and its open flag. | `app/src/surfaces/atlas/components/atlas-search.tsx` | searchState derives the panel phase from the query and selection on every render. searchOpen is a local disclosure. |
| `carousel-programmatic-selection` | Suppresses the carousel's own echo of a selection it made by scrolling. | `app/src/surfaces/atlas/components/region-route-carousel.tsx` | A one-slot ref latch, set by selectRoute and cleared by the matching scroll settle or the next microtask. It holds no phase that rendering reads. |
| `route-library-return` | The route library path and scroll position to restore after opening a route. | `app/src/data/route-library-return.ts` | One sessionStorage record, written on leaving the library and taken once on return. Restoration is best-effort when storage is unavailable. |
| `google-maps-loader` | Loading the Google Maps JavaScript API script once per page. | `app/src/providers/google-maps-loader.ts` | A module singleton promise. A failed load clears it, so the next caller appends a fresh script. After a successful load the gm_authFailure handler stays installed, because Google reports a rejected key after the load callback; a rejection already received is re-reported to the next load request. Each load also starts the key preflight (google-key-preflight) once per key and never awaits it; only its invalid answer is reported, through the same auth-failure event. |
| `route-leaf-map-carried-status` | The leaf map keeps its previous ready or unavailable presentation while a replacement session waits. | `app/src/surfaces/routes/components/route-leaf-map-state.ts` | Product behaviour pinned by the test that retains presentation during effect replacement. Readiness and the error count still reset. |
| `atlas-selection-copy` | Atlas copies the selected region name into the presentation reducer. | `app/src/surfaces/atlas/atlas-page.tsx` | A layout effect dispatches selectionChanged before paint, so no stale frame shows. |
| `chunk-recovery` | Reloading the shell once after a failed dynamic import, and classifying why a view could not open. | `app/src/app/chunk-recovery.ts` | Two outcomes, each already a function: reload once per shell, or leave the manual retry. Offline and blocked storage skip the reload. chunkFailure classifies a failed view once, when it fails, as offline, unavailable, or error, and the in-shell RouteError words each one. |
| `finder-presentation` | Finder filter disclosure and list or map view. | `app/src/surfaces/finder/finder-page.tsx` | filtersOpen and view are local choices. view may stay map when the result is not a match list; the screen then shows the list. |
| `discovery-throttle` | The discovery API's minimum interval between upstream searches. | `app/server/discovery.ts` | One module-level timestamp per server instance. A request inside the interval gets 429 and nothing else depends on it. |
| `course-store` | Saved courses on the server. | `app/server/courses.ts` | The store is the record. FileCourseStore and R2CourseStore implement CourseStore with no runtime phase. |

<!-- END GENERATED: lifecycles.json -->

## Left implicit

The entries of kind `left-implicit` above are deliberate. Each reason is in the registry. Convert one only when a defect or a new outcome needs it, and update its entry in the same change.

## Follow-ups

These are open. Each is a known gap, not a decision.

- The regional fallback clears its route paths before its geometry guard, but no automated test covers a session without geometry, because every bundled region has geometry.
- An unrecorded climb still reads as 0 in region totals, in the maximum-climb filter, in search indexing, and in the route genome.
- `usePlannedRouteStorageStatus` exposes the planned-route memory-only mode, but no screen shows a "saved only in this tab" notice.
- The standalone admin polls a running rebuild every two seconds with no deadline. If the owner server dies, polling never stops.
- After a save, the standalone admin clears the drafts and refreshes. If that refresh fails, the cards are not re-rendered, so their dirty marking is stale.
- Published media files are never removed when no route references them, so they still ship.
- The route cover source image is cached by slug only. A changed route bounding box reuses the old image.
- The route film resume fingerprint names the route by slug only. A changed route record does not invalidate a partial export.
- Source and projection freshness has no named state. `search:check` compares the search index with the generated projections, but nothing records whether the projections are current with `quests.json`.
- Real-provider behaviour of the renderer changes is unproven until the live gate passes. Read it with `./scripts/live-gate-status.sh latest`.
- The Atlas engine conversion changed the camera. Before production, run `e2e/atlas-region-live.spec.ts` and `e2e/design-review-live.spec.ts` with the live configuration. `e2e/atlas-attribution-live.spec.ts` and `e2e/atlas-globe-quality-live.spec.ts` are advisable. Each spec skips without its environment variable, and a skip is not a pass.
- Five Python tests and any real `build.py` run need the private Strava export. They cannot be verified without it.

## What does not earn a reducer

Each of these is one choice. ADR-0016 leaves them local.

- Atlas activity mode is the `activity` query on `atlas-page.tsx`.
- The route guide sheet is `peek`, `half`, or `expanded` in `route-detail-page.tsx`.
- Replay chapter relief or profile, and its two disclosure booleans, live in `replay-chapter-controls.tsx`.
- The replay route picker is open or closed, plus a query string, in `replay-route-picker.tsx`.
- Course create mode is `generate` or `import` in `course-form.tsx`.
- The course page token and connection counter only retrigger `reduceCourseWorkspace`.
- Hash routes are the URL. ADR-0016 forbids a second store that copies them.
- `useIsMobile` is derived from the media query on every render. It is in the registry as `derived`.
- The Replay dock fit is measured from the dock's box in `earth-replay-stage.tsx`. It is not session state.
- The route cover artwork load is one module-level request per session in `route-cover-artwork.ts`.

Domain enums are closed records, not UI transitions. Geometry status is `ready`, `missing`, or `invalid`. Curation review status is `draft`, `reviewed`, or `published`. Route triage status is `pending`, `approved`, or `archived`.
