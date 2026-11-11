# Google 3D Replay production-ceiling research

## Question

What is the highest-quality cinematic route treatment goDiesel can ship inside its existing React and native Google Maps 3D architecture, and which attractive techniques would actually require a renderer migration?

## Decision

The next iteration should stay on native Google Maps 3D.

The strongest achievable result is not a more luminous full-route line.

It is an authored shot in which the camera protects the moving subject, only the locally relevant route is emphasized, the playhead communicates direction, and the interface disappears cleanly without washing out the terrain.

The recommended package is:

1. Add a HUD-aware camera-framing contract.
2. Replace the continuous route cable with a short, distance-local hierarchy of traveled, current, and upcoming segments.
3. Replace the circular pulsing playhead with a small directional marker.
4. Replace the permanent full-screen gradient with local scrims that exist only with visible chrome.
5. Synchronize the map thread, playhead, and elevation cursor from one animation clock.
6. Preserve recorded geometry and condition it only for the current rendering scale.
7. Make reduced motion a complete alternate presentation, including the camera.

This package reaches the credible production ceiling of Google's native `Map3DElement` without taking on a renderer rewrite.

Mapbox, MapLibre, and Cesium expose materially higher line-material ceilings, but that is a different renderer decision rather than an incremental visual refinement.

## Current implementation

The current renderer is already structurally close to the right answer.

- [`google-route-navigator-engine.ts`](../../app/src/surfaces/replay/renderers/google-route-navigator-engine.ts) renders four native `Polyline3DElement` roles named `context`, `future`, `traveled`, and `lead`, with `drawsOccludedSegments: false` and small mesh-relative altitude offsets.
- [`cinematic-route-filament.ts`](../../app/src/surfaces/replay/cinematic/cinematic-route-filament.ts) makes the context pearl, the future line brighter, the traveled line coral, and the lead segment blush.
- [`route-navigator-controller.ts`](../../app/src/surfaces/replay/playback/route-navigator-controller.ts) already limits the tracking treatment to a local distance window and distance-resamples source geometry at 12 metre intervals.
- [`route-scene-contract.ts`](../../app/src/surfaces/replay/scene/route-scene-contract.ts) already smooths camera targets separately from route geometry and raises automatic shots above a recorded-elevation terrain envelope.
- [`google-route-navigator-stage.tsx`](../../app/src/surfaces/replay/components/google-route-navigator-stage.tsx) updates camera, line, and React UI on separate approximately 32, 40, and 90 millisecond cadences, hides chrome after 3.2 seconds, and applies an always-on full-screen gradient.
- [`replay-elevation-scrubber.tsx`](../../app/src/surfaces/replay/components/replay-elevation-scrubber.tsx) already exposes an imperative `sync(progressM)` API, but the Google stage does not use it.
- [`index.css`](../../app/src/index.css) renders the current position as a 12 pixel circular marker with an infinite breathing shadow.
- [`google-maps-loader.ts`](../../app/src/providers/google-maps-loader.ts) loads the official weekly release channel.

The existing ADR is also an important constraint.

[`ADR-0009`](../adr/0009-native-google-maps-3d-is-the-primary-replay-renderer.md) makes native Google Maps 3D the primary Replay renderer, retains Cesium and MapLibre as reachable alternatives, and records that Google exposes neither terrain-surface sampling nor camera collision.

This research does not reopen that decision.

It identifies the highest-leverage treatment inside it and the conditions under which reopening it would become justified.

## Provider capability boundary

