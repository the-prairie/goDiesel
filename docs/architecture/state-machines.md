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
- An authentication failure is a recoverable notice, not a terminal phase. The Google renderer lets a later `sceneReady` replace the notice while the API or scene is still loading.
- An Atlas world that reported unavailable stays unavailable for selection. A disposed engine is terminal. `atlasEngineAcceptsSelection` decides it.
- Earth Replay chrome may auto-hide only while playing over a ready or partial scene without reduced motion. `earthReplayChromeMayAutoHide` decides it.
- A failed course save keeps the unsaved preview. `courseFailureRecovery` offers a reload only for a failed load or list.
- The route leaf map keeps its previous ready or unavailable presentation while a replacement session waits.

## Inventory

<!-- BEGIN GENERATED: lifecycles.json -->
<!-- Generated from docs/architecture/lifecycles.json by `node scripts/check-lifecycles.mjs --write`. Do not edit by hand. -->

| Kind | Entries |
| --- | --- |
| `reducer` | 35 |
| `disposition` | 1 |
| `protocol` | 3 |
| `derived` | 6 |
| `left-implicit` | 10 |
| total | 55 |

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
| `course-preview-session` | Provider status and replay commands for one course preview section. | `app/src/surfaces/replay/playback/course-preview-state.ts` | `reduceCoursePreviewSession` | `loading` | none in the reducer; the page keys each section by index and attempt |
| `replay-session` | Playback, camera, following, and grounding commands shared by the Google Replay stage and course preview. | `app/src/surfaces/replay/playback/replay-session-state.ts` | `reduceReplaySession` | none | nothing |
| `replay-chapter-controls` | Replay chapter and moment preview against following playback, at lens or whole-route scope. | `app/src/surfaces/replay/playback/replay-chapter-controls-state.ts` | `reduceReplayChapterControls` | `mode:following`, `mode:preview`, `scope:lens`, `scope:whole` | nothing |
| `replay-surface` | Which Replay renderer the page shows: the URL renderer, or Atlas after a Google start failure. | `app/src/surfaces/replay/playback/replay-surface-state.ts` | `reduceReplaySurface` | `kind:google`, `kind:atlas`, `kind:cesium`, `reason:requested`, `reason:degraded` | renderer query and route slug, compared by replaySurfaceMatches during render |
| `earth-replay-session` | One Earth Replay stage: renderer mode, provider status, playback, HUD mode, and mobile controls. | `app/src/surfaces/replay/playback/earth-replay-session-state.ts` | `reduceEarthReplaySession` | `status:loading`, `context:preview`, `context:compact` | sessionId minted by rendererMounted; the stage is keyed by route slug and surface kind |
| `google-replay-stage` | One Google Replay stage: provider status, replay commands, settings disclosure, and chapter expansion. | `app/src/surfaces/replay/playback/google-replay-stage-state.ts` | `reduceGoogleReplayStage` | `status:loading`, `status:unavailable`, `statusReason:authentication` | sessionId minted by sessionStarted |
| `google-renderer` | The native Google 3D engine: API load, scene load, ready, unavailable, destroyed. | `app/src/surfaces/replay/renderers/google-renderer-state.ts` | `reduceGoogleRenderer` | `idle`, `loadingApi`, `loadingScene`, `ready`, `unavailable`, `destroyed`, `reason:authentication` | operationId minted by mountStarted and destroyed |
| `cesium-fidelity` | The Cesium Replay engine run and every status it publishes. | `app/src/surfaces/replay/renderers/cesium-fidelity-state.ts` | `reduceCesiumFidelity` | `idle`, `loading`, `ready`, `partial`, `unavailable`, `disposed` | operationId minted by sessionStarted (cesiumRunIsCurrent); statusRevision marks each published status |
| `maplibre-replay` | The MapLibre Replay engine run and every status it publishes. | `app/src/surfaces/replay/renderers/maplibre-replay-state.ts` | `reduceMapLibreReplay` | `idle`, `loading`, `ready`, `unavailable`, `disposed` | operationId minted by mapStarted (mapLibreRunIsCurrent); statusRevision marks each published status |
| `surface-sampling` | Throttled terrain surface sampling under the moving marker. | `app/src/surfaces/replay/renderers/surface-sampling-state.ts` | `reduceSurfaceSampling` | `idle`, `sampling`, `disposed` | requestId |
| `marker-photo` | Uploading and cropping the person's Replay marker photo. | `app/src/surfaces/replay/playback/marker-photo-state.ts` | `reduceMarkerPhoto` | `idle`, `loading`, `cropping` | requestId |
| `cinematic-director` | The director cut stage: playback, audio start, sound, and renderer status for one session. | `app/src/surfaces/replay/cinematic/cinematic-director-state.ts` | `reduceCinematicDirector` | `playback:paused`, `playback:playing`, `audioStart:idle`, `audioStart:pending` | sessionId for renderer status; audio requestId minted by playRequested; the lab page keys the stage by cut |
| `route-trailer` | The route trailer stage: playback, frame, and provider status for one session. | `app/src/surfaces/replay/cinematic/trailer-state.ts` | `reduceTrailer` | `playback:paused`, `playback:playing`, `status:loading`, `status:unavailable` | sessionId minted by sessionStarted; playback, skip, and frames are accepted only while ready |
| `playable-earth-session` | The Playable Earth lab stage: provider status, grounding, control, HUD mode, and mobile controls. | `app/src/labs/playable-earth/playable-earth-session-state.ts` | `reducePlayableEarthSession` | none | sessionId for provider and grounding reports |
| `route-intelligence` | The route intelligence lab load: complete, partial, empty, or failed. | `app/src/labs/route-intelligence/route-intelligence-state.ts` | `reduceRouteIntelligence` | `loading`, `complete`, `partial`, `empty`, `failed` | nothing |
| `admin-workspace` | The React Admin workspace, route detail loads, and per-route saves. | `app/src/surfaces/admin/workspace-state.ts` | `reduceAdminWorkspace` | `loading`, `ready`, `save:idle`, `save:saving`, `save:saved`, `save:failed` | requestId per route detail and per route save |
| `atlas-presentation` | Atlas world status, whether a world has opened, and whether the selected region waits for the world, is presented, or is shown at its deadline. | `app/src/surfaces/atlas/atlas-presentation-state.ts` | `reduceAtlasPresentation` | `region:none`, `region:waiting`, `region:ready`, `region:shown`, `world:opening`, `world:open` | engineId |
| `atlas-regional-fallback` | The MapLibre regional fallback map shown when Atlas terrain is unavailable. | `app/src/surfaces/atlas/regional-fallback-state.ts` | `reduceRegionalFallback` | `loading`, `ready`, `unavailable` | session |
| `atlas-regional-transition` | The Atlas globe's move into regional terrain and back to the global view. | `app/src/surfaces/atlas/regional-transition-state.ts` | `reduceRegionalTransition` | `global`, `loading`, `ready`, `fallback`, `disposed` | operationId (regionalOperationIsCurrent) |
| `atlas-world-engine` | One Cesium Atlas engine: mount, the global camera flight, the published status and canvas dataset. Composes the regional transition. | `app/src/surfaces/atlas/atlas-world-engine-state.ts` | `reduceAtlasWorldEngine` | `mount:idle`, `mount:mounting`, `mount:ready`, `mount:unavailable`, `mount:disposed`, `reason:webgl`, `reason:mount`, `reason:render`, `camera:settled`, `camera:flying` | operationId per mount run (atlasEngineRunIsCurrent) and flightId per global flight; unavailable is terminal for selection and disposed is terminal |
| `route-leaf-map` | The route guide's leaf map: waiting for the map, ready, or unavailable after a deadline or errors. | `app/src/surfaces/routes/components/route-leaf-map-state.ts` | `reduceRouteLeafMap` | `inactive`, `waiting`, `ready`, `status:loading`, `status:unavailable` | sessionId |
| `planning-map` | The planning route map: loading, ready, or unavailable after a deadline or errors. | `app/src/ui/planning-map-state.ts` | `reducePlanningMap` | `loading`, `ready`, `unavailable` | operationId |
| `admin-ui-mutation` | Standalone admin route drafts, save, route refreshes, and the rebuild it follows to an outcome. | `admin-ui/mutation-state.ts` | `reduceMutation` | `save:idle`, `save:saving`, `save:refreshing`, `rebuild:idle`, `rebuild:starting`, `rebuild:running`, `rebuild:succeeded`, `rebuild:failed` | requestId for save and rebuild start; only latestRefreshId may replace routes; rebuild run id |
| `admin-ui-classifier` | Standalone admin classifier start and status polling, including a run that stopped early. | `admin-ui/classifier-state.ts` | `reduceClassifier` | `start:idle`, `start:starting`, `poll:idle`, `poll:checking`, `poll:failed`, `poll:running`, `poll:complete`, `notice:runFailed` | requestId for start; pollId for status |
| `admin-rebuild` | One background build.py run at a time in the owner server. | `admin_rebuild.py` | `reduce_rebuild` | `idle`, `running`, `succeeded`, `failed` | run id; succeed and fail must name the running id |
| `admin-classify` | The owner server's background region classifier and its snapshot phase. | `admin_classify.py` | `reduce_classify` | `idle`, `running`, `finished`, `failed` | none; admin.py serialises events under a lock, a second start while running is a no-op, and progress must be the next count |

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
| `geocode-outcome` | The result of one reverse-geocode lookup. | `admin_geocode.py` | `label`, `no_place`, `transient` | An outcome type, not a phase machine. A transient outcome is never cached. |
| `route-status` | A route's triage status in quests.json. | `quest_meta.py` | `pending`, `approved`, `archived` | A closed record set, not a transition. A missing or unknown value reads as pending, legacy rejected reads as archived, and only approved is published. |

