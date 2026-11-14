# Overland and the jump: Phase A plan

Status: approved with the decisions below. Branch `feat/overland` from `reconcile/trunk` at `efa137f7`. Slice 1a (the pure model modules and the jump reducer) is implemented.

The owner's words: "you're in this Game Boy world when you're searching the globe, and then when you get to the quest, you jump in the quest and it becomes hyper 3D realistic."

This plan covers four things: how the app works where Overland touches it, what the spike proved, the slices to build, and the decisions the owner still needs to make.

## Decisions taken

These override the recommendations in section 4 where they differ.

- **D1.** Overland is a lab at `#/lab/overland`.
- **D2.** Use the scale-up only. The SVG filter is not used.
- **D3.** The default jump never shows Google's map or attribution altered. The chunky phase is our own pixel art of the route. The live map is then revealed at full resolution through a transition we draw on top of it: an ordered-dither or mosaic wipe of our pixel canvas, clearing in blocks. It is not a filter on Google's element. The attribution corners stay clear and untouched throughout. The live scale-up pixelation (k from 6) stays only behind `?jump=live`, for local comparison. It must not become the default until the attribution terms are checked. In `overland-jump-state.ts` this is `transition: "wipe"` (the default) and `"live"`, and `jumpPresentation` is the one place that says what is visible.
- **D4.** The sprite is the in-scene marker. The engine hides its default position dot when a custom marker is set.
- **D5.** The fallback is the pixel replay, with plain copy.
- **D6.** The 3D map mounts only on entering a route. The 30 s deadline stays.
- **D7.** Overland is a lazy chunk, capped at 150 KiB, with a bundle check.
- **D8, D9, D11, D12 and D14** follow the recommendations.
- **D10.** When a route has no note, the text box shows the route's facts (place, date, km) and no sentence about a missing note (`entryBoxText` in `model/text-box.ts`).
- **D13.** Measuring on iOS Safari and Android is a gate before Slice 2 is called done.
- **D15.** The owner approved, and the Playwright browser is installed.

### The 3D towns (decisions from the town work)

The approved diorama (`goDiesel-brand-prototypes/overland-diorama/`) is now the town renderer for every place, generated from data. Slice "towns" below records what was built.