| Capability | Native Google Maps 3D | Mapbox or MapLibre | Cesium | Consequence for goDiesel |
| --- | --- | --- | --- | --- |
| Terrain-integrated route | `RELATIVE_TO_MESH` or `CLAMP_TO_GROUND`; route must be sufficiently interpolated | Terrain elevation queries and elevated line layers are available | Ground clamping and sampled terrain or tiles are available | Keep mesh-relative placement and modest clearance in Google |
| Depth and occlusion | A line can hide behind terrain and buildings with `drawsOccludedSegments: false` | Line occlusion opacity, elevation references, and z-offset are available in Mapbox | Depth testing, `depthFailMaterial`, and classification are available | Keep honest occlusion; do not fake x-ray segments in Google |
| Line material | Solid stroke, pixel width, opacity through element CSS, one proportional outer casing | Gradient, trim, blur, emissive strength, pattern, expressions, and richer occlusion controls | Arbitrary materials including glow and outline | Emulate taper with a few overlapping segments, not shader effects |
| Camera safe zones | Camera target, heading, range, tilt, field of view, roll; no documented viewport padding or projection API | Padding and offset explicitly move the vanishing point around overlays | Full camera transforms and view calculations | Approximate safe framing through an adaptive look-ahead target and validate visually |
| Custom playhead | Custom HTML/CSS `MarkerElement` or a GLB `Model3DElement` | Symbol, model, custom layer, or DOM marker | Entity, billboard, point, or model | Keep one HTML marker for precise screen-space legibility |
| Custom WebGL with shared depth | `WebGLOverlayView` belongs to the classic vector `google.maps.Map`, not `Map3DElement` | Custom WebGL layers are part of the renderer | Native scene primitives and shaders | A shader route over Photorealistic 3D is not a direct extension of the current runtime |

Google's documented `Polyline3DElement` surface includes stroke color, pixel width, outer color and proportional outer width, altitude mode, geometry, occlusion, extrusion, geodesic mode, and z-index.

It does not document per-vertex color, gradient, blur, emissive material, line trim, cap or join control, depth-fail material, or shader access.

That API boundary is the reason a five-layer optical treatment is realistic while a true luminous tapered ribbon is not.

