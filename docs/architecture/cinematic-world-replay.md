# Cinematic world Replay

Cinematic world is an opt-in renderer inside Replay. It applies the supplied
Three.js / 3D Tiles / MVT / atmospheric-rendering direction without replacing
Native Google Replay, changing Atlas, or changing the route contract. ADR-0009
remains the default-renderer decision. This is an experimental option, not a
claim that the new renderer has passed a live route scorecard.

## Experience

Open a route in Replay, open **Replay settings**, then choose **Cinematic world**.
The equivalent route is `#/replay/<slug>?renderer=cinematic`. The current distance
and return destination survive switching worlds; playback pauses for the switch.
The existing chapters, elevation scrubber, free camera, recenter action, route
picker and playback controls remain the owners of the journey.

The additional controls are Daylight, Golden hour and Blue hour; simulated cloud
cover; Road names and landmarks; and Light, Balanced or Cinema quality. Light
turns volumetric clouds off. Balanced can lower rendering quality after sustained
slow frames. Reduced motion freezes decorative cloud motion and label fades.

The atmosphere is a presentation choice, not historical weather or recorded
sunlight. Photographic textures retain their baked lighting; the controls do not
reconstruct the original day or physically relight the photographs. Road names
come from vector data. Landmark point features are markers, not invented names.
No shader, map label, or terrain correction writes back into recorded data.

## Configuration

A browser key with **Google Map Tiles API** enabled is required. Set
`VITE_WORLD_GOOGLE_MAPS_API_KEY`, or use the existing `VITE_GOOGLE_MAPS_API_KEY`
only when it is also authorized for Map Tiles. Restrict the key to the intended
browser origins and required APIs. This is not a Vertex credential. No secret
server credential belongs in a Vite variable. Missing/rejected keys produce an
explicit unavailable state, with Native Replay and Atlas recovery actions.

Road annotations resolve OpenFreeMap's current TileJSON at
`https://tiles.openfreemap.org/planet`; dated tile URLs are not embedded. An
alternative HTTPS TileJSON URL, `{z}/{x}/{y}` template or `.pmtiles` URL can be
configured with `VITE_WORLD_VECTOR_SOURCE`. A custom source must also supply
`VITE_WORLD_VECTOR_ATTRIBUTION`. The service must allow browser CORS; PMTiles
requires byte-range requests. Custom source availability is not guaranteed.

The environment is renderer-local, not persisted as route metadata. Selection
of the renderer is in the canonical Replay URL. No new route data schema,
generated projection, server proxy, or offline imagery store is introduced.

## Runtime ownership

- `world-model.ts` contains deterministic settings, budgets, source-edge and
  readiness rules. `world-frame.ts` converts WGS84/ECEF to a local east/north/up
  frame, preserving small-scale floating-point precision.
- `cinematic-world-engine.ts` implements the existing Replay engine interface.
  It is dynamically imported only when Cinematic world is selected. It owns one
  WebGL2 renderer, one camera, one tile set, optional layers and their disposal.
- `world-route.ts` seats a presentation trace against available meshes without
  changing source geometry. Recorded elevation corrections are bounded to 120 m.
  Unknown elevations are not drawn at a fabricated zero before a mesh is found.
  Recorded discontinuities split edges and hide the moving point inside gaps.
- `world-labels.ts` supplies the MVT rendering driver: road glyphs, landmark
  circles, screen-space occupancy, depth testing and bounded settling work.
  Its diagnostic count measures actual visible road labels, not HTTP successes.
- `world-atmosphere.ts` uses Takram scattering and volumetric cloud passes with
  same-origin, package-pinned assets. Dithering uses deterministic sample noise;
  it is not described as a spatiotemporal blue-noise dataset.

Tiles use an instance-owned memory cache (384 MiB maximum / 256 MiB unloading
threshold), bounded screen-space error, capped pixel ratio, small-mesh BVHs and
on-demand visible-view streaming. There is no application-managed persistent
cache of Google's imagery. Route mesh queries are time-bounded and geometry
uploads are throttled. Hidden pages do not run the renderer update loop.