- **D16. Routing.** A town opens at `#/lab/overland/town/<place-slug>` (`overlandTownPath`; the slug is `townSlug`, for example `kyoto-japan`). A route's 3D world entered from a signpost is `#/lab/overland/town/<place-slug>/<route-slug>/3d` (`overlandTownRealmPath`). `?sign=<route-slug>` focuses a signpost. The world map's Open now enters the chosen town; the Index key still lists its routes. Every earlier path is unchanged.
- **D17. Full-bleed.** The town covers the navigation spine, as the realm does. Its own World key returns to the world map with the town selected; Escape does the same.
- **D18. The generator.** `model/town-plan.ts` `planTown(input)` is pure and deterministic, seeded by the place name. The layout template is the approved Kyoto: a loop road, houses on fixed lots, a pond and garden, and a front edge with water or open ground beyond. Each biome is a row of plain data in `model/town-kits.ts`: its houses in order of character (the first takes the front lot, as the machiya does in Kyoto), canopy and accent trees per season, filler (forest, grove, fields or city blocks), ground palette, water, backdrop, flower bed and corner prop. A city is built in its region's style (east Asia, North America, northern or southern Europe). Variety within one biome comes from the season, the coast, the number of routes (3 to 6 houses) and the signposts, not from shuffling houses. The four Japanese houses keep the prototype's own painters; every other house is drawn by one parametric painter (wall, window, door, roof, storeys, extra).
- **D19. Season.** The middle of her dates in the place, read by hemisphere; below 23.5° latitude it is `tropical`. Snow falls only where the kit says (alpine, prairie, swamp) in winter.
- **D20. Signposts.** One board per route, labelled with the app's route number zero-padded, on the front edge. Routes are sorted by how far east they leave (`startBearing` of the trace), so a route that leaves west hangs on the left with its arrow pointing left. Up to four posts; above four routes boards stack two to a post (three above eight). Her titles are carried exactly into the board's accessible name.
- **D21. Residents.** `TownInput.residents` (`{ id, nickname, spot }`) resolves each to a free position for its spot hint (`plaza`, `pond`, `signposts`, `porch`, `path`, `water`, `edge`; unknown is `path`). Nothing is drawn yet; adding residents changes nothing else in the plan (unit tested).
- **D22. three.js.** `three` 0.186.1, pinned, in its own lazy chunk (`town-renderer-*.js`), with named imports only. `@types/three` was not installed (the approval covered `three` alone), so `town3d/three.d.ts` declares the module and the renderer types its own surface. To keep the diorama's tuned colours, `ColorManagement` is off and light intensities are multiplied by π (three's lights are physical now).
- **D23. Quality.** `model/town-quality.ts`: the first tier comes from `navigator.deviceMemory` and `hardwareConcurrency` (or `?quality=high|medium|low`). After the town settles, every 40 frames are judged: a median over 24 ms steps down one tier, never back up, but only when the frames stutter (the median is more than 1.4 times the fastest tenth) or are plainly slow (median over 40 ms). A steady rate the display caps, such as 30 Hz in headless Chrome or a phone in low-power mode, keeps its tier; the first rule dropped every headless run to low. High: pixel ratio up to 2, 2048 shadow map, every tree. Medium: ratio 1, 1024 shadows, 60 % of filler trees. Low: ratio 0.75, no shadows, 30 % of filler trees. Trees are ranked feature-first, then nearest-first, so thinning starts at the horizon. The loop stops while the tab is hidden, while the realm covers the town, and between inputs under reduced motion.
- **D24. Fallback.** The `overland-town` lifecycle (`overland-town-state.ts`, registered): `idle`, `loading`, `ready`, `fallback`. No WebGL, a chunk that will not load, a renderer error or a lost context falls back, finally for that load, to the town's pixel index in the handheld with the plain line "The 3D town isn't available right now." Its routes open their entries as before; a 3D world opened there uses the existing pixel wipe.
- **D25. The jump from a town.** Transition `town` in `overland-jump-state.ts`. The town is the cover: it covers the map whole through the dive and the hold, then fades in the wipe's eight steps (95 ms each). `townCover(state)` is the one place that says how; whenever the live map shows beneath the town, the bottom attribution band (36 px) is cut out of the town layer, so Google's logo and credits are never under anything of ours (D3 holds). Reduced motion: no dive and no steps, a cut in, and a 200 ms fade back out.
- **D26. Light follows the run (owner's decision).** Focusing or choosing a signpost eases the town to the light of that run's local start: `model/run-light.ts` reads `provenance.temporal.startTimeUtc` in the route's own `timeZone`, or as solar time from the longitude when the zone is missing or unknown, never the viewer's clock. Buckets: night before 05:00 and from 21:00, dawn to 07:00, morning to 10:30, midday to 15:00, golden to 18:00, dusk to 21:00. No signpost chosen, or no recorded start: golden hour, the approved look. The start time lives in the route detail, so focusing a signpost fetches it (the same cached fetch the jump needs). **The Google scene cannot be lit by time:** photorealistic 3D tiles carry baked daylight and `Map3DElement` exposes no lighting or time-of-day control, so the real world shows as captured. Nothing tints or covers it.
- **D27. The hold is travel (owner's decision).** After the dive, if the scene is not ready, the runner runs on along the front path out of town and her route's line (`trailOnGround`, from the summary trace) draws itself on the ground ahead of her in pixels, as a ground decal that the trees can stand in front of. The only control is Cancel (plus Escape); a status line is announced to screen readers. The reveal starts the moment the scene is ready, never before the dive ends and never on a fixed timer. Unavailable or the 30 s deadline gives the existing fallback, with the town still showing.
- **D28. The matched cut.** The dive ends behind the runner at the signpost (`diveTarget`), at the pitch of the 3D world's opening camera (90° minus the tilt the Google driver mounts with, read by `openingCamera` from the same functions; clamped to 12°–70°), and far enough back that the 1.7-unit runner is the height of her sprite in the 3D world. The realm now shows the diorama's runner (`engine/runner.ts`, the same frames as the town) at a whole-pixel scale of about a tenth of the screen (3× to 5×), so she is the same sprite across the cut. Rides keep the bike. The heading is not matched: the town is not laid out to the compass (see remaining work).
- **D29. The signpost box.** Hovering or focusing a signpost shows a pixel box with its number, her title and the facts; it sits at the top of the screen so it never covers the signposts. Activating a signpost jumps at once.

### Towns: what remains

- Measure on an iPhone in Safari and a mid-range Android (D13 still gates): the town's frame rate per tier, and WebKit's handling of the town fading over the live map.
- Match the cut's heading as well as its pitch: rotate each town's layout so the front path runs the way most of its routes leave.
- The weakest kits: city blocks (one facade for every city), California (reads close to the Mediterranean), and the swamp (needs bog and reeds). Mountain and volcano backdrops are only seen low, during the dive.
- Residents are placed but not drawn (another artist).
- A frame-rate e2e on real hardware; the software renderer in CI is too slow to judge tiers, so tests pin `?quality=low` or reduced motion.

### On a phone (decisions from the mobile pass)

The owner: most people will use Overland on a phone, so it must be a world-class mobile experience.

- **D36. Full-screen on a phone; the tab bar does not belong.** On a phone, or any screen under 520 px tall (a phone held sideways), the Overland lab is a full-screen game: it covers the app's bottom tab bar and side rail, as its 3D towns and worlds already did, and has its own Exit key (top right, to Atlas). A tab bar under a game screen takes thumb space and reads as two apps at once. Desktop keeps the handheld beside the navigation spine.
- **D37. The world fills the phone.** `model/world-screen.ts` `phoneWorldScreen` picks the largest whole-pixel scale that keeps at least 120 pixel columns and rows (3× on a portrait phone, 2× sideways), then as many columns and rows as the screen holds after the safe areas and an 84 px key bar. The map draws edge to edge at that size with the town's text box at its foot, and the keys (previous, next, Map, Index, Open) sit in the bar at the bottom in thumb reach. Checked at 375×812, 390×844, 375×667 and 812×375.
- **D38. Route chips on a phone.** In a town on a phone, the signpost buttons themselves become a strip of chips along the bottom, each with the route number and her title whole, scrolling sideways when the town has more routes than fit (Crete has eight). The buttons, their names, their order, arrow keys and Enter are unchanged, so keyboards and screen readers behave as before. The first tap on a chip chooses its route (its story box at the top, the town's light, its board enlarged and marked in the scene by a bobbing pointer, its photos above the pointer); a second tap enters. Which route was chosen is read when the chip is pressed, because a tap on Android focuses the button before its click. A tap on a board in the scene chooses its chip (`model/sign-pick.ts`). Larger boards or closer framing were rejected: neither scales to eight routes on a 375 px screen.
- **D39. The runner faces the way she runs.** `runnerFacing(travel, yaw)` picks her sprite from her real direction of travel against the camera: her back when she runs away, her face when she runs towards it, her side across. It replaced the prototype's rule, which only held on the town loop (where she runs backwards along the path's points) and showed her face on the run out of town.

- **D40. The town rests while it fades (from CI).** On the CI runner, which draws WebGL on the CPU (SwiftShader), three town-jump tests stuck in `holding` or `resolving`: the town re-rendered every frame while it only faded over the live map, and her trail repainted and re-uploaded a 512 × 512 canvas almost every frame, so the reveal's 95 ms timers starved. `townCover(state).draws` now says when the town draws; it rests while it fades in or out over the live map and in the realm, and draws again once it covers the map. The trail repaints at most every 150 ms. Reproduced locally with SwiftShader and 4× CPU throttling (a failure before, a pass after); 21 of 21 town and story tests pass at 6×. The three jump tests have a 90 s budget, because the whole journey is drawn by the CPU there; no assertion was weakened. The Atlas test that also fails ("Atlas fills the available mobile workspace with live pixels") fails the same way on `reconcile/trunk` (#174) and is not from this branch.

### Her story in Overland (decisions from the route-story work)

The owner: Strava routes are generic and do not carry the story or the vibe of a run. Her own titles, notes, photos and clips are woven in as commentary. Every word shown is hers or a plain fact (number, distance, date, place, the kind of moment); nothing is written for her. The existing annotation contract (`RouteAnnotation` in `domain/route/contract.ts`, parsed strictly by `detail-parse.ts`) is the only model.

- **D30. The signpost is the trailer.** The chosen signpost's pixel box (`model/sign-story.ts` `signStoryPages`) shows her route number, her title exactly (emoji included, wrapped, never cut) and the distance and date on the first page; her note, the route's description, follows on pages of four lines, broken only between words and keeping her line breaks. Tapping the box, or Enter or Space on its page control, turns the page. A route without a note is one clean page with no page control. Her note is also the signpost's accessible description.
- **D31. Photos at the signpost.** Up to three image annotations with media, in the order met along the route (`signPolaroids`), hang above the chosen signpost as pixel polaroids drawn from the photo in code (at most 20 pixels on the long side, nearest-neighbour). They appear for the chosen signpost only, because annotations live in the route detail, which choosing a signpost already fetches for its light (D26); fetching every route's detail to hang photos on every post was not worth the requests. Activating one opens the real photo in a dialog with her title and caption, clear of the attribution band; Close or Escape returns focus to the polaroid and leaves the town as it was.
- **D32. Moments along the route.** The `overland-moments` lifecycle (`overland-moments-state.ts`, registered): per annotation `idle`, `approaching`, `showing`, `mediaOpen`, `dismissed`. A moment within 120 m ahead slows playback to 0.6×; reached, it shows in the game's text box under the route's box at 0.35× for 6 s of playing time (3.5 s while another waits), then tucks away and playback carries on. Opening its photo holds playback (play state kept) until the photo is closed; nothing else pauses it. OK puts a moment away early. Moments reached together queue in order. Scrubbing forward skips the moments passed; scrubbing back re-arms those now ahead and puts away one on screen. A paused replay neither meets new moments nor runs a moment's clock. The slowing is a time scale handed to the Google driver through a new optional `timeScale` option on `useGoogleReplayDriver` (default 1, so production Replay is unchanged).
- **D33. Editorial is never shown as recorded fact.** A `hypothesis` annotation carries an "Editorial" tag in the pixel box and in the photo viewer, and ", editorial" in what a screen reader hears. Recorded, derived and measured annotations carry no tag, as on the route guide. The kind label and the distance are the only words we add.
- **D34. Access.** A moment is announced in a polite live region with its kind, distance, title and words; its photo and its OK are real buttons of at least 44 px; with reduced motion it appears without sliding in. Escape in the photo viewer closes the photo and never leaves the 3D world or the town. Nothing of ours sits over Google's attribution band (e2e checks the moment's box).
- **D35. Clips.** The contract has no video. The smallest extension: `RouteAnnotationMedia.kind?: "image" | "video"` (absent means image), where a video's `url` is a published MP4 and `thumbUrl` its poster, with an optional `durationS`; the strict parser accepts `video` only with a published path and a poster. In Overland a clip is a polaroid with a play mark; it plays only when opened, muted by default with its own controls and no autoplay, and opening it holds the replay like a photo. Not built: images ship now.
- **The data today.** Two routes carry annotations. Her Kyoto run 065 has two recorded photos; they hang on its signpost and are met at 7.6 and 8.6 km. A Rome route carries four editorial notes, but it is `discovered`, not completed, so Overland does not show it; e2e uses a fixture on a completed route for the editorial case.

### Her story: what remains

- Clips (D35): the contract extension, the parser, the publisher's checks, and the player.
- The "add a moment" authoring screen, importing Strava media, and the collecting stamps on the index. Out of scope for this pass.
- Only 9 of her routes have a note and 2 have annotations; the story grows as she adds them.

## 1. Where Overland touches the app

### Routing

- `app/src/app/router.tsx` builds one `createHashRouter`. Every view is `view(path, surface, LazyPage)`, which is `React.lazy` inside `Suspense`, with a `SurfacePlaceholder` for the surface's layout. Labs are mounted as `lab/<name>/...` with surface `"lab"`.
- `app/src/app/route-paths.ts` holds `APP_PATHS` and the path builders, such as `replayPath(slug, returnPath)` and `atlasReturnPath`.
- `app/src/app/app-shell.tsx` treats any `/lab/` path as immersive (`overflow-hidden`, no page padding). The `AtlasSpine` navigation always renders. The Google Replay stage covers it with `fixed inset-0 z-[var(--z-map-controls)]`.
- `app/src/structure.test.ts` enforces three rules. Production code never imports `@/labs/`. Domain stays pure. One surface never imports another surface. A lab may import surfaces. This decides where Overland can live (decision D1).

### How Replay mounts and drives `gmp-map-3d`

1. `surfaces/replay/replay-page.tsx` resolves the slug against the bundled summaries. It loads the detail with `useRouteDetail` (reducer `route-detail-load`; the fetch is `/data/routes/<slug>.json` through `data/route-repository.ts`, one cached promise per slug). It then picks a renderer with `reduceReplaySurface` (`replay-surface-state.ts`). The states are `kind:google` (the default), `kind:atlas` with `reason:requested|degraded`, and `kind:cesium`.
2. `kind:google` renders `GoogleRouteNavigatorStage` (`surfaces/replay/components/google-route-navigator-stage.tsx`, 915 lines) with `variant="replay"`.
   - The session is `reduceGoogleReplayStage` (`google-replay-stage-state.ts`): `sessionId`, `status`, `statusReason`, `control` (from `reduceReplaySession`), and two disclosures. The reducer lives in `sessionRef`. `dispatchStage` is its only writer, and React gets throttled snapshots (rule 6).
   - The engine is `createGoogleRouteNavigatorEngine()` (`renderers/google-route-navigator-engine.ts`). Tests and e2e replace it through `window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__` (see `e2e/helpers/google-replay.ts`).
   - `mount()` calls `loadGoogleMaps(VITE_GOOGLE_MAPS_API_KEY)` and `importLibrary("maps3d")`. It builds `Map3DElement` in SATELLITE mode with `defaultUIHidden`, then adds the filament `Polyline3DElement` layers. The `immersive` palette also adds a `MarkerElement` whose content comes from `attachRoutePositionMarker`: a dot, or the person's photo. The marker is moved by `setCinematicRoute(...)` to the focus ratio. Readiness is `gmp-steadychange` with `isSteady`, with a 30 s deadline.
   - The engine's lifecycle is `reduceGoogleRenderer` (`google-renderer-state.ts`): `idle → loadingApi → loadingScene → ready | unavailable`, then `destroyed`, keyed by `operationId`. An `authenticationRejected` outcome stays as `reason: "authentication"` until a later `sceneReady`.
   - The frame driver is a `requestAnimationFrame` loop that runs only while ready. It dispatches `frameElapsed`, computes `googleRouteCameraPose` plus `sustainedRouteCamera`, and smooths the result with `advanceRouteCameraMotion`. It calls `engine.setCamera`, moves the marker with `setCinematicRoute` every 40 ms or more, and publishes to React every 90 ms or more.
3. **Google key preflight.** `providers/google-maps-loader.ts` loads the script once (a module singleton). On every load it starts `preflightGoogleMapsKey` (`providers/google-key-preflight.ts`) once per key fingerprint. That asks the 3D Tiles root, is never awaited, and is cached in `sessionStorage`. The 3D path has no other rejection signal, so the preflight exists. Only an explicit `API_KEY_INVALID` counts. It dispatches `godiesel:google-maps-auth-failure`, and the engine turns that into `authenticationRejected`.
4. **Fallback.** When Google is unavailable, the stage offers "Use Atlas replay", which dispatches `googleDegraded`. That fallback is the MapLibre Atlas replay (`EarthReplayStage`, `initialEngineMode="atlas"`, lazy), not Cesium. Cesium is reached only with `?renderer=cesium`, through the same `EarthReplayStage` with `allowEarthMode`, and its engine is `CesiumReplayEngine` (reducer `cesium-fidelity`). Overland should not use either fallback (decision D5).

### Route data at runtime

- **Summaries.** `data/generated/routes.manifest.json` (527 KB) is parsed by `parseRouteSummary` in `data/routes.ts` and ships in a lazy `routes-*.js` chunk (491 KB). It holds 67 routes: 66 `completed` and 1 `discovered`, all `replayEligible` with geometry `ready`. That is 62 runs and 5 rides in 29 region labels. Each summary has `slug`, `activityName`, `description`, `region`, `date`, `distanceKm`, `elevationGainM` plus `elevationStatus`, `type`, `effortTier`, `centerLat/Lng`, `replay`, and a `trace` of about 96 `[lat, lng, elev, d]` points.
- **Details.** `QuestRoute` comes from `/data/routes/<slug>.json` with the full recorded `route` (359 to 1,627 points for the showcase routes), `annotations`, `curation` and `provenance`. Replay needs the detail. Browsing the pixel world never does.
- **Regions.** `data/route-regions.ts` `buildRouteRegions` groups by the free-text `region` label and gives bounds and a centre from `deriveGeographicBounds`.

### What the prototype needs, against what the data gives

The prototype reads `window.BRAND_DATA` (from `prototypes/brand/data.json`). I checked all 67 outings against the manifest: titles and notes match exactly.

| Prototype field | App source | Status |
| --- | --- | --- |
| `title` (her title, exactly) | `RouteSummary.activityName`. Not `name`, which is the region for many routes. | Provided; 0 mismatches. |
| `note` | `RouteSummary.description` | Provided; 0 mismatches. **Only 9 of 67 routes have a note.** |
| `place` (town) | `RouteSummary.region` | Provided (29 towns). |
| `date`, `km`, `kind`, `tier` | `date`, `distanceKm`, `type`, `effortTier` | Provided. |
| `climb_m` | `elevationGainM`, but read through `recordedClimbM` | Provided. The prototype reads it raw. The app must show `Climb not recorded` for `elevationStatus: "unavailable"`, never 0. |
| `line` (about 65 points in a 0–100 box) | `trace`, normalised (longitude scaled by cos(lat), y down) | Derivable; needs a pure function. |
| Route number ("No. 007") | Not stored. The prototype numbers by date ascending. | Derivable; needs a stable tie-break (activityId). |
| Town coordinates (`PLACE` table, hand-typed) | Region bounds centre (`buildRouteRegions`) | Derivable; replaces the table. |
| Town biome (`med`, `alpine`, `city`, …) and the coastal flag | Nothing | Not provided. Coastal is derivable from the world land mask. Biome needs a small authored file or a latitude-based default (D11). |
| World land mask and biomes (`LANDS`, `BIOMES`, 1100×288) | Nothing | Prototype data (about 12 KB). Port it as a module. |
| Real route geometry for the 3D jump | `QuestRoute.route` from the detail fetch | Provided. |
| Per-route creatures | n/a | Removed by decision. |

## 2. The jump: what the spike proved

The spike was throwaway. It was a standalone Vite page that mounted the real `createGoogleRouteNavigatorEngine` with the real key on the real Banff and Kyoto routes. It drove the camera with `googleRouteCameraPose`, and it measured compositor frames from Chrome traces through system Chrome and Playwright. It has been removed from the worktree, which is clean apart from this file. The code, the measuring scripts and the screenshots are kept outside the repository at `/Users/laurenzary/Desktop/goDiesel-brand-prototypes/overland-jump-spike/`.

### (a) A pixelated `gmp-map-3d` that sharpens over time works

The working technique is CSS transform plus inherited `image-rendering`. Size the map host to `ceil(W/k) × ceil(H/k)` CSS px, apply `transform: scale(k)` with `transform-origin: 0 0`, and set `image-rendering: pixelated` on the host. `image-rendering` is inherited, so it reaches the WebGL canvas inside the element's closed shadow root. The compositor then upscales with nearest-neighbour sampling. Google renders fewer pixels, so the chunky phase is cheaper than full resolution. The jump steps `k` through `[12, 8, 6, 4, 3, 2, 1]` over 1,000 ms, and each step resizes the host.

What did not work or was not usable:

- **A canvas snapshot.** The shadow root is closed (`shadowRoot === null`), so the WebGL canvas cannot be read.
- **An SVG pixelate filter** (`feFlood`/`feTile`/`feMorphology` on a full-size host). It works visually, but every new filter level costs a main-thread hitch the first time it is applied.

Measurements were taken in system Chrome on Apple silicon with a 120 Hz display. They were not taken on a phone or in Safari.

| Viewport | Method | Phase | Presented frames (DrawFrame) | Dropped | Main-thread fps / worst frame |
| --- | --- | --- | --- | --- | --- |
| 1440×900 @2x | transform | steady at k=12, 3 s | 361 | 3 | 120 / 33 ms |
| 1440×900 @2x | transform | jump 12→1, 1 s | 106 | 16 | 104 / 33 ms |
| 1440×900 @2x | transform | steady at k=1, 3 s (Google's own full-res cost) | 241 | 129 | 79 / 33 ms |
| 1440×900 @2x | SVG filter | steady at k=8, 3 s | 276 | 89 | 90 / **416 ms** |
| 1440×900 @2x | SVG filter | jump 12→1, 1 s | 78 | 44 | 75 / **309 ms** |
| 390×844 @3x | transform | jump 12→1, 1 s | 120 | 1 | 119 / 17 ms |
| 390×844 @3x | SVG filter | jump 12→1, 1 s | 148 | 2 | 120 / 10 ms |

A cold mount at k=12 on the 1280×800 pane reached `ready` 2.7 s after navigation (one sample). After the 1 s jump, the full-resolution frame was already sharp. Tiles had refined during the steps.

Two problems the spike found:

1. **Google's logo and attribution scale with the transform.** At k=12 the logo becomes a wordmark that covers about a third of the screen (`pane-transform-l12-logo-scaled-1280x800.jpg`, `spike-transform-steady-l12-390x844.png`). The engine's own position dot scales into a large glowing disc. The logo is inside the closed shadow root, so it can be neither moved nor restyled. See D3.
2. **A bottom text box covers Google's logo** at full resolution (`spike-transform-steady-l1-390x844.png`, `spike-marker-swap.png`). The realm's layout must keep the bottom attribution corners clear.

### (b) A sprite that follows replay progress works, inside the scene

I tested two ways to place the sprite.

- **A DOM overlay pinned to the viewport centre does not track the runner.** With the chase camera, the camera target is about 60 CSS px from the route position on a 390×844 viewport. `Map3DElement` exposes no screen projection, so a DOM sprite needs our own pinhole projection from the pose. It would also drift on terrain.
- **An in-scene `MarkerElement` with an `<img>` sprite works.** The engine already moves this marker by replay progress through `setCinematicRoute`. Replacing the marker's child with an `<img>` and swapping its `src` showed the new frame within 150 ms of the change (red to blue: 9,144 red px at the start, then 0 red and 9,144 blue px 150 ms after the swap). A 2-frame walk cycle at about 8 fps is therefore feasible. The sprite also pixelates with the map during the jump, which looks consistent. The sprite sits on the route (`spike-marker-swap.png`). The ADR-0008 caveat applies: a marker floats rather than standing grounded.
- **The pixel text box works as a DOM canvas overlay** at integer scale with `image-rendering: pixelated`. Its cost was not measurable in the frame numbers.

Screenshots and scripts are in `/Users/laurenzary/Desktop/goDiesel-brand-prototypes/overland-jump-spike/`:

- `spike-transform-steady-l12-1440x900.png` and `spike-transform-steady-l12-390x844.png`: the chunky state
- `spike-transform-steady-l1-1440x900.png` and `spike-transform-steady-l1-390x844.png`: the resolved state
- `spike-filter-steady-l8-*.png`: the SVG filter variant
- `spike-marker-swap.png`: the in-scene sprite test
- `pane-transform-l12-logo-scaled-1280x800.jpg`: the logo problem
- `spike.ts`, `spike-overland-jump.html`, `measure-jump.mjs` and `marker-anim.mjs`: the spike code and measuring scripts

## 3. The slices

All slices follow red-green-refactor: write the failing test first, run it, and see it fail for the right reason. Unit tests use Vitest, which runs in Node with no DOM, so all logic goes in pure modules. That covers models, projections, reducers, sprite data and text layout. Canvas and DOM wiring is proven by Playwright on port 8791, one run at a time, with the existing fake Google engine (`installGoogleReplay`). `npm run test:e2e:list` must list the new spec and stay green.

**Before any e2e run on this machine:** the Playwright browser for `@playwright/test` 1.61 (`chromium-1228`) is missing from `~/Library/Caches/ms-playwright`. It needs `npx playwright install chromium`, which is a download and needs the owner's approval. The spike used system Chrome instead (`channel: "chrome"`).

Each slice is one reviewable intent and one PR. Slices 0 to 2 together are the vertical slice: world map, then one route, then the jump, then 3D Replay with the sprite and text box, then back.

### Slice 0: let a second stage drive the Google Replay engine (Replay refactor, no visible change)

The intent is to add two seams to Replay so Overland can reuse the engine and the camera instead of copying 300 lines from the 915-line stage.

- **The engine.** Add `MountOptions.positionMarker?: (marker: HTMLElement) => () => void` in `google-route-navigator-engine.ts`. The default stays `attachRoutePositionMarker`. Add `setPositionMarkerVisible(visible)` only if Slice 2 needs it.
- **The driver hook.** Extract the engine mount, the camera smoothing and the frame driver from `GoogleRouteNavigatorStage` into `surfaces/replay/playback/use-google-replay-driver.ts`. It returns `{ session, dispatchStage, commitControl, containerRef, … }`. The stage then uses the hook.

Tests first:
- **Unit, in `google-route-navigator-engine.test.ts`:** an immersive mount with a custom `positionMarker` appends what that function creates to the marker and calls its disposer on `destroy()`. A mount without one still attaches the dot. Both are RED until the option exists.
- **Characterization:** the existing `e2e/google-replay-production.spec.ts` must pass unchanged before and after the extraction. Run it once on the base branch to record it green, then again after.

Registry: no new reducer. Add `use-google-replay-driver.ts` to the `google-replay-stage` adapters in `lifecycles.json`.

### Slice 1: Overland world map and route entry (browse only, a lab)

The intent is a pixel world at `#/lab/overland` that lists her places as towns and opens a route's entry screen. It has no jump yet. This slice ports from the prototype: the world map, towns, the selection text box, the bitmap font, emoji rasterising, the frame drawing and the entry screen with her title exactly and her note. Creatures, the postcard and the manual stay out.

Files:
- `app/src/labs/overland/model/overland-entries.ts` (pure): `buildOverlandEntries(routes)`
- `app/src/labs/overland/model/overland-towns.ts` (pure): towns from regions, lat/lng to world-map pixels
- `app/src/labs/overland/model/route-line.ts` (pure): normalises the trace
- `app/src/labs/overland/engine/`: the canvas renderer, ported from `overworld.html`
  - `font.ts`, `palette.ts`, `world-mask.ts` (LANDS and BIOMES), `draw-world.ts`, `draw-entry.ts`, `text-box.ts`
  - Pure layout functions (`wrapText`, `pageNote`) are kept apart from the drawing calls so they can be tested.
- `app/src/labs/overland/overland-lab-page.tsx`, with the screens composed in `components/`
- `route-paths.ts`: `overlandPath(query?)` and `overlandRoutePath(slug)`
- `router.tsx`: `view("lab/overland", "lab", …)` and `view("lab/overland/:routeSlug", "lab", …)`

The URL is the state (ADR-0016, and rule 4 in `state-machines.md`). The selected town is `?town=`, and the entry is a path segment. Browser Back therefore returns to the same town and view. There is no reducer for this.

Tests first (unit):
1. `overland-entries.test.ts`:
   - Only completed routes are included.
   - Entries are numbered by date ascending, with ties broken by activityId, so numbers are stable.
   - The title is `activityName` verbatim. Use the fixture `🍑🍑🍑🍑💦💦💦💦` and confirm no trim, no case change and no truncation in the model.
   - The note is `description` verbatim, or `null` when empty.
   - `climbM` is `null` when `elevationStatus` is `unavailable`, never 0.
2. `route-line.test.ts`:
   - The output fits in a 0–100 box with the aspect ratio kept.
   - Longitude is scaled by cos(mean lat).
   - y points down.
   - The first and last points are kept, and the output has at most N points.
3. `overland-towns.test.ts`:
   - There are 29 towns from the bundled manifest, with correct route counts.
   - The coordinates are the region bounds centre.
   - The projection puts Calgary and Tokyo in the expected land cells of the mask.
   - Towns are sorted by longitude, for Previous and Next.
4. `text-box.test.ts`: wrapping by graphemes (emoji are one unit), pages of three lines, and the plain `No note for this route.` when there is no note.
5. `route-paths.test.ts` and `router.test.tsx`: the paths encode slugs, and the new routes exist with surface `lab`.
6. `check-bundle-budget.mjs`: `requireSingleLazyChunk("Overland", /^overland-lab-page-.*\.js$/)`, and the initial shell must not contain the land-mask marker. This is RED before the page exists.

Tests first (e2e, `e2e/overland.spec.ts`):
- The world map renders and every town is a real `button` named after its region.
- Selecting Kyoto updates the visually hidden text-box mirror.
- Open leads to the entry, which shows "i love goooooooolddddddddd" and its note in the accessible mirror.
- Back returns to the world with Kyoto still selected.
- The whole flow works by keyboard alone (arrows, Enter, Escape).
- Visual baselines at 390, 768 and 1440 (darwin only).

Registry: no runtime lifecycle yet, because the selection is the URL.

### Slice 2: the jump into 3D and back

The intent: from an entry, "Enter route" dives into the photorealistic replay of that route. A pixel runner and a pixel text box stay on screen, and leaving returns to the same spot. This completes the vertical slice.

Behaviour:
- The pixel world zooms into the route's pixel map for about 400 ms. This is ours and fully chunky. The engine mounts at the same moment.
- The live map is revealed at full resolution under our pixel cover, which clears in `WIPE_STEPS` (8) ordered-dither blocks over about 600 ms. Any key or tap skips to the end (interruptible). `?jump=live` swaps in the k = 6, 4, 3, 2, 1 comparison.
- With reduced motion there is no dive and no steps, only a 200 ms opacity crossfade.
- If the scene is not ready when the dive ends, the screen holds on the pixel route map with the runner idling and the plain text "Loading the 3D view." Cancel returns to the entry.
- In the realm: the sprite is the in-scene marker. A static frame is enough in this slice. The text box shows `No. 007`, her title, km done / total, and her note where there is one. It is placed above the bottom attribution band. Play and Pause and Back are real buttons.
- Leaving reverses the jump (1 → 6, then the pixel map; instant with reduced motion) and pops history back to the entry.

Path: `#/lab/overland/<slug>/3d`. The entry pushes it with `state: { via: "jump" }`. A deep link opens it without the dive.

New lifecycle `overland-jump`:
- Module `app/src/labs/overland/overland-jump-state.ts`, transition `reduceOverlandJump`. It is driven from the realm component. Rule 6 applies: the frame driver keeps the step timer and dispatches only phase changes.
- States: `browsing`, `diving`, `holding`, `resolving`, `realm`, `surfacing`, `fallback`.
- Events:

  | Event | Fields |
  | --- | --- |
  | `jumpRequested` | `slug`, `reducedMotion` (mints `jumpId`) |
  | `diveFinished` | `jumpId` |
  | `sceneStatusReceived` | `jumpId`, `status`, `reason?` |
  | `resolveStepElapsed` | `jumpId` |
  | `skipRequested` | none |
  | `cancelRequested` | none |
  | `leaveRequested` | none |
  | `surfaceFinished` | `jumpId` |

- Derived: `jumpPixelLevel(state)` gives the host k for the current phase.
- Identity: `jumpId` minted by `jumpRequested`. Events from a superseded jump are ignored.

Tests first (unit, `overland-jump-state.test.ts`), each RED before the reducer exists:
1. `jumpRequested` from `browsing` gives `diving` with a new `jumpId`.
2. Ready while diving stays `diving`. `diveFinished` with ready gives `resolving` at k=6. `diveFinished` with loading gives `holding`. Ready while holding gives `resolving`.
3. `resolveStepElapsed` walks 6, 4, 3, 2, 1, then `realm`. `skipRequested` while resolving gives `realm` at k=1.
4. Reduced motion skips `diving` and `resolving`. The status ready gives `realm` directly. Leaving goes straight to `browsing`.
5. Unavailable in any phase before `realm` gives `fallback` with its reason, and `reason: "authentication"` is kept. Unavailable during `realm` also gives `fallback`.
6. `cancelRequested` while `holding` gives `browsing`, and later events for that `jumpId` are ignored.
7. A status with a stale `jumpId` is ignored.
8. `leaveRequested` from `realm` gives `surfacing`, then `surfaceFinished` gives `browsing`, keeping `slug` for focus return.
9. `jumpPixelLevel` returns 1 in `realm`, the step value in `resolving`, and no live map in `diving` and `holding`.

Register the entry in `docs/architecture/lifecycles.json` and run `node scripts/check-lifecycles.mjs --write`. Add the realm component to the `google-replay-stage` adapters.

Tests first (e2e, with the fake engine set to `ready`):
- Entry, then Enter route: the map host shows `data-jump-phase` going `diving → resolving → realm`, and `data-pixel-level` ends at `1`.
- The marker element carries the sprite (`data-marker-kind="overland-sprite"`).
- The text box mirror contains the route number and `km`.
- The text box's bounding box does not overlap the bottom 32 px corner bands where the fixture's provider credit sits.
- Escape returns to the entry, then Back returns to the world with the same town selected.
- `emulateMedia({ reducedMotion: "reduce" })`: no `resolving` phase is ever recorded.
- Keyboard: Space plays, as on production Replay.

Live gate (camera and provider change, per AGENTS.md): add `e2e/overland-jump-live.spec.ts` under `GODIESEL_LIVE_GOOGLE_3D_E2E=1`. It records presented and dropped frames over the jump with the trace counter from the spike, and screenshots k=6 and k=1. A skipped live spec is `blocked`, not passed.

### Slice 3: when the 3D world cannot open

The intent: if Google is unavailable, the key is rejected, the network is slow or the browser is offline, the person stays in the pixel world and can still relive the route.

- `fallback` shows the prototype's pixel replay of her line: drag the runner, Play and Pause, scrubber. The notice is plain:
  - Generic unavailable: "The 3D view isn't available right now."
  - Key rejection (`reason: "authentication"`): "Google 3D is unavailable."
- No MapLibre or Cesium is loaded. Assert in e2e that no `maplibre-gl`, `earth-replay-stage` or `cesium` chunk is requested.
- Offline at jump time (`navigator.onLine === false`) goes straight to the fallback without mounting the engine.

Tests first:
- Unit: `pixel-replay-model.test.ts`, which covers `pointAt` and `nearestS` from the prototype (distance to point, drag snapping).
- Unit: `overland-jump-state` with `offlineAtRequest` gives `fallback` with no engine mount.
- e2e: `installGoogleReplay(page, "unavailable")` gives the fallback notice and a working pixel replay.
- e2e: the auth-failure event gives the key-rejection copy.
- e2e: no legacy renderer chunk is requested (the same technique as `google-replay-production.spec.ts:278`).

### Slice 4: world zoom levels (world, region, town)

The intent: clustered places such as Japan, the Italian towns and the BC coast stop overlapping.

- `model/cluster-towns.ts` (pure): `clusterTowns(towns, level, minSeparationPx)`.
  - At world level, towns closer than the separation merge into one marker labelled with the place count. The label uses the region text of the most-visited town plus "and N more", in plain interface copy.
  - Region level is the map at 4× around a cluster. Coastlines are smoothed with the prototype's Scale2x pass, applied twice.
  - Town level lists the town's routes.
- The level and the focus are URL state (`?zoom=world|region|town&town=`), so Back steps out one level.
- Input: pinch, the wheel and the + and − keys snap between the three levels. Arrows step through the towns at the current level.
- The camera animation lives in the engine's ref. It is not a reducer.

Tests first:
- At each level no two markers are closer than the separation.
- Every town is reachable in two zoom steps or fewer.
- The output is deterministic.
- The Japan towns form one cluster at world level and separate towns at region level.
- e2e: zoom into Japan, select Kyoto, then Back twice returns to the world.

### Slice 5: sprites

The intent: a better bike, a runner with four directions, and a walk cycle in the realm.

- Sprite sheets are hand-authored string grids in `engine/sprites/runner.ts` and `engine/sprites/bike.ts`. All art is original, with no reference to or naming after any game franchise.
- The runner has down, up, left and right with 2 to 4 frames each. The bike has a side view and a back view with crank frames. Rides use the bike.
- In the realm, the chase camera looks along the route, so the sprite uses the back (up) view. The marker `<img>` src changes at 8 fps while playing and holds one frame while paused or with reduced motion.

Tests first:
- Unit: every frame is 16×16, uses only palette keys, frame counts match the animation table, and `spriteFor(kind, facing, t)` is deterministic.
- e2e visual: a sprite-sheet baseline on the lab page at 4×.

### Slice 6: the seam for the town friends, and its docs

- `app/src/data/overland/places.json`, keyed by region label. It holds `biome` now. An optional `friends` array is reserved in the parser but not rendered. It has a strict parser, as the replay stories do.
- Drawing is a fixed layer list: terrain, roads, towns, then (empty for now) friends, then the cursor. A later slice adds one layer and one data key.
- Tests first: the parser rejects unknown keys. A region with no entry gets a latitude-based biome default, so a new place from `build.py` never fails the build. The `friends` key round-trips but has no effect.
- Docs: a short section in `docs/architecture/` on the Overland lab, and a decision on whether it gets an ADR beside ADR-0008.

The order is 0, 1 and 2 (the vertical slice), then 3 (before anyone outside the owner sees it), then 4, 5 and 6 in any order.

## 4. Risks and open decisions

Each item has a recommendation.

**D1. Where Overland lives.** A new top-level surface would need a sixth row in CONTEXT.md section 6. It would also need the Google engine, the camera and the session moved out of `surfaces/replay`, because surfaces may not import each other. **Recommendation:** build it as a lab at `#/lab/overland` (`app/src/labs/overland/`), as ADR-0008 did for Playable Earth. Labs may import Replay modules, nothing in production changes, and the hash route is its own. Promotion to a surface is a later slice with its own ADR and the shared-engine extraction.

**D2. Pixelation technique.** The transform scale was measured smooth: no main-thread frame over 33 ms in any run, and only 1 dropped frame of 120 at phone size. The SVG filter costs 300–420 ms hitches each time a new level applies. **Recommendation:** use the transform scale. Do not ship the filter.

**D3. Google attribution during the jump.** With the transform, Google's logo and credits scale with the map: a huge wordmark at k=12, and still large at k=6. They cannot be moved, because they are inside the closed shadow root. Covering them is not acceptable. **Recommendation:** make the chunkiest phase our own pixel art (the dive into the route's pixel map). Reveal the live map at k≤6 for about 600 ms only, never hold a pixelated live map, and keep the attribution corners clear at every step. The owner should confirm this against Google Maps Platform attribution terms before Slice 2 ships. If it is not acceptable, the compliant variant is a dissolve only: the pixel route map dissolves (the prototype's Bayer dissolve) onto the live map at k=1. It is less magical and has no attribution risk.

**D4. The sprite in 3D.** **Recommendation:** use the in-scene marker. It is measured working, it follows progress, and it pixelates with the map. A DOM overlay needs our own projection and drifted about 60 px in chase mode. The risk is that the marker floats, as ADR-0008 says. A pixel sprite reads as an overlay, which suits the art direction. The 8 fps frame swap needs confirming on a phone in the live gate.

**D5. Google 3D unavailable, key rejected, or offline.** **Recommendation:** fall back inside the pixel world to the pixel replay of her line (Slice 3), with plain copy. Do not load MapLibre or Cesium from Overland. The key preflight already reports a rejection with no extra code, because Overland goes through `loadGoogleMaps`.

**D6. Slow networks and billing.** Every jump is a Map Tiles 3D session, which is billable. A small host loads coarser tiles first: `ready` came 2.7 s after a cold navigation at k=12, in one sample. **Recommendation:** mount the engine at the jump request, not while browsing. Let the dive overlap the load, hold with a visible state, and keep the engine's 30 s deadline, which leads to the fallback. Do not prewarm on hover or on town selection.

**D7. Bundle size.** The initial shell is 301.1 KiB of the 500 KiB budget today (measured with `npm run build` and `npm run test:bundle` on this branch). **Recommendation:** lazy-load the whole Overland page, so the pixel engine, the land mask and the font never enter the shell. My estimate for the chunk is 60–90 KB minified. The prototype fragment is 117 KB unminified, including CSS and a 12 KB mask. It reuses the existing lazy routes chunk and the Google stage pieces. Add a check that requires one lazy Overland chunk, plus a ceiling of 150 KiB on it.

**D8. Touch input and walking.** **Recommendation:** for this phase, use tap to select a town, drag to pan, pinch to snap between the three zoom levels, and the on-screen ◀ ▶ and Open keys from the prototype. Every target is at least 44 px and is a real `button`. Free walking of the sprite across the world is a separate decision after the friends exist. It needs collision, a d-pad or virtual stick, and pathing.

**D9. Accessibility of a canvas-drawn UI.** **Recommendation:** treat the canvas as presentation only, as the prototype already does.
- Towns are positioned `button`s over the canvas. The index is a real list.
- Each text box has a visually hidden mirror. `aria-live="polite"` is used only for changes the person caused.
- Her titles are real text for screen readers. The canvas rasterises their emoji.
- The keyboard map is: arrows step, Enter opens, Escape goes back, Space plays, and + and − zoom.
- Focus returns to the town or entry the person left from.
- Reduced motion means no typing animation, no dive, no steps and no walk cycle.
- Run an axe pass in e2e for each slice.

**D10. Copy and her words.** Interface copy is plain (for example "Loading the 3D view." and "No note for this route."). Her titles and notes are never edited, and a unit test pins this. **Only 9 of 67 routes have a note**, so most text boxes will show the plain no-note line. **Decision for the owner:** keep the plain line, or show nothing and let the route number, title and km carry the box.

**D11. Town biome data.** **Recommendation:** derive the coastal flag from the land mask and default the biome by latitude. Keep a small optional `places.json` for her overrides, which is also the friends seam. Do not make a missing entry fail a test, because `build.py` can add places.

**D12. Full-bleed or a framed handheld.** On a lab path, the AtlasSpine navigation is visible. **Recommendation:** make the realm full-bleed, covering the spine as the Google stage does. Make the pixel world full-bleed on phones, and a framed device (as in the prototype) next to the spine on desktop. Ask the owner.

**D13. Unmeasured platforms.** All the numbers above are from desktop Chrome on Apple silicon at 120 Hz. Nothing was measured in iOS Safari, Android or Firefox. Firefox needs `crisp-edges`, and WebKit's nearest-neighbour scaling of a transformed WebGL layer is unverified. **Recommendation:** before Slice 2 is called done, run the live jump spec on an iPhone in Safari and on a mid-range Android, and record the frame counts. If WebKit smooths the upscale, fall back to the dissolve-only variant from D3 on WebKit.

**D14. Returning to the same spot.** **Recommendation:** rely on the URL, which holds the town, zoom, view, entry and `/3d`, plus browser history. Do not persist the drag offset; re-centre on the selected town. If the owner wants the exact pan offset restored, use one `sessionStorage` record, as `route-library-return.ts` does (left implicit).

**D15. The e2e environment on this machine.** The Playwright browser binary is missing, as noted in section 3. Installing it is a download, so it needs the owner's approval before Slice 0's characterization run.

## Not in this plan

These are left out on purpose: the postcard and share screen, the title screen, the manual, free walking, the friend characters themselves, and any change to the production Replay, Atlas or Routes surfaces beyond Slice 0's refactor.
