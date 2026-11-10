# Lifecycle state machines

Reference for the lifecycles in the React app and the Python pipeline. The binding decision is [ADR-0018](../adr/0018-discriminated-reducers-for-lifecycle-state.md). It confirms [ADR-0016](../adr/0016-explicit-state-transitions-at-lifecycle-boundaries.md).

A lifecycle here is ordered work with a phase, a request identity, or two flags that can disagree. A disclosure, a filter, or a URL parameter is listed at the end and does not earn a reducer.

The audit found 10 implicit lifecycles and 26 that were already pure reducers. This change converts the first three implicit ones. The Atlas screen is not converted. Draft PR 172 is redesigning that layout on `cursor/atlas-mobile-prototypes-53cb`.

## Converted in this change

### Route detail load

`app/src/data/route-detail-state.ts`, read by `useRouteDetail`.

States are `idle`, `loading` for one slug and request key, and `settled` with that same slug, key, and a `ready`, `not-found`, `invalid`, or `error` result. Events are `selectionCleared`, `loadStarted`, and `resultReceived`.

The old hook stored the last result and derived loading when the slug or key did not match. The stored object could hold one route while the screen asked for another. A loading value can no longer carry a result. A result for a different slug or key is ignored. Clearing the selection drops the result.

No user-visible change. The repository already turns a failed fetch into `error`, so the hook does not hang on a network failure.

UX gain is low. DX and AX gain is high, because Replay, the route guide, and Finder all read this hook.

### Replay surface choice

`app/src/surfaces/replay/playback/replay-surface-state.ts`, owned by `ReplayPage`.

The renderer query is `google`, `atlas`, or `cesium`. `degraded` is true only while the query is still Google and the person has asked to leave a Google start failure. Events are `paramsChanged` and `googleDegraded`. The visible kind is Cesium, else Atlas when the query says Atlas or the fallback is set, else Google.

The old page stored a boolean and copied the query into it from an effect. After `?renderer=atlas` went away, or after the route changed, the next paint could still be the Atlas stage. That combination is now unrepresentable. The query and the route update the choice in the same render.

UX gain is the missing stale frame. DX and AX gain is medium. The Google engine lifecycle stays in `google-renderer-state.ts`.

### Admin region classifier

`admin_classify.py`, driven by `admin.py`.

Phases are `idle`, `running` with `done`, `total`, `updated`, and `last_label`, and `finished` with `finished_at`. Events are `start`, `progress`, and `finish`. The HTTP body still uses `running`, `done`, `total`, `updated`, `last_label`, and `finished_at`.

The old dict allowed `running` true together with a finish time, a second thread, and a startup log of total 0, because the worker set `running` after the thread had already started. `start` now happens under a lock before the thread. A second start returns the same state. Progress must be the next count and cannot pass `total`. A blank label does not increase `updated`. Finish is ignored unless the phase is `running`.

The messages stay `Started.`, `Already running.`, and `Nothing to classify.` The worker classifies the list captured at start.

UX gain is that the owner no longer gets two classifiers writing the same cache. DX and AX gain is high for the one background worker in the admin server.

## Still implicit

### Earth Replay chrome

`app/src/surfaces/replay/components/earth-replay-stage.tsx`.

The session reducer already owns playback and provider status. Beside it, the stage keeps a HUD mode of `preview`, `compact`, or `expanded`, a mobile-controls boolean, and a chrome-visible boolean. Effects reset the HUD when the route or the mobile flag changes, force `compact` when playback starts, and hide chrome after 3.2 seconds of playback unless focus is inside the stage.

An expanded HUD from the previous route can paint once on the next route. `useIsMobile` is false until its own effect, so a phone can paint the desktop preview first. Expanded during playback is legal after the person opens it, so playback must not imply `compact` forever.

UX, DX, and AX gain is medium. Rank 1 among the work that remains. Leave the hide timer in the stage.

### Google Replay stage chrome

`app/src/surfaces/replay/components/google-route-navigator-stage.tsx`.