Native Replay does not download the new Three.js renderer chunk. The production
build copies the required atmosphere/cloud binary textures and Draco decoder
assets under `world-assets/`; these are requested only by the cinematic runtime.
Full-quality volumetric clouds remain GPU-intensive: Cinema is deliberate,
whereas Balanced permits a visible downgrade to Light.

## Failure and attribution

Terrain readiness requires meshes to have been drawn in consecutive frames;
a timer or successful root request cannot produce a ready world. Optional
atmosphere or label failures produce partial Replay, not a blocking overlay.
Playback remains available in partial state. A missing terrain world, renderer
failure or context loss is unavailable and offers explicit recovery. No
photographic or decorative substitute is presented as provider terrain.

Google Maps and the visible tiles' provider credits remain visible independently
of HUD fading. Vector attribution is shown alongside them. Custom attribution
is treated as text, not injected HTML. Light and clouds are identified as
simulated. Account terms and geographic coverage must still be checked before
publication; this implementation is not approval to export or redistribute
Google imagery.

## Verification and promotion

Run `npm run verify:ticket` from `app/`, then:

```sh
npx playwright test e2e/cinematic-world.spec.ts e2e/cinematic-world-renderer.spec.ts e2e/cinematic-world-report.spec.ts e2e/google-replay-production.spec.ts --project=chromium
```

The control tests explicitly use adapters. The renderer test uses the real
Three.js, tile loader, MVT driver, atmosphere and cloud shaders with synthetic
GLB/MVT responses. Its screenshots are marked synthetic in test names and
artifacts; they prove pipeline execution, not live imagery, licensing, real
geographic alignment or hardware performance.

Live acceptance is separate and fails fast when no preview is configured:

```sh
GODIESEL_WORLD_PREVIEW_URL=https://<authorized-preview> npm run test:e2e:cinematic-live
```

That gate uses no provider interception or renderer factory and requires actual
terrain draws, decoded/visible labels, real provider responses and advancing
Replay. Run it with a hardware-accelerated browser and a correctly scoped key.
A missing preview, credential, quota or graphics capability is **blocked**, not
skipped success. Before default promotion, assess an urban road, a rural route,
a high-relief route, a missing-elevation route and a long route on desktop and
mobile, including rapid seeks, layer failures and repeated enter/leave cycles.
A passing synthetic fixture is never a replacement for that live scorecard.

## Primary implementation references

- NASA-AMMOS, 3DTilesRendererJS 0.5.2: https://github.com/NASA-AMMOS/3DTilesRendererJS
- Takram, Three Geospatial (atmosphere/clouds): https://github.com/takram-design-engineering/three-geospatial
- Google Map Tiles API setup: https://developers.google.com/maps/documentation/tile/get-api-key
- OpenFreeMap: https://openfreemap.org/

## Playback reports (v2)

**Replay settings → Save playback report** saves a local JSON file; it does not
upload telemetry. Reporting observes Cinematic world and never changes its
quality, camera, route data or imagery. Native remains the default.

A report belongs to one Cinematic renderer mount. Switching routes or renderers
starts a new session. `build` identifies the checked-out commit, source state and
build time; an archive without Git is explicitly unknown unless a validated
Cloudflare commit is declared. A declared revision is distinguished from a Git
checkout. Never infer the tested commit from a moving preview alias.

`frames` retains intervals ending in the last 60 seconds, evicted by time rather
than refresh rate. It includes exact nearest-rank percentiles, thresholds above
50/100/250/1000 ms, and one-second summaries. `windowMs` is the observed
wall-clock span, while `intervalTotalMs` sums complete intervals, including a
possible interval crossing the window's start. Missing frames are not invented.
The emergency 65,536-sample cap supports a full minute above 1,000 Hz; any
capacity loss is explicit in `retention`, never silently called complete.

`session` keeps whole-mount frame/stall counts, the twelve worst stalls, render
submission count, first terrain draw time, and visible/hidden wall time even after
recent samples expire. These are animation-frame callback intervals, not
GPU-presented frames per second. Successful render submissions are counted
separately. Hidden-tab boundaries reset timing; very slow visible intervals are
not discarded. `byActivity` separates playing, paused, transition and unknown
samples; an interval spanning an interaction is attributed to transition.

