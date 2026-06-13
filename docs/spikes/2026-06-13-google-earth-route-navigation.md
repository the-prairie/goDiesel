# Spike: Google Earth-Style Route Navigation

Date: 2026-06-13

## Question

Can goDiesel render a route in a Google Earth-like, photorealistic 3D world and navigate along it?

## Short Answer

Yes. The strongest path is to use Google Photorealistic 3D Tiles through the Map Tiles API, rendered with CesiumJS or Google Maps JavaScript 3D Maps.

The current project key successfully returned the Google 3D Tiles root tileset from:

```text
https://tile.googleapis.com/v1/3dtiles/root.json
```

Local probe result:

```text
HTTP/2 200
asset.version: 1.0
```

That means the next prototype can be a real Earth-style route viewer, not a fake terrain-map approximation.

## Product Fit

This is the right direction for the "Project Genie / Google Earth route world" idea.

Street View is best for ground-level moments, but it is discontinuous and road-biased. A Google Earth-style 3D route viewer is better for:

- continuous route playback,
- mountains and trails,
- aerial terrain drama,
- route context,
- cinematic flyovers,
- a single coherent visual source.

Street View should become an optional windshield layer or checkpoint mode. The primary route world should be photorealistic 3D terrain.

## Current API Options

### Option A - Google Maps JavaScript 3D Maps

Google now exposes 3D Maps in the Maps JavaScript API. It provides immersive 3D map experiences, photorealistic map modes, markers, and 3D models.

Pros:

- Same Google Maps API family already used by the Street View cam.
- Better fit if we want to stay close to Google Maps controls and platform semantics.
- Likely simpler for markers and route overlays.

Cons:

- Some APIs are alpha-only or fast-moving.
- Less mature for custom camera choreography than Cesium.
- Need to verify whether the current route line and animated camera APIs are enough for our exact playback feel.

### Option B - Google Photorealistic 3D Tiles + CesiumJS

Google Photorealistic 3D Tiles are OGC 3D Tiles/glTF data that can be rendered by any 3D Tiles renderer. CesiumJS is the mature open-source choice.

Pros:

- Best fit for "Google Earth-like" camera navigation.
- Strong camera APIs: flyTo, lookAt, tracked entity, sampled route movement.
- Natural for drawing a glowing route line, altitude-following camera, checkpoints, and cinematic replay.
- Can use the exact Google 3D Tiles root URL with the existing key.

Cons:

- Adds a larger runtime than the current static app.
- More GPU-heavy than MapLibre.
- Need to tune camera height/pitch carefully to avoid nausea or terrain clipping.
- Billing/quota moves from Maps JS/Street View into Map Tiles API usage.

### Option C - MapLibre/Cesium Terrain Without Google Photorealistic Tiles

Use open terrain/imagery sources, MapLibre terrain, Cesium World Terrain, or similar.

Pros:

- Less coupled to Google.
- Potentially cheaper or more controllable.

Cons:

- Does not match the "Google Earth / Project Genie" visual target as closely.
- Photorealistic coverage and labels are weaker.
- We already proved a map-like terrain cam does not satisfy the product intent.

## Recommendation

Prototype with CesiumJS + Google Photorealistic 3D Tiles.

Reason: the product goal is not "a map with pitch." It is a continuous cinematic 3D route world. Cesium's camera model and route entity primitives are better aligned with that than the current MapLibre stack.

Keep the existing MapLibre atlas and Street View cam for now. Add a separate lab mode:

```text
?lab=earth
```

This avoids destabilizing the current atlas while we evaluate the new visual mode.

## Prototype Scope

Build a first-pass Earth route viewer that:

1. Loads CesiumJS in lab mode only.
2. Uses Google Photorealistic 3D Tiles as the world base.
3. Converts the current route polyline into Cesium Cartesian positions.
4. Draws a glowing route line above terrain.
5. Adds a current-position marker.
6. Drives camera playback along the route:
   - trailing chase camera,
   - pitch down toward the route,
   - smooth bearing,
   - route progress synced to existing scrubber.
7. Keeps the existing bottom playback controls.
8. Falls back to the current atlas if 3D tiles fail to load.

## Implementation Sketch

### New State

```js
let earthViewer = null;
let earthRouteEntity = null;
let earthMarkerEntity = null;
let earthReady = false;
```

### Lab Mode

```js
const ROUTE_CINEMA_MODES = SHOW_DEV_CINEMA_MODES
  ? ['artifact', 'flyover', 'quest', 'earth']
  : ['flyover', 'earth'];
```

Or keep `earth` as a direct query-only mode until it proves itself:

```text
?lab=earth#quest/<id>
```

### Route Rendering

- Convert `[lng, lat, elevation]` to `Cesium.Cartesian3.fromDegrees`.
- Use a polyline entity with route color.
- Use a small marker entity for current point.
- Use route distance to interpolate current position, as the app already does with `routePointAt`.

### Camera

For each playback tick:

- get current point with `routePointAt(route, idx)`,
- get lookahead point with `routePointAt(route, idx + 20)`,
- compute heading,
- place camera behind and above current point,
- look at the current/lookahead midpoint.

Suggested first constants:

```text
camera height: 450-900 m above terrain
lookahead: 300-900 m by route length
pitch: -22 to -35 degrees
route line height offset: 8-20 m
```

## Risks

- Coverage: Google 3D terrain is worldwide, but 3D surface/building/tree data is coverage-limited. Remote routes may still look terrain-first rather than fully modeled.
- Cost/quota: Google Map Tiles API has separate usage and billing from Street View/Maps JS.
- Performance: photorealistic tiles can be heavy on mobile. The first prototype should be desktop-first.
- API policy: route overlays are allowed, but we should not derive/extract geometry from Google tiles.
- Key restrictions: production domain must be allowed for both Maps JavaScript API and Map Tiles API.

## Acceptance Criteria for the Spike Prototype

- `?lab=earth#quest/13935098460` loads a photorealistic 3D world.
- The route line is visible over terrain.
- Play/pause moves the marker and camera along the route.
- Scrubbing updates the Earth view.
- No console errors during a 30-second playback sample.
- Mobile either works or shows a deliberate "desktop-only prototype" state.

## Verdict

Proceed. The local key can access Google Photorealistic 3D Tiles, and the API landscape supports the desired product direction. Build the prototype as an isolated `earth` lab mode using CesiumJS first, then decide whether to merge it into the main atlas experience.

## References

- Google Maps Platform: Photorealistic 3D Tiles - `https://developers.google.com/maps/documentation/tile/3d-tiles`
- Google Maps JavaScript API: 3D Maps overview - `https://developers.google.com/maps/documentation/javascript/3d/overview`
- CesiumJS guide: Photorealistic 3D Tiles from Google Maps Platform - `https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/`