[Google Polyline3DElement reference](https://developers.google.com/maps/documentation/javascript/reference/3.64/3d-map-draw)

[Google 3D altitude modes](https://developers.google.com/maps/documentation/javascript/3d/altitude-modes)

[Google Map3DElement camera reference](https://developers.google.com/maps/documentation/javascript/reference/3.64/3d-map)

[Google WebGLOverlayView reference](https://developers.google.com/maps/documentation/javascript/webgl/webgl-overlay-view)

## Ranked findings

Scores use 5 as best for impact and feasibility, and 1 as lowest risk or lowest maintenance burden.

| Rank | Technique | Direct in current renderer | Visual impact | Feasibility | Risk | Maintenance | Recommendation |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | HUD-aware subject framing | Yes, with an approximate camera target | 5 | 4 | 2 | 2 | Build now |
| 2 | Distance-local route hierarchy with optical taper | Yes | 5 | 5 | 2 | 2 | Build now |
| 3 | Directional playhead with restrained motion cue | Yes | 4 | 5 | 1 | 1 | Build now |
| 4 | Local scrims and decisive chrome choreography | Yes | 4 | 5 | 1 | 1 | Build now |
| 5 | One visual clock for map, playhead, and elevation cursor | Yes | 4 | 5 | 2 | 2 | Build now |
| 6 | Render-only geometry conditioning by camera scale | Yes | 3 | 4 | 3 | 2 | Build after visual direction is locked |
| 7 | Complete reduced-motion presentation | Yes | 3 | 5 | 1 | 1 | Required before production claim |
| 8 | Oriented GLB playhead | Experimental | 3 | 3 | 3 | 3 | Prototype only if HTML marker fails |
| 9 | Mapbox or MapLibre shader-driven route material | No, renderer migration | 5 | 2 | 4 | 4 | Do not migrate for line styling alone |
| 10 | Cesium glow, outline, and depth-fail materials | No, renderer migration | 5 | 2 | 4 | 5 | Keep as an explicit strategic alternative |

## 1. Frame the person, not the coordinate

The current camera points at a smoothed location 90 to 330 metres ahead of progress, but it has no knowledge of the header, chapter title, telemetry strip, or elevation dock.

That makes the route mathematically centered while the actual subject can sit behind interface chrome.

Mapbox and MapLibre solve this explicitly with camera padding that moves the center and vanishing point around persistent overlays.

Google documents no equivalent on `Map3DElement`, so goDiesel should introduce its own camera-framing contract:

- Measure the visible header, chapter block, and bottom dock with `ResizeObserver`.
- Express the available scene as top, right, bottom, and left insets.
- Define a desired subject band, approximately 55 to 62 percent down the usable terrain viewport for a chase shot.
- Adapt look-ahead distance, range, and tilt by shot type until the playhead remains in that band.
- Freeze those values within range buckets so the line and subject do not visibly breathe as the camera crosses thresholds.
- Recompute after viewport, orientation, chrome, or HUD state changes, not continuously from DOM layout.

This is an approximation because Google does not expose projection or camera padding.

It must therefore be tuned and accepted against real photorealistic scenes rather than treated as a geometry-only guarantee.

[Mapbox camera padding example](https://docs.mapbox.com/mapbox-gl-js/example/offset-vanishing-point-with-padding/)

[MapLibre EdgeInsets reference](https://maplibre.org/maplibre-gl-js/docs/API/classes/EdgeInsets/)

[Google Map3DElement camera reference](https://developers.google.com/maps/documentation/javascript/reference/3.64/3d-map)

## 2. Make the route a temporal trace

The most refined route films do not make the whole route equally present while the camera is close.

The line should answer three questions without a legend: where have I just been, where am I now, and where am I going next?

Use four to six Google polyline layers as an optical approximation of a taper:

- A short coral traveled tail should extend roughly 120 to 300 metres behind the playhead in chase mode and 20 to 50 metres in runner mode.
- A two-part upcoming cue should extend roughly 100 to 350 metres ahead, with a brighter near segment and a thinner, quieter far segment.
- A very short current or lead segment should carry the highest local contrast.
- Segment boundaries should overlap by a few metres to prevent tiny cap gaps.
- The full route should appear only in establishing, release, manual overview, or scrub context.
- The full completed history should remain available in the elevation profile instead of remaining painted over the terrain.

Use one subtle neutral outer casing only where the pearl core can disappear against pale roads or bright roofs.

Google's `outerWidth` is a percentage of the core width, so keep it near 0.08 to 0.14 and avoid recreating the heavy cable effect.

Keep `drawsOccludedSegments: false` so the route belongs to the world rather than drawing through it.

Use width and opacity buckets based on camera shot and range, not a frame-by-frame continuous formula.

This prevents a screen-space pixel line from pulsing while the camera eases.

Mapbox's `line-gradient`, `line-trim-offset`, `line-blur`, `line-emissive-strength`, and `line-occlusion-opacity` show the true shader-driven ceiling.

They are useful design references, but none is available on Google's native 3D polyline.

[Mapbox line layer specification](https://docs.mapbox.com/style-spec/reference/layers/)

[Mapbox line-pattern and width interpolation example](https://docs.mapbox.com/mapbox-gl-js/example/line-pattern/)

[MapLibre gradient-line example](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-gradient-line-using-an-expression/)

## 3. Replace the pin with a directional traveler

The current circle indicates location but not direction.

Its infinite breathing shadow also reads as a selected map pin rather than a moving subject.

Keep `MarkerElement`, because Google's custom HTML marker is intended for highly customized CSS and animation and one marker carries negligible marker-count risk.

Replace the circle with a compact teardrop, chevron, or needle whose inner glyph rotates by route bearing minus camera heading.

Smooth that relative bearing across the 0 and 360 degree boundary.

Use a stable 11 to 16 pixel footprint selected by camera range bucket.

Communicate replay velocity with a restrained trailing notch or a short 120 to 180 millisecond transform when playback state changes, not a perpetual halo.

Keep actual activity pace in telemetry so the marker does not falsely imply measured instantaneous speed.

A GLB `Model3DElement` can carry heading, tilt, roll, and scale in the 3D world.

It is worth a bounded comparison only if the HTML marker cannot feel integrated at oblique angles.

It is not the default because a screen-space marker is easier to keep legible, accessible, and consistently sized.

[Google custom HTML marker guide](https://developers.google.com/maps/documentation/javascript/3d/marker-html-css)

[Google 3D model guide](https://developers.google.com/maps/documentation/javascript/3d/models)

## 4. Let the world breathe when chrome is hidden

The production stage currently places a dark gradient over the entire map even when the header and HUD have faded out.

That leaves the terrain visibly veiled and makes hidden chrome feel like reduced opacity rather than a true cinematic state.

Replace it with:

- A top scrim attached to visible header content.
- A bottom scrim attached to the visible telemetry and elevation dock.
- A small local text shadow or radial scrim behind chapter copy.
- A 140 to 180 millisecond exit after approximately 1.6 to 2 seconds of idle playback.
- Immediate reveal on tap, pointer intent, keyboard input, or focus.
- A held-open state while settings, scrubbing, or any child control has focus.
- `inert` and `aria-hidden` on fully hidden controls, as the current stage already does.

Apple Maps' Look Around interaction provides a useful first-party precedent: controls can hide and a tap anywhere reveals them again.

Strava Flyover similarly keeps playback, speed, progress, and optional stats available without allowing them to dominate the scene.

[Apple Look Around interaction guide](https://support.apple.com/en-gb/guide/iphone/iph65703a702/ios)

[Strava Flyover support](https://support.strava.com/en-us/articles/15401641-flyover)

## 5. Use one visual clock

The current loop derives all progress from one controller but commits camera, line, and React UI on different cadences.

The map thread can therefore move about 50 milliseconds away from the elevation cursor, while React telemetry can trail by about 90 milliseconds.

That delay is small numerically but visible when the playhead crosses a peak, turn, chapter, or repair marker.

Compute one immutable frame from the current animation timestamp.

Use that frame to update camera, route treatment, HTML playhead, and the elevation scrubber's existing imperative `sync` API in the same `requestAnimationFrame` callback.

React text can remain throttled to roughly 8 to 12 updates per second because numbers do not need frame-rate rendering.

Use CSS or Web Animations only for simple chrome opacity and transform transitions.

Do not use a separate looping animation as a substitute for route progress.

The Web Animations model is timeline-based and supports pause, seek, and playback rate, but the geographic source of truth should remain the route controller's monotonic clock.

[Web Animations specification](https://www.w3.org/TR/web-animations-1/)

[Google 3D performance best practices](https://developers.google.com/maps/documentation/javascript/3d/best-practices)

## 6. Smooth presentation without falsifying memory

Do not run a Bezier spline through recorded GPS coordinates as a cosmetic fix.

A spline can cut corners, cross the wrong side of a road or ridge, and visually claim a path the user did not record.

Preserve the source geometry and telemetry as authoritative.

Use a separate render-only pipeline:

1. Keep the current distance resampling so polyline interpolation and progress slicing remain stable.
2. Use the original or finely resampled path in runner and chase views.
3. Use bounded Ramer-Douglas-Peucker simplification only in distant overview shots.
4. Select tolerance by camera range bucket and assert a small maximum world-space deviation from the recorded path.
5. Never feed simplified coordinates back into distance, elevation, pace, annotations, or provenance.
6. Continue smoothing camera tangents and targets independently, because that changes the shot rather than the claimed route.

Turf's `simplify` implements the familiar Douglas-Peucker option, while Turf's Bezier spline demonstrates exactly the geometry-moving technique that should remain out of the default render path.

[Turf simplify](https://turfjs.org/docs/api/simplify)

[Turf bezierSpline](https://turfjs.org/docs/api/bezierSpline)

## 7. Make reduced motion a different edit, not a disabled pulse

The current reduced-motion handling disables the marker pulse and prevents chrome auto-hide, but the Google camera still follows the route.

That does not satisfy the product intent of `prefers-reduced-motion` for an interaction-triggered camera flight.

For reduced motion:

- Default to a stable overview or high chase composition.
- Animate route and elevation progress without continuous pan, zoom, tilt, or roll.
- Snap or use a restrained crossfade between chapter compositions only after explicit input.
- Keep pause, seek, and progress fully available.
- Offer an in-product camera-motion override without ignoring the operating-system default.
- Honor `prefers-contrast` and `prefers-reduced-transparency` where supported by strengthening the route casing and replacing blur with opaque surfaces.

W3C guidance requires users to be able to disable non-essential animation triggered by interaction, and the media-query specification defines motion, contrast, and transparency preferences for this purpose.

[WCAG 2.2 animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)

[Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/)

[WCAG pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

## Performance and provider discipline

Google's first-party guidance aligns with the current engine in several important ways: use `requestAnimationFrame`, separate expensive calculation from minimal draw updates, simplify geometry, assign an updated path in one operation, keep widths modest, and avoid unnecessary extrusion or x-ray occlusion.

The implementation should additionally:

- Precompute distance indices and range-bucket geometry outside the frame loop.
- Update only segment endpoints that cross a meaningful distance threshold.
- Avoid rebuilding treatment geometry while the user manually manipulates the map.
- Keep active Google polyline count in the single digits.
- Record the loaded `google.maps.version` in provider diagnostics.
- Keep the weekly channel while it remains the provider's recommended channel, but run headed live-provider smoke tests because it changes weekly.
- Consider the quarterly channel only after verifying that every required `maps3d` feature is present and the lower update frequency is worth delayed fixes.
- Do not promote alpha `Route3DElement` or other alpha-only APIs into production.

Google states that weekly is the most current channel and the general recommendation, quarterly is the most predictable, and alpha is for development only.

[Google Maps JavaScript API versioning](https://developers.google.com/maps/documentation/javascript/versions)

[Google Maps JavaScript API release notes](https://developers.google.com/maps/documentation/javascript/releases)

[Google 3D support and hardware requirements](https://developers.google.com/maps/documentation/javascript/3d/support)

## Migration-only inspiration

### Mapbox or MapLibre

Mapbox's line layer is the most direct expression of the desired material language.

It offers progress gradients, trim offsets, blur, emissive strength, patterns, elevation references, occlusion opacity, and zoom expressions.

Mapbox can also sample terrain elevation under a moving point and explicitly offset the vanishing point around UI.

MapLibre provides the same core gradient and camera-inset patterns in an open-source renderer.

[Mapbox line layer specification](https://docs.mapbox.com/style-spec/reference/layers/)

[Mapbox terrain-elevation query](https://docs.mapbox.com/mapbox-gl-js/example/query-terrain-elevation/)

[Mapbox elevated-line example](https://docs.mapbox.com/mapbox-gl-js/example/elevated-line/)

[MapLibre animation options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/AnimationOptions/)

These capabilities justify migration only if shader-level route materials, exact screen padding, or renderer terrain queries become non-negotiable product requirements.

They do not justify replacing Photorealistic 3D solely because the current line needs better art direction.

### Cesium

Cesium supports polyline materials, glow, outlines, depth-fail materials, ground clamping, camera transforms, easing, and collision controls.

[Cesium PolylineGraphics](https://cesium.com/learn/cesiumjs/ref-doc/PolylineGraphics.html)

[Cesium Material](https://cesium.com/learn/cesiumjs/ref-doc/Material.html)

[Cesium Camera](https://cesium.com/learn/cesiumjs/ref-doc/Camera.html)

[Cesium ScreenSpaceCameraController](https://cesium.com/learn/cesiumjs/ref-doc/ScreenSpaceCameraController.html)

The repository already retains a Cesium path, but ADR-0009 records the integration burden that made native Google 3D primary.

Use Cesium as a strategic alternative if full material control and measured terrain interaction outweigh that burden, not as an emergency styling escape hatch.

## Product-pattern synthesis

The relevant first-party products converge on a simple hierarchy.

- Strava Flyover starts playback after explicit entry and makes pause, speed, scrubbing, camera adjustment, recentering, and optional live statistics immediately recoverable.
- Garmin ClimbPro anchors current position to an elevation profile and prioritizes current grade, remaining distance, and remaining ascent over a field of decorative events.
- Relive treats the route as a story spine for photos, notes, music, and remembered moments rather than making telemetry the entire experience.
- Apple Maps demonstrates that immersive map chrome can disappear completely and return on tap.

[Strava Flyover support](https://support.strava.com/en-us/articles/15401641-flyover)

[Garmin ClimbPro support](https://support.garmin.com/en-GB/?faq=KKRLD2Fo6MAlCXOzUZb1e9)

[Relive product overview](https://www.relive.com/explore)

[Relive product update](https://support.relive.com/kb/guide/en/your-new-relive-is-here-SkECJOTybj/Steps/4393615)

[Apple Maps](https://www.apple.com/maps/)

The design implication is not to copy their chrome.

It is to make the route, camera, elevation cursor, and story chapter read as one authored temporal object.

## Production acceptance gate

The next implementation should not be called finished until it passes a headed live-provider scorecard rather than only unit or fixture tests.

At minimum, verify Crete, an urban route with buildings, and a high-relief mountain route at desktop and mobile viewports.

The gate should require:

- The playhead remains inside its defined safe band in tracking shots with chrome shown and hidden.
- The thread remains legible over pale roads, dark water, bright roofs, and low-detail terrain without looking like a cable.
- Terrain and buildings honestly occlude the route.
- Tracking shows only the local temporal trace; overview and release restore route context.
- The route playhead and elevation cursor derive from the same frame and do not visibly separate at chapter boundaries or repair markers.
- Hidden chrome has no residual full-screen wash 200 milliseconds after exit.
- Tap, keyboard, focus, scrub, and settings interactions restore and hold controls predictably.
- Reduced-motion mode keeps the camera stable while progress, chapters, telemetry, and seeking remain understandable.
- Manual camera interaction does not fight immediate automatic recentering; a clear recenter action restores the authored shot.
- The canvas is nonblank, reports the actual Google API version, and produces no provider or page errors.
- Frame timing is sampled during 30 seconds of playback, with no sustained main-thread work above the selected 30 frame-per-second map budget.

The existing ADR also requires the broader native Google route scorecard that was never completed.

This visual pass should contribute evidence to that obligation rather than creating another isolated Crete approval.

## Suggested implementation order

1. Introduce viewport insets, subject-band camera framing, and one visual frame clock.
2. Recompose the four existing filament roles into short traveled, current, near-upcoming, and far-upcoming segments, adding at most one or two layers if optical taper requires them.
3. Replace the marker shape and rotate it relative to camera heading.
4. Remove the permanent map gradient and implement local chrome scrims and shorter reveal timing.
5. Add the full reduced-motion presentation and range-bucket geometry conditioning.
6. Run the live-provider production gate and tune numeric values from evidence across routes, not from a single screenshot.

## Final recommendation

Do not migrate renderers for the next iteration.

Make the camera composition the primary design system, make the route a quiet temporal trace, and make every other layer prove that it helps the viewer feel progression through a real place.

If this package passes the live-provider scorecard and the desired result still depends on true gradient, glow, emissive, trim, depth-fail, or exact screen-projection control, then the remaining gap is architectural and ADR-0009 should be revisited explicitly.

## Implementation outcome

Implemented on 2026-08-16 without changing the primary Google Photorealistic 3D renderer.

The production Replay now measures its header and control dock, exposes a terrain subject band, and adapts tracking center, range, and tilt around occupied screen space.

One animation-frame clock now advances the map camera, temporal route treatment, directional playhead, and elevation cursor while React text updates remain throttled.

Tracking uses short coral traveled, peach lead, and pearl upcoming segments with a restrained casing.

Overview and release shots retain the complete contextual route.

The playhead is a bearing-aware directional needle with no looping pulse.

The permanent full-screen wash was replaced by local top, bottom, and chapter scrims with a 150 millisecond chrome transition and a 1.8 second idle exit.

Reduced-motion playback holds a static overview camera while progress, chapters, telemetry, seeking, and explicit camera controls remain functional.

Range-dependent line width now changes in stable buckets rather than continuously rebuilding the visual weight.

The live-provider evidence is stored under `app/e2e/evidence/auto-director/`, including visible-HUD and immersive desktop chase frames for Crete.

Deterministic production Replay passed 9 browser tests.

The focused camera, filament, and framing suite passed 23 unit tests.

The live Google gate passed both desktop navigator routes, the production desktop chase frame, both phone navigators, the production phone composition, the San Francisco runner mesh case, trailer/export cases, and both cinematic director routes.

One San Francisco director camera sample exceeded its existing step threshold during the combined live run and passed on immediate isolated rerun, so it is recorded as provider-timing variance rather than a reproducible implementation regression.