`timeline` samples camera, playback, quality and terrain context at most once a
second for the last minute. `events` retains up to 256 timestamped interactions
(play/pause, seek, camera mode, free camera/recenter, zoom, speed, settings,
quality/environment, layer and visibility changes). Whole-session event totals
and dropped-event counts remain available if the event list fills. Times are
milliseconds from mount. Reports never serialize a controller or route object.

The current camera record distinguishes requested mode/range from the directed
mode and actual range, plus free/following ownership, field of view and clipping
planes. The center-ray terrain probe observes only visible terrain models. Its
missing states distinguish not sampled, no terrain, no hit, missing geometric
error and probe failure. Sample age and camera movement since sampling prevent
stale measurements being read as the current view. The projected-error estimate
uses the sampled geometric error, distance, projection matrix and the same CSS
pixel resolution configured by the pinned tile renderer. It is **not** the
library's bounding-volume selection error, GPS error, label alignment error or
imagery-sharpness score. A progress value of one is not visual acceptance.

The reporter exports no provider keys/URLs, route coordinates or tile bodies.
Its bounded buffers/listeners belong to the mount and are released on destroy.
The minute-long synthetic browser test exercises the real renderer, owning
controller, ordinary interactions and downloaded JSON without a mocked clock.
The separate live minute-report test uses actual provider terrain and validates
the deployed build identity. The existing live cloud/imagery scorecard remains a
separate obligation; report success cannot turn failed visual acceptance green.

## Terrain continuity and work ownership

Cinematic now distinguishes historical startup completion from the current view.
Five bounded center-area rays sample selected, visible terrain at most four times
per second. `terrain.view` reports entering, missing, recovering, refining or ready;
this is a sparse geometry check, not a full-frame coverage percentage, a texture
sharpness score or a label-alignment guarantee. A stale or missing probe cannot
certify the current camera.

When a following, playing view has no center terrain for 200 ms, the renderer's
optional `isPlaybackBuffering()` signal asks the owning transport to advance by
zero seconds. Stable coverage for 250 ms releases the hold. The transport retains
Play/Pause intent, distance, source telemetry and camera choice; it never catches
up skipped wall-clock time. Seeking, pausing, changing views, leaving Replay and
free-camera ownership remain available. Native implements no hold signal and is
unchanged. The status says the current moment is being held. Provider coverage
that never arrives is not treated as a recovered view.

Terrain requests and decoding share a 24-item allowance. This includes response
bodies after HTTP response headers arrive, not just concurrent fetches. Origin
queues keep their own limits and original priority ordering; a yielding task wake
lets decoding and HTTP work proceed independently of expensive animation frames.
Under pressure, obsolete **queued** parses are removed through the dependency's
cache lifecycle. Running decoders and current visible/used terrain are not cut
out. The cache still has a 384 MiB ceiling; retaining up to 320 MiB after eviction
reduces repeated unloading on revisits without permitting an unbounded cache.

One optional, non-masking load sphere prepares a maximum of 320 m of recorded
travel ahead. Actual camera requests retain priority. Prediction stops under
pending-work/memory pressure, in free camera, for wide overview, with unavailable
recorded elevation, or at a recording gap. A seek debounces intermediate traversal
and points the hint at the destination. It does not predict a fictitious straight
line between disconnected recording segments or persist provider tiles. This is
bounded prefetch, not a guarantee that arbitrary cold seeks have instant imagery.

The current two route points receive priority sampling, with a bounded periodic
refresh and round-robin work for the remainder. No sampling runs on a settled,
unchanged route. A contrast edge on the traveled filament and an 18 CSS-pixel
camera-facing coral/white rider improve close-view reading. Recording gaps remain
gaps; surface offsets are display-only. Missing mesh clearance is explicitly
`unknown`; a previously measured height is not reused across unrelated seeks.

### Optional effects must be optional work

In pinned `@takram/three-clouds` 0.7.6, `skipRendering` controls composition but its
`update` still submits shadow and volume passes. The instance-local subclass gates
that work explicitly. Zero cover or Light quality means zero cloud-pass updates,
and changing to Cinema with zero cover does not apply a heavy cloud shader preset.
Enabling clouds resumes the original effect. Disabling clears its aerial overlay
and shadow references. These are real cloud passes when enabled, not a still image.