### Left implicit on purpose

| Lifecycle | Owns | Module | Why |
| --- | --- | --- | --- |
| `atlas-search-panel` | The Atlas search panel phase and its open flag. | `app/src/surfaces/atlas/components/atlas-search.tsx` | searchState derives the panel phase from the query and selection on every render. searchOpen is a local disclosure. |
| `carousel-programmatic-selection` | Suppresses the carousel's own echo of a selection it made by scrolling. | `app/src/surfaces/atlas/components/region-route-carousel.tsx` | A one-slot ref latch, set by selectRoute and cleared by the matching scroll settle or the next microtask. It holds no phase that rendering reads. |
| `route-library-return` | The route library path and scroll position to restore after opening a route. | `app/src/data/route-library-return.ts` | One sessionStorage record, written on leaving the library and taken once on return. Restoration is best-effort when storage is unavailable. |
| `google-maps-loader` | Loading the Google Maps JavaScript API script once per page. | `app/src/providers/google-maps-loader.ts` | A module singleton promise. A failed load clears it, so the next caller appends a fresh script. After a successful load the gm_authFailure handler stays installed, because Google reports a rejected key after the load callback; a rejection already received is re-reported to the next load request. |
| `route-leaf-map-carried-status` | The leaf map keeps its previous ready or unavailable presentation while a replacement session waits. | `app/src/surfaces/routes/components/route-leaf-map-state.ts` | Product behaviour pinned by the test that retains presentation during effect replacement. Readiness and the error count still reset. |
| `atlas-selection-copy` | Atlas copies the selected region name into the presentation reducer. | `app/src/surfaces/atlas/atlas-page.tsx` | A layout effect dispatches selectionChanged before paint, so no stale frame shows. |
| `chunk-recovery` | Reloading the shell once after a failed dynamic import. | `app/src/app/chunk-recovery.ts` | Two outcomes, each already a function: reload once per shell, or leave the manual retry. Offline and blocked storage skip the reload. |
| `finder-presentation` | Finder filter disclosure and list or map view. | `app/src/surfaces/finder/finder-page.tsx` | filtersOpen and view are local choices. view may stay map when the result is not a match list; the screen then shows the list. |
| `discovery-throttle` | The discovery API's minimum interval between upstream searches. | `app/server/discovery.ts` | One module-level timestamp per server instance. A request inside the interval gets 429 and nothing else depends on it. |
| `course-store` | Saved courses on the server. | `app/server/courses.ts` | The store is the record. FileCourseStore and R2CourseStore implement CourseStore with no runtime phase. |

<!-- END GENERATED: lifecycles.json -->

## Left implicit

The entries of kind `left-implicit` above are deliberate. Each reason is in the registry. Convert one only when a defect or a new outcome needs it, and update its entry in the same change.

## Follow-ups

These are open. Each is a known gap, not a decision.

- In progress on another branch: an Atlas region picked after the world reported unavailable stays `waiting` in `reduceAtlasPresentation`, because the engine refuses the selection and publishes no further status. The screen shows a loading message that never ends.
- In progress on another branch: a regional-fallback fix for stale route paths.
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

Domain enums are closed records, not UI transitions. Geometry status is `ready`, `missing`, or `invalid`. Curation review status is `draft`, `reviewed`, or `published`. Route triage status is `pending`, `approved`, or `archived`.
