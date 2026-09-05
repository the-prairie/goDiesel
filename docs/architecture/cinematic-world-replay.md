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
npx playwright test e2e/cinematic-world.spec.ts e2e/cinematic-world-renderer.spec.ts e2e/google-replay-production.spec.ts --project=chromium
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