`reduceGoogleRenderer` already owns API load, scene load, ready, and unavailable. The stage copies that status into React state and keeps settings and chapter expansion as separate booleans. The mount effect resets both booleans. Until that effect, the previous route can show open settings or expanded chapters.

`google-renderer-state.ts` also allows an unavailable notice while the phase is still `loadingApi` or `loadingScene`. The test named "keeps pending work recoverable after authentication failure" requires `sceneReady` to replace that notice. Do not close that combination without a product decision. Auth failure is a recoverable notice, not a terminal phase.

UX and DX gain for the two booleans is low. Rank 2.

### Atlas search

`app/src/surfaces/atlas/components/atlas-search.tsx`.

`searchState` already derives `initial`, `typing`, `loading`, `grouped-results`, `no-results`, `selected-result`, or `unsupported-query` from the query. `searchOpen` is a separate boolean. The panel can be open for an empty query after a region was selected, because the flag is not the derived state.

This is an Atlas screen. Do not convert it while PR 172 is redesigning the Atlas layout. Rank 3. The derived function is already the part worth keeping.

### Route thumbnail

`app/src/surfaces/atlas/components/route-satellite-thumbnail.tsx`.

States are `deferred`, `loading`, `loaded`, `failed`, and `unavailable`. `nextThumbnailState` keeps `loaded` or `failed` when a later URL is different. The image can stay fully opaque while the browser fetches the new URL.

Atlas screen. Rank 4. Same hold as Atlas search.

### Build publication

`build.py`.

The script runs in order. The printed stages are the map provider, the curation filter, the photo scan, the route build, and publication. Publication then writes a backup, marks it `ready`, replaces route details, and deletes the backup. On failure, or at the next process start, `recover_interrupted_route_publication` discards a backup with no `ready` marker and restores a backup that has one.

`test_react_app.py` executes that function from the parsed file with a closed set of names. Moving the body into a helper fails that test until the test is updated. `owner_publication.py` is a separate journal and is already an explicit recovery procedure.

UX gain is none. The product reads the published files. DX and AX gain is medium because the stage order is a 4,000-line script. Rank 5. Extract the disposition first, and update the characterization test in the same change. Do not rewrite the HTML template into a state machine.

### Finder result presentation

`app/src/surfaces/finder/finder-page.tsx`.

Submitted intent lives in the URL. The draft intent is allowed to differ until the next search. That split is required by ADR-0016. `filtersOpen` and `view` (`list` or `map`) are local. `view` can stay `map` after the result is no longer a match list. The screen hides the map in that case.

UX, DX, and AX gain is low. Rank 6. Do not merge the draft into the URL state.

### Chunk recovery

`app/src/app/chunk-recovery.ts`.

A chunk load either reloads the shell once or leaves the manual retry in place. The session key records that this shell already reloaded. Offline and blocked storage skip the reload.

The two outcomes are already functions. UX, DX, and AX gain is low. Rank 7.

## Already explicit

These reducers already reject a late or wrong-phase event by returning the current state. Do not wrap them again.