The report retains its v2 local/whitelisted format and adds cloud-pass counts,
current-view/buffering state, clearance confidence, backpressure and look-ahead
state. Rapid seek updates within 250 ms are coalesced into a burst with first/last
and min/max distances; raw counts remain in session totals. These are seek bursts,
not a claim that every burst equals one physical pointer gesture.

### Verification boundaries

The focused gate exercises actual GLB/Draco geometry, missing-view recovery,
cloud work off/on/off, renderer cleanup, and transport hold/resume with Native
isolation. The live gate additionally checks the owner's Crete Runner checkpoints
around 9.85 km and 12.62 km with real provider data and ordinary UI input. Sparse
ray hits and queue limits are correctness checks; frame screenshots and real-device
measurements still separately determine geographic fidelity, route readability,
input latency and final cinematic quality. A positive startup flag is never a
substitute for that visual review.

### Current-view continuity repair

The local-coordinate renderer owns a small adapter for the pinned 3D Tiles fade
lifecycle. A tile can stop being active while its fading geometry remains a child
of the rendering group. Its Earth-to-local parent must survive until the fade
actually removes that child. The dependency regression exercises this exact
transition and also verifies final detachment. Camera clearance uses the library's
supported actual-active-geometry raycast path, because a provider bounding volume
can miss an existing photogrammetry surface.

Current-view coverage uses fifteen geographically downward screen rays, bounded
by the camera clipping planes; intentional above-horizon rays do not count as
missing ground. This is a sparse surface check, not an imagery or label-alignment
score. The live Runner checkpoints additionally reject distributed blank regions
in their ground area and require three successive usable samples within the
existing recovery deadline. Sharp terrain in one corner no longer certifies a gray
band elsewhere. The pixel check is specific to these close Runner shots, not a
universal image-quality classifier.

Cloud detail now has a separate adaptive budget. It starts with a small shadow map
and lower-resolution real volume rendering, increases after sustained callback
headroom, and retreats on stalls with a cooldown. Cinema can still reach the pinned
high preset; Balanced retains its existing cloud ceiling. This does not change the
terrain preset, selected light, cloud cover, transport intent or recorded route.
The report includes actual cloud tier, ceiling, resolution scale, shadow size and
submitted cloud frames. These are callback-budget decisions, not measured GPU
presentation times. A clear sky still submits no volume or shadow work. Pointer
interaction with clouds enabled is verified independently of cloud-off rendering.


### Close-camera terrain support

Camera and route grounding query already-loaded physical geometry independently
of render-frustum membership. `WorldSurfaceIndex` maintains query-only mesh
proxies with shared geometry/materials and fixed Earth-to-local matrices. These
proxies never enter the render scene or count as drawn/visible terrain. AABB
filtering uses actual mesh bounds, and the finest intersecting surface wins;
coarse fallbacks above eight metres geometric error cannot reposition the close
camera. Per-tile disposal releases the query references without disposing shared
GPU resources. Recorded route elevations remain immutable.

A small non-masking support region under the close following camera requests
terrain that may lie behind the visible frustum. It remains useful while paused,
is bounded to a 90–140 metre radius and a four-metre geometric-error target, uses
the same 24-body download/parse limit, and is removed for free camera and views
above 800 metres range. Missing recorded elevations disable this request rather
than inventing a ground plane. The region is a loading envelope, not claimed
terrain. Its local distance priority gives collision support precedence over
unrelated distant detail; ordinary route look-ahead remains speculative.

Reports add camera height, qualified target correction/error, actual measured
clearance and support/index counters—no geographic coordinates or provider URLs.
Current-view coverage still uses only the renderer's selected terrain, independently
of this physical-query index. Live Runner acceptance requires measured clearance,
a qualified target surface, the exact effective quality's nominal target, and the
existing sustained coverage/texture checks within the unchanged recovery deadline.

The earlier global coarse-frontier experiment was removed after live evidence
showed a continent-scale parent delaying close-view refinement. No temporary
coarsening remains in this implementation. The synthetic real-renderer regression
now blocks fine terrain while a deliberately misleading coarse surface is drawn,
verifies the camera does not follow that coarse height, then verifies actual fine
surface grounding and clearance after the response arrives.