| Module | Phases |
| --- | --- |
| `app/src/surfaces/finder/discovery-state.ts` | idle, resolving place, choosing place, no places, loading routes, results, failed |
| `app/src/data/search/collection-search-state.ts` | idle, loading index, basic fallback, keyword ready, embedding, semantic ready, keyword fallback |
| `app/src/data/search/external-ranking-state.ts` | idle, embedding, semantic ready, keyword fallback |
| `app/src/surfaces/routes/components/route-leaf-map-state.ts` | inactive, waiting, ready |
| `app/src/ui/planning-map-state.ts` | loading, ready, unavailable |
| `app/src/surfaces/courses/course-workspace-state.ts` | view empty, preview, or saved, and progress idle, pending, or failed |
| `app/src/surfaces/courses/course-form.tsx` | place search idle, searching, choices, chosen, error |
| `app/src/surfaces/replay/playback/course-preview-state.ts` | loading, ready, failed |
| `app/src/surfaces/replay/playback/replay-session-state.ts` | playback, camera, following, and grounding commands |
| `app/src/surfaces/replay/playback/replay-chapter-controls-state.ts` | following or preview, lens or whole route |
| `app/src/surfaces/replay/playback/earth-replay-session-state.ts` | provider status plus playback for one mounted engine |
| `app/src/surfaces/replay/renderers/google-renderer-state.ts` | idle, loading API, loading scene, ready, unavailable, destroyed |
| `app/src/surfaces/replay/renderers/maplibre-replay-state.ts` | idle, loading, ready, unavailable, disposed |
| `app/src/surfaces/replay/renderers/cesium-fidelity-state.ts` | idle, loading, ready, partial, disposed |
| `app/src/surfaces/replay/renderers/surface-sampling-state.ts` | idle, sampling, disposed |
| `app/src/surfaces/replay/playback/marker-photo-state.ts` | idle, loading, cropping, and the saved photo |
| `app/src/surfaces/replay/cinematic/cinematic-director-state.ts` | playback, audio start, and renderer status for one cut |
| `app/src/surfaces/replay/cinematic/trailer-state.ts` | playback and provider status for one trailer session |
| `app/src/labs/playable-earth/playable-earth-session-state.ts` | provider status, grounding, control, and HUD for the lab |
| `app/src/labs/route-intelligence/route-intelligence-state.ts` | loading, complete, partial, empty, failed |
| `app/src/surfaces/admin/workspace-state.ts` | loading or ready workspace, with per-route save idle, saving, saved, or failed |
| `admin-ui/mutation-state.ts` | save idle, saving, or refreshing, plus refresh and rebuild ids |
| `admin-ui/classifier-state.ts` | start idle or starting, poll idle, checking, running, failed, or complete |
| `app/src/surfaces/atlas/atlas-presentation-state.ts` | engine status and whether the selected region is waiting or ready |
| `app/src/surfaces/atlas/regional-transition-state.ts` | global, loading, ready, fallback, disposed |
| `app/src/surfaces/atlas/regional-fallback-state.ts` | loading, ready, unavailable |

`app/src/labs/route-film/route-film.ts` is a closed union. A queued film cannot carry a poster, and a ready film must carry one. It is validated at parse time. There is no runtime transition to convert.

`owner_publication.py` restores or discards a journal from the `ready` and `committed` markers. Readers should treat that module as the publication lifecycle.

Cesium Atlas status is delivered into `reduceAtlasPresentation`. The globe is not a second status enum.

## Ranked follow-ups

1. Earth Replay chrome, in `earth-replay-stage.tsx`.
2. Google Replay settings and chapter expansion, in `google-route-navigator-stage.tsx`. Leave the recoverable auth notice in `google-renderer-state.ts` alone.
3. Atlas search open flag. Atlas screen. Wait for PR 172.
4. Route thumbnail load. Atlas screen. Same wait.
5. Build publication disposition in `build.py`, with an update to the exec test in `test_react_app.py`.
6. Finder `view` and `filtersOpen`. Leave the URL-owned intent alone.
7. Chunk recovery. Only if a third outcome appears.

The mobile Atlas sheet on `cursor/atlas-mobile-prototypes-53cb` is not in this list as work for this change. It belongs to that draft.

## What does not earn a reducer

These are one choice each. ADR-0016 leaves them local.

- Atlas activity mode is the `activity` query on `atlas-page.tsx`.
- The route guide sheet is `peek`, `half`, or `expanded` in `route-detail-page.tsx`.
- Replay chapter relief or profile, and the two disclosure booleans, live in `replay-chapter-controls.tsx`.
- The replay route picker is open or closed, plus a query string.
- Course create mode is `generate` or `import`. The place search beside it is already the reducer in `course-form.tsx`.
- The course page token and connection counter only retrigger `reduceCourseWorkspace`.
- Hash routes are the URL. ADR-0016 forbids a second store that copies them.

Domain enums are already closed. Geometry status is `ready`, `missing`, or `invalid`. Curation review status is `draft`, `reviewed`, or `published`. Replay provider status is `loading`, `ready`, `partial`, or `unavailable`. They are records, not UI transitions.
