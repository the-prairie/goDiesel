# Sketch world: a one-city proof (Kyoto)

Branch `feat/sketch-world`, cut from `feat/overland` at e307660e. Lab route
`#/lab/sketch`. Overland's pixel world map and town variety are shelved on
`wip/overland-shelved` and `wip/town-variety`; nothing there is deleted.

## Product review

**The problem.** The owner rejected the pixel world because it "does not match
reality at all". She wants one continuous world: the real Earth drawn as a
monochrome sketch, realistic as you come into a city, her routes inked on
it, and colour meaning *explored*. Jumping into a route hands over to the
full-colour Google photorealistic replay. The style has to work for any city
on Earth with no hand-made art per place, so it must come from open map
data, not from drawings.

**Is this the right thing to build?** Yes, as a proof. The risk is the look:
whether open vector data, drawn as line work, reads like her reference (clean
dark line work on white: buildings, windows, street furniture). A one-city
proof with both candidate looks side by side answers that before anything
else is built on it.

**What is reused.**
- `maplibre-gl` 6.14, already shipped (Atlas fallback, route leaf map,
  planning map), with its Vite worker setup in `src/providers/maplibre.ts`.
- OpenFreeMap, the keyless tile host those maps already use: the
  `openmaptiles` vector source (water, waterways, landcover, parks,
  transportation, buildings with `render_height` and `render_min_height`) and
  the `ne2_shaded` Natural Earth shaded relief raster (to zoom 6), plus its
  glyphs. No new host, no key, no paid service.
- The Overland jump, unchanged: `OverlandJump` with `transition="town"` and
  the `TownJumpCover` contract (dive, hold, surface, finish), its story box,
  moments, Back, the attribution-band cut-out and the fallbacks. The sketch
  map takes the town's place as the cover.
- Route data: `routes`, `buildOverlandEntries`, `useRouteDetail`.
- Phone patterns from Overland: chips, 44 px targets, safe areas.

**What is shelved.** The pixel world map (real-world rebuild unfinished), the
pixel towns' variety work, and the creatures and characters (out of scope).
The pixel lab at `#/lab/overland` stays as it is.

**Scope mode: HOLD.** One city (Kyoto), her two routes there (064 and 065),
the whole loop: far view, into the city, routes inked, explored in colour,
choose a route, jump, Back. Two looks and three reveals behind an owner-only
review control. Not in scope: other cities' route choice UI, other people's
completions, terrain elevation in the city, offline tiles.

**Shadow paths.**
- *No WebGL*: MapLibre cannot start; the page says so and lists the routes,
  each still opening the 3D replay (which has its own fallback).
- *Tiles or style fail* (offline, host down): the map shows paper; the
  routes are still drawn (they are our own GeoJSON) and listed; a quiet
  status says the map could not load. The jump still works.
- *A route with no geometry*: it is listed, not inked, adds nothing to the
  explored area, and its jump goes straight to the replay's own fallback.
- *Google 3D unavailable*: the existing jump fallback (unchanged).
- *Reduced motion*: no flights; the camera cuts, the jump crossfades.

## Decisions

**S1. Engine: MapLibre with our own style, plus one custom WebGL layer for
building line work.** MapLibre gives continuous zoom from the whole Earth to
a street, touch pinch, rotate and tilt, and we own every pixel. Streets,
water, parks and coastlines are style layers drawn as line work. Buildings
are white `fill-extrusion` forms; their drawn edges (roof outlines and
vertical corners) come from a custom layer that reads the same building
features and draws anti-aliased screen-space lines, depth-tested against
MapLibre's extrusions so hidden edges stay hidden. Lines are geometry, not a
post-process over the image, so they hold steady while moving.

**S2. Data source.** OpenFreeMap (`tiles.openfreemap.org`), OpenMapTiles
schema, built from OpenStreetMap; Natural Earth relief raster from the same
host. Terms: free, no key, no registration, no request limits stated; tiles
are ODbL (OpenStreetMap) and must carry "© OpenStreetMap contributors";
OpenFreeMap asks for a credit. The attribution control is always shown,
compact on a phone, never covered: "OpenFreeMap © OpenMapTiles © OpenStreetMap
contributors", Natural Earth credited in the relief source.

**S3. Explored.** For this proof, explored means her completed routes. The
module takes a list of `ExploredRoute { slug, line, by }`, so other people's
verified completions can be added later without changing the renderer.

**S4. Reveal.** Three options for the owner to compare: (i) *line*, only the
route itself in colour; (ii) *corridor*, everything within 120 m of the route
in colour, crisp edge; (iii) *wash*, a soft watercolour bloom around the
route (about 400 m), its edge feathered. Colour comes from per-feature paint
expressions using MapLibre's `distance` expression (no second map), and the
wash is a heatmap of points sampled along the route.

**S5. Looks.** A "clean architectural line drawing": white paper, ink edges,
double-line streets, hatched water. B "looser hand-drawn pencil": graphite
grey, edges that wobble and overshoot their corners, a second fainter
stroke, paper grain over the page. Both from the same data.

**S6. Camera.** Far view: the whole of Japan. City view: the bounds of her
Kyoto routes, tilted. Route start: close, tilted 60 degrees, looking along
the route's first stretch. Street view (for the review screenshot): low and
steep. All pure functions, unit tested.

**S7. The review control** is owner-only: shown with `?review=1` (kept in
the URL), never by default. It switches look and reveal live.

## Task breakdown

1. Pure logic, test first: explored routes and reveal geometry (sampling,
   radii, corridor expressions), camera targets, style builder for both
   looks and three reveals, building edges from footprints, the page
   lifecycle reducer (`sketch-map`), review options from the URL.
2. The custom edge layer (WebGL2, instanced segments, per-tile origin).
3. The page: lazy route, map, routes list and chips, review control, status,
   attribution; the jump through `OverlandJump` with the map as cover.
4. Playwright: the loop with the style and tiles stubbed; the jump with the
   existing Google stubs.
5. Real-browser verification at 375x812 and 1440, frame times, screenshots,
   iteration against the reference.
6. Bundle budget entry from measured size.

## Decisions made while building

**S8. Edges are drawn from whole tiles, read off the main thread.** The edge
layer fetches the zoom-14 building tile itself (the same URL MapLibre uses,
so the browser cache serves it) in a worker, reads it with a small protobuf
reader (no new library), and drops the cut each tile makes along its border.
A dense Kyoto tile is about 1 MB with 22,000 buildings and 40 ms to read.
Lines are instanced screen-space quads, 1.15 px (A) or 1.05 px twice with a
wobble and overshoot (B), anti-aliased, pulled 0.08% of the remaining depth
towards the camera so they win over their own face but not over a building in
front. Short strokes and strokes more than twice the view's distance away
fade, so far districts stay paper instead of turning to ink.

**S9. Colour is worked out from the tiles, not by MapLibre's expressions.**
Two MapLibre routes failed, measured, not assumed: `distance` counted
buildings 900 m from the route as within 120 m, and `within` ignores polygons.
Colouring by feature failed too: OpenFreeMap merges a tile's buildings into a
few dozen multipolygons, so one feature id colours a whole district. So the
worker names the buildings within the radius one by one and returns their
roofs and walls in real colours (plaster, timber, tile, stone), which the edge
layer draws over MapLibre's white forms; water and parks colour by feature
(a river near the route colours whole, which reads right); woods are merged
into whole hillsides and stay ink; roads are merged by name and stay ink, the
ground round them colours (the corridor's own shape). The wash adds a
heatmap bloom and half-strength colour in its outer half.

**S10. Explored, for later.** `exploredRoutes(routes, others)` already takes
other people's verified completions marked `by: "verified"`; nothing else
changes when they arrive.

**S11. The credit.** MapLibre's credit is shown in full on every screen size
(never folded to an (i)), and the routes and keys sit above it however many
lines it wraps to (measured, not guessed).

## Results

- The loop works in Chrome at 1440x900 and at 375x812 (phone emulation)
  against real OpenFreeMap tiles and the real Google 3D replay: far view of
  Japan, into Kyoto, both looks, all three reveals, choose 064, dive, hold,
  resolve, the realm with its story box, Back, and the return to the sketch
  framed on 064.
- Frame time panning and turning over central Kyoto at zoom 16.6, 60° tilt,
  on this Mac's GPU: 16.7 ms median and 16.7 ms p95 at 1440 (2.8 million edge
  segments in 18 tiles), the same at 375 (1.6 million in 11), and the same
  with the CPU throttled four times. A phone GPU has to draw those
  1.6 million instanced strokes; that is the risk (see the report).
- Bundle: the sketch's page and worker are 39.5 KiB, lazy, on top of the
  MapLibre chunk the app already loads on demand; budget 48 KiB.

## Spike: the sketch as the real city (`#/lab/sketch-real`, lab only)

**Status: experiment, not a feature. Not linked from anywhere.**

> **POLICY: owner reports yes (13 Nov 2026).** Lauren emailed Google and
> reports that a non-photorealistic shader over Photorealistic 3D Tiles is
> allowed. The reply itself is not in the repository and its wording has not
> been read here, so the exact scope (display-only filter, attribution
> untouched, nothing stored) is assumed, not quoted. Keep Google's
> attribution unstyled and uncovered, store nothing derived from the tiles,
> and quote the reply here once it is to hand.

**What it is.** Google's Photorealistic 3D Tiles are rendered by our own
Cesium 1.143 (already a dependency; its Google tileset loader and credit
display are built in, so no new library). A Cesium post-process stage draws
the frame as ink on paper:
- dark lines where depth jumps (silhouettes);
- creases where the rebuilt surface normal turns (corners, roof ridges);
- finer lines from strong edges in the photo texture (windows, signs, road
  markings), fading with distance.

It runs per frame on the rendered image only. Nothing is extracted, saved
or traced. One slider blends to the real colour. A corridor mode lets colour
flood 70 m either side of route 064, measured per pixel on the ground plane.

**Attribution.** Cesium shows the Google Maps logo and the data line built
from each tile's copyright, with `showCreditsOnScreen`. The credits sit on a
dark band, because Cesium's Google logo is drawn light for photographs and
would vanish on paper. The Cesium logo is kept clear of Google's. The
spike's panel sits top-left, away from the credits.

**Measured (Chrome on this Mac, GPU).**

| Measure | 1440×900 | 375×812 |
|---|---|---|
| First complete street view | 10.4 s | 5.4 s |
| Requests for that view | 1,253 | 554 |
| Data for that view | 70 MB | 30 MB |
| Requests for a whole session (street, aerial, reveal) | 1,907 | 616 |
| Data for a whole session | 108 MB | 32 MB |
| Tileset memory | 383–510 MB | 236 MB |
| JS heap | ~410 MB | ~257 MB |
| Orbit frame time, median / p95 | 16.7 / 16.7 ms | 16.7 / 16.8 ms |

**Policy passages read (13 Nov 2026).**

From the Google Maps Platform Terms of Service, https://cloud.google.com/maps-platform/terms:
- §3.2.1(a): "copy, modify, create a derivative work of, reverse engineer, decompile, translate, disassemble, or otherwise attempt to extract any or all of the source code".
- §3.2.2(b): "Customer will not modify, obscure, or delete such attribution."
- §3.2.3(a): "Customer will not export, extract, or otherwise scrape Google Maps Content for use outside the Services."
- §3.2.3(c): "Customer will not create content based on Google Maps Content."

From the Map Tiles API policies, https://developers.google.com/maps/documentation/tile/policies:
- "You may not use Map Tiles API for any non-visualization use cases, such as: Image analysis …"
- "you must not pre-fetch, index, store, or cache any Content except under the limited conditions stated in the terms."
- "You may overlay your own 3D objects on Photorealistic 3D Tiles as long as the 3D objects aren't extracted, traced, or otherwise derived by hand or machine from Photorealistic 3D Tiles."
- With CesiumJS, "you need to enable showCreditsOnScreen".
- "you must not overlap or obscure the Google logo with any other logo, such as the renderer's logo."
- "Maintain an accessible contrast between the logo and the background."

The Service Specific Terms page (https://cloud.google.com/maps-platform/terms/maps-service-terms) had no Map Tiles API section when read.

**My reading, low to moderate confidence.**
- *For:* nothing found forbids changing how tiles look on screen. The use
  stays a visualization, inside the Services, with nothing stored or
  extracted, and the attribution is untouched.
- *Against:* §3.2.3(c) "create content based on Google Maps Content" and
  "image analysis" are broad. Edge detection on Google's imagery could be
  read as either, and a heavily restyled scene could be read as modifying
  the content.
- Ask Google directly before shipping.

## Round 2: the OpenStreetMap sketch toward her reference

**Owner decision.** Do both. The real-geometry sketch is the heart of a city
where Google has 3D coverage. The OpenStreetMap sketch is the far-out view
and the fallback everywhere else. Defaults are the clean line look and the
corridor reveal; the review switch stays for now.

**S12. Two phone defects, fixed test-first.**
- *No edge lines at street level on a phone.* The edge layer took the tiles
  round the middle of the view. A low, tilted camera looks far beyond its
  nearest buildings, so the six tiles a phone gets were the wrong six. It now
  takes tiles along the line from the ground at the foot of the screen to
  the middle of the view, nearest first (`sketch-tiles.ts`, unit tested).
- *The far view was blank for seconds on first load, with no word.* The map
  is now ready only once its first view is drawn, tiles and all. Until then
  it says "Drawing the world…", with a pen line moving under it (static with
  reduced motion). Covered by an e2e test with slow stubbed tiles.
- Locally the first view takes about 1.2 s. The ten seconds seen came from a
  colder or slower path (a phone on the network, a cold dev server) that I
  did not reproduce exactly.

**S13. Buildings drawn by rule: INVENTED DETAIL, NOT THE REAL BUILDING.**
Near the camera the edge layer draws each building itself (`sketch-massing.ts`):
- **Height.** A height the data really gives (above 7.5 m) is kept. Otherwise
  height comes from footprint size: about two storeys for a house, a few for a
  block, more only for the largest footprints. It is drawn towards the
  heights of tall neighbours within about 100 m, never lower than the data,
  and the same every time.
- **Roof.** Low, near-rectangular Japanese buildings get tiled roofs: gabled
  when long, hipped when squarish. Towers above 12 m get a flat roof behind a
  1 m parapet. Odd shapes and other regions get a flat roof. A building cut
  by a tile's edge keeps the data's height and a flat roof, so both halves
  agree.
- **Facades.** Walls carry their distance along and their height, so a shader
  draws:
  - floor lines;
  - windows in bays;
  - on a tower, shopfronts at street level;
  - on a house, a slatted lattice and a door on the ground floor;
  - rows of tiles on pitched roofs.

  Each pattern fades out before it gets too fine to draw.
- MapLibre's own white boxes stay for the far city. Our buildings are never
  lower, so the boxes hide inside them.

**S14. Street furniture from the data, where the data has it.**
- Trees stand in the data's parks and woods. Where each tree stands is
  invented, on a jittered 10 m grid, at most 1,500 per tile.
- Bridges get railings either side of the deck.
- Railways keep their sleepers.
- OpenFreeMap's OpenMapTiles build carries no street lamps, crossings,
  benches or street trees, so none are drawn. They would need our own
  OpenStreetMap extract.

**S15. The route at street level.** From zoom 14.6 the flat route line
fades out. The edge layer draws her route on the ground at full resolution
(568 points for 064 instead of 96), 0.6 m up, 3.2 px of the one red, hidden
by buildings in front (`sketch-route-ground.ts`).

**S16. Inside the 3D world.** `OverlandJump` and its realm take a skin. The
sketch skin draws:
- her marker as an ink figure from behind, with the red accent, in four
  frames of a stride;
- the story box, moment box, keys and status boxes as ink line on paper.

Same elements and behaviour as Overland's pixel versions, which stay
unchanged for Overland.

**S17. The join: one continuous world.** *Superseded for the browse flow by
S22 (round 5): the zoom hand-over below is built and kept behind the lab
switch `real=1`, off by default.* Decided and recorded. Not built
this round.

1. *World and region (zoom below about 14.5).* Always the OpenStreetMap
   sketch: coastlines, relief, cities, her routes.
2. *Into a city (zoom 14.5 and closer).* Hand over to the real-geometry
   sketch only when all of these hold:
   - Google has Photorealistic 3D coverage there (a coverage list per city of
     hers, kept with the route data, so nothing is fetched to find out);
   - the policy question in the spike section is answered yes, in writing;
   - the device can afford it: WebGL2, `navigator.deviceMemory` of at least
     4 where known, and no Save-Data;
   - Google's tiles for the first view arrive within about 8 s.

   While Google's tiles load, the OpenStreetMap sketch stays on screen. Once
   they are drawn, the Cesium canvas fades in over it with a matched camera
   (MapLibre's centre, zoom, pitch and bearing turned into a Cesium camera
   position). Both are ink on paper with the same corridor colour, so the
   change reads as more detail arriving, not as a switch.
3. *Back out.* Below zoom 14 the real-geometry sketch fades out and is torn
   down to free its 250–500 MB, and the OpenStreetMap sketch carries on.
4. *Fallback.* With no coverage, a policy no, tiles failing, too little
   memory, or reduced data, the drawn OpenStreetMap city (S13) stays. That is
   the experience everywhere else anyway.
5. *The jump.* From the real-geometry sketch, "jumping in" becomes a colour
   flood on the same geometry (reveal 0 → 1) with the existing replay
   behind it. From the OpenStreetMap sketch it stays the current dive and
   hand-over.

   *Cost, from the spike:* a first view of 30–70 MB and 5–10 s.

**Round 2 results.**
- **Street view at zoom 17.4, 66° tilt, panning and turning (Chrome on this
  Mac's GPU):**
  - 1440: 16.7 ms median, 16.8 ms p95; 2.9 M triangles and 3.4 M edges in 12 tiles.
  - 375: 16.7 ms median, 16.7 ms p95; 2.0 M triangles in 8 tiles.
  - 375 with the CPU throttled 4×: 16.7 ms median, worst frame 33 ms.
- **GPU memory on a phone.** Faces are packed to 20 bytes a vertex. The
  phone's six tiles come to about 1.5 M triangles: roughly 90 MB of faces and
  40 MB of edges. That is the phone risk.
- **Bundle.** The sketch's chunks come to 54.3 KiB; budget raised to 60 KiB.

## Round 3: the hand-over, built (S17)

**S18. How it is built.**
- **Lifecycle.** `sketch-handover-state.ts` is a pure reducer with phases
  drawn → loading → fadingIn → real → fadingOut → drawn, and declined. It
  is registered as `sketch-handover`.
  - It enters at zoom 14.5 and leaves below 14, so it never flickers at the
    edge.
  - A declined city is tried again only after the camera has left it.
  - An answer from an abandoned load is ignored.
- **Conditions.**
  - Coverage comes from `app/src/data/photoreal-coverage.ts`, an authored
    list kept with the route data. It holds Kyoto and the height of its
    streets above the ellipsoid.
  - The device needs WebGL2 and at least 4 GB of memory where the browser
    reports it, and must not be saving data.
  - The first view must arrive within 8 s.
- **Camera.** MapLibre stays the master; Cesium takes no input.
  `sketch-camera-match.ts` turns MapLibre's centre, zoom, pitch and bearing
  into a Cesium position. It uses MapLibre's own field of view, given to
  Cesium as vertical on a portrait screen and as the wider horizontal one
  on a landscape screen. Every MapLibre move sets the Cesium camera.
- **The real view.** `sketch-real-view.ts` and Cesium are loaded lazily,
  only when a hand-over starts. Cesium is the 4 MB chunk shared with Atlas,
  never in the first load.
  - Maximum screen-space error is 24: a sketch needs less detail than a
    photograph. At 16 the first view at 1440 missed the 8 s limit.
  - The first view counts once at least 24 tiles have loaded and no more
    than 6 are pending, with none processing. The last tiles fill in under
    the fade.
  - Teardown destroys the Cesium viewer (and with it the tileset and its
    GPU memory), empties the layer and drops every reference.
- **Line quality.** One-pixel outlines, inked on the near side of a depth
  jump only; creases only within about 2 km; photo-edge detail weak and only
  within about 350 m.
- **Corridor.** Both sketches use the same reveal radius
  (`REVEAL_RADIUS_M`), and the wash fades in both.
- **The jump.** From the real city, the dive flies MapLibre's camera (Cesium
  follows) while the colour floods 0 → 1 over the same 2.8 s, then hands
  over to the replay. Coming back floods 1 → 0. With reduced motion it
  cuts.
- **Attribution.**
  - Google's logo and data line come from Cesium, unaltered and uncovered.
  - They sit just above OpenStreetMap's credit line, and the page's keys sit
    above both.
  - The dark band behind them is ours. Cesium draws Google's logo light, for
    photographs; on paper it would fail Google's contrast requirement.
- The spike page now draws through the same view.

**Round 3 results.** Measured on the production build, Chrome on this Mac,
Kyoto at zoom 16.4 and 58° tilt.

| | 375×812 | 1440×900 |
|---|---|---|
| Time to first view, from the start of loading to the fade (timed in the page) | 4.7 s | 6.5 s |
| Google 3D tiles for the hand-over | 232 requests, 14.7 MB | 394 requests, 29.5 MB |
| Real city's tileset memory | 95 MB | 181 MB |

- An earlier run at 1440 with screen-space error 16 timed out and was
  declined, so the drawn city stayed: the fallback works, and is why 24 was
  chosen.
- After teardown the real layer is empty and the view is gone. The JS heap
  hardly moves, because tile data lives outside it. Whole-browser resident
  memory was too noisy on macOS to measure the freed memory.

## Round 4: the real city's ink, and two faults

**S19. The first-view clock measures tile arrival, not library download.**
On the dev server Cesium is served unbundled, and loading it alone took
longer than 8 s, so the hand-over declined as "slow" before a single tile
had arrived.
- The 8 s clock now starts when the tileset is up and its tiles are on their
  way (`tilesStarted`).
- A separate 30 s ceiling covers a tileset that never starts at all
  (declined as "tiles").
- Both are tested in the reducer.
- Measured on the dev server at 375, the hand-over now completes: 6.3–7.3 s
  from the start of loading to the fade, library download included.

**S20. Google's attribution is whole on a phone.**
- Cesium writes an inline `bottom` offset on its credit box, which beat our
  CSS. The box was left at 3 px and its second line sat under OpenStreetMap's
  credit.
- It is now lifted by a margin, as Atlas does. An e2e test with Cesium's
  inline offset reproduces the fault and guards it.
- The page's keys sit above both credits.
- "Cesium ion" logo: the only request to Cesium's servers is
  `assets.ion.cesium.com/google-credit.png`, the Google logo image that
  Cesium hosts. No ion data service (terrain, imagery, tiles) is used.
  Cesium's terms tie the logo to its Licensed Services. CesiumJS shows its
  logo by default, and the asset request goes to ion's host, so the logo is
  kept until Cesium confirms it may go.

**S21. Line quality.**
- The real city is now rendered at the screen's pixel density (up to 2x),
  with FXAA after the sketch pass.
- An outline needs both a jump and a bend in depth, so slopes and lumps draw
  nothing.
- Creases compare wide-kernel normals; photo detail is faint and close by
  only.
- Surfaces are shaded like the drawn city: paper roofs, walls a shade darker.
- *Tried and dropped:* draping OpenStreetMap's building outlines onto
  Google's geometry as ruled ink (`GroundPolylinePrimitive` classified onto
  the 3D tiles). Classification paints every surface inside the line's
  volume, walls included, so the outlines came out as black smears
  (`sketch-r4-hybrid-try-375.png`).
- *Verdict:* close in, the real city now reads as real shapes in ink. But its
  lines follow Google's photogrammetry mesh: cars and trees become blobs,
  walls wobble, and middle-distance lines are faint. It does not reach the
  drawn city's ruled look. The ceiling is the mesh.


## Round 5: the drawn city is the world; the real one appears on the jump

**S22. Decision.** The drawn OpenStreetMap city is the world you browse at
every zoom. Google's city appears only when you jump onto a route, in its
own colour, unaltered.
- *Why:* round 4 showed that Google's city drawn in ink cannot look ruled.
  Its lines follow the photogrammetry mesh, and its middle distance is
  faint, so the zoom hand-over read as a drop in quality.
- The hand-over code, its reducer and its tests are kept behind the lab
  switch `real=1`. The `sketch-real` spike page is unchanged.

**S23. The jump, drawn to real.** What the viewer sees, and the fixes:
- *Camera matched at the cut.* The dive now ends where the 3D replay's
  opening camera will stand: the same centre, heading, tilt and range, read
  from the functions the replay driver uses, at Google's own field of view,
  which eases in during the flight.
  - A dive finished early (when Google is ready first) now lands on that
    camera instead of stopping mid-air. Before, the cut came at zoom 7,
    mid-arc.
  - MapLibre's field-of-view setter fires its own move events. These are
    marked, so they never end a flight early.
- *No pop on landing.* The drawn buildings round the landing spot start
  loading as the dive begins, so they are there when it lands.
- *The drawing stays until the real city has drawn.* While Google loads, the
  drawn city stays on screen with a plain "Loading the 3D city…" and Cancel.
  It crossfades only once Google's scene is ready. A failure shows the
  jump's plain fallback message with Back, over the drawing, never a blank.
  Reduced motion cuts.
- *Coming back.* The camera settles close over the route's start, at
  MapLibre's own field of view, where the route's corridor shows in colour.
- *Google's attribution* in the 3D world is Google's own, drawn by its map,
  uncovered by the controls.
- *Port 8790.* The jump's loading is Google's Maps JavaScript, never the
  bundled 3D library, and it has no 8 s limit, so the dev server's slowness
  cannot decline it. Measured read-only on 8790 at 375: the real city shows
  11.4 s after Jump in, and the replay runs at 12.2 s.

**Round 5 results.** Time from pressing Jump in to Google's city showing
(the crossfade starting), dev server 8795:

| | Real city showing | Replay running |
|---|---|---|
| 375×812 | 7.5 s | 8.3 s |
| 1440×900 | 9.7 s | 10.5 s |

The dive itself takes 2.9 s; the rest is Google's map loading behind the
drawing.

## Round 6: the two waits on a phone

Measured at 375×812 (iPhone user agent, DPR 3) in the bundled Chromium,
headless and therefore always rendering, with standard performance marks
(`sketch:map-created`, `first-render`, `first-tile`, `style-loaded`, `idle`,
`google-warm-start`, `google-warm-done`) and Resource Timing grouped by host.
Production build on a local preview, and the dev server on 8790 read-only.

**S24. Wait 2: warm Google's renderer when a route is chosen.** On Jump in,
the Maps script and maps3d library (about 0.3 MB) loaded during the dive, and
the renderer's main chunk (2.4 MB) and its config only once the Map3DElement
was in the page; Google's 3D tiles (about 380 requests) started after that and
ended the wait. Warming the library alone moved nothing (resolving 6.5 and
7.6 s against 6.3 and 6.7 s without). An unattached Map3DElement fetches only
about 40 KB. So choosing a route (once the drawing is up, not inside the 3D
world) now loads the script, the library and a 1 px hidden Map3DElement, kept
only until the renderer's main chunk arrives (about 1.3 s, 8 s at most) and
then removed. The second chunk (0.8 MB) is asked for only by a visible scene,
and holding the hidden element for it ran to the 8 s limit, so it still loads
on Jump in. Cost of a route chosen and never jumped, once per page: about
2.7 MB from Google, 2 requests to Google's tile hosts (the key check's root
and one more), about +2.3 MB of JS heap after collection; no scene is kept and
nothing more is fetched. Skipped with Save-Data or prefers-reduced-data, and
without a key. Open question: whether Google counts the hidden element as a
billed 3D map load.

| Jump in at 375 | Holding from | Resolving (city shows) | Realm |
|---|---|---|---|
| Production, no warm (2 runs) | 2.9–3.1 s | 6.3 / 6.7 s | 7.1 / 7.5 s |
| Production, warmed (3 runs) | 2.9 s | 5.8 / 5.5 / 5.1 s | 6.6 / 6.2 / 5.9 s |
| 8790, no warm | 3.0 s | 6.1 s | 6.9 s |
| 8790, warmed | 3.0 s | 5.2 s | 6.0 s |

**S25. Wait 1: measured, not changed.** Unthrottled the opening is drawn
("idle") at 1.0–1.3 s on both servers, and at 1.6 s with the CPU slowed 4×.
The 8–14 s seen in the Browser pane is the pane being hidden: a hidden page
runs no animation frames, so MapLibre never draws. On slow 4G (1.6 Mbps,
150 ms) with the CPU slowed 4× the opening takes 8.8 s: 4.5 s to download
about 800 KB of app JavaScript before the map exists (MapLibre 279 KB and all
route data 195 KB load side by side), then about 4 s of tile index, tiles and
label glyphs. Fetching the tile index and glyphs beside the page's code was
tried: MapLibre then read them from the cache, the first tile came 1.1 s
sooner, but the map was created 0.5 s later and the full drawing was no
sooner (8.6–8.8 s), so it was removed. What would move it: not loading every
route's data before the map is made, and a smaller first view.

## Round 7: the opening on a slow phone network

Same method as round 6 (production build, 375×812, bundled Chromium), on
slow 4G (1.6 Mbps, 150 ms) with the CPU slowed 4×, and unthrottled. A new
measuring mark, "routes listed", is when her first route appears in the list.

**Where the 8.8 s goes.** 0–4.5 s: the page's JavaScript, of which MapLibre
(280 KB) and the route data for every route (198 KB gzipped, 67 routes; the
sketch uses 2 of them, about 6 KB) share the line. Nothing of the page showed
until both had arrived. 4.9–8.9 s: eight z10 vector tiles over Kyoto, 588 KB
(up to 134 KB each), and 97 KB of label glyphs.

**S26. The page does not wait for MapLibre.** MapLibre is imported
dynamically, its download starting as the page's module runs, so the paper,
the status and her route list show once the route data is here. If MapLibre
cannot load, the app's chunk recovery reloads once as for any chunk; if it
still cannot, the page says the map couldn't load (not that WebGL is
missing) and the routes stay.

| Slow 4G + 4× CPU (2 runs each) | Routes listed | Map created | First render | First tile | Idle |
|---|---|---|---|---|---|
| Before | 4.9 / 4.6 s | 4.7 / 4.5 s | 5.0 / 4.8 s | 8.2 / 7.8 s | 9.2 / 8.8 s |
| After | 3.1 / 3.1 s | 4.7 / 4.6 s | 4.9 / 4.8 s | 8.0 / 7.8 s | 8.9 / 8.8 s |

Unthrottled (5 runs each), idle: before 0.81–1.24 s (median 0.94 s), after
0.86–0.99 s (median 0.90 s).

**Measured, not done.**
- *A smaller first view.* Tiles the opening needs: as now 8 (588 KB); flat
  or pitch 30, 6 (525 KB); zoomed out 0.5–1, 6 at z9 (755 KB); flat and
  zoomed out 1, 4 (615 KB). At best 63 KB (about 0.3 s) for a different
  opening; not worth it.
- *Not loading every route's data before the map.* Needs a smaller generated
  projection (the sketch's region only), a build pipeline change, so it is
  held for a decision. A throwaway build with a Kyoto-only copy (never
  committed) measured: routes listed 2.2 s, map created 3.7–3.8 s, first
  tile 7.1–7.4 s, idle 8.0–8.2 s.

## Round 8: the drawn buildings at the dive's landing, in Safari

Measured in the booted iPhone 17 simulator's Safari (402×714 CSS px, DPR 3)
and in the bundled Chromium at 375×812. A scratch proxy in front of the
server injected a measuring script, which:

- turned the Google warm-up off with its probe;
- stood in a never-ready Google engine, so the jump stayed over the drawn city;
- pressed Jump in, then sampled the edge layer's new `wanted` / `drawn`
  counts (the tiles the current view draws buildings from, and how many of
  those are on the GPU) and per-tile times.

**Cause.** Not the network and not a cold server: it reproduced on a
production build. Making a building tile is CPU work in one worker, one tile
at a time: about 0.5 s a tile in Chromium, 0.4–1.7 s in simulator Safari (a
tile's fetch waited on the previous tile's work). The dive asked for its
tiles only on Jump in, and for the wrong ones. It took the tiles round the
landing's centre, but a tilted view draws from the ground at the foot of the
screen, so about 3 of 9 tiles made were never drawn, and 3 the landing
needed were asked for mid-dive. In Chromium that left 2 of 6 drawn at
landing; in Safari, 0 of 6.

**S27. Make the landing's buildings when the route is chosen; let late ones rise.**
- The tiles for a camera not there yet come from the ground at its foot
  (`groundAtFoot`, `tilesForView`), so exactly the landing's tiles are made.
- Choosing a route (once the drawing is up) makes them then, about six tiles
  once per route. They are skipped with Save-Data or reduced data, when the
  dive still asks for them as it starts.
- A tile that arrives while on screen rises from the ground over 700 ms
  (eased); with reduced motion it is simply there. Nearest tiles are made
  first, so a landing that beats them still has its foreground drawn.

| First jump: buildings drawn at landing / all drawn after Jump in | Before | After, 2 s or 8 s after the map is up | After, jumping 0.3 s after |
|---|---|---|---|
| Safari, production | 0 of 6 / 7.0 s (2 runs: 7.0, 7.0) | all at landing (2.97, 3.00 s) | 2 of 6 / 5.9 s |
| Safari, 8790 | 0 of 6 / 5.4 s | all at landing (2.95–3.26 s) | not measured |
| Chromium, production | 2 of 6 / 5.2 s | all at landing (2.86, 2.91 s) | all at landing (2.89 s) |
| Chromium, 8790 | 3.5 s | all at landing (2.92, 2.92 s) | not measured |

With Save-Data (dive-time prefetch only, now of the right tiles): Safari
4.2–5.1 s, Chromium 2.9–3.9 s. A second jump was always instant: the tiles
are still in the layer.

The sketch world's code is now 76.0 of its 76 KiB budget (12 bytes to spare):
to fit, the per-tile timing used to find the cause was taken out again, and
the layer's tile maths shares one Web Mercator helper.

## Round 9: the replay's transport, marker and line

**What is shared.** The transport (Back, Play, the scrubber) and the runner
are the jump realm's own (`overland-realm.tsx`), drawn in the pixel or the
sketch skin; production Replay has its own controls and its own dot marker.
The route line is shared: the realm and production Replay both draw the
engine's `immersive` palette.

**S28. A native transport, a position marker, a line that reads.** Sketch
skin only (the shelved pixel skin keeps its handheld bar):
- Leaving is a round 44 pt Back top-left, the route card beside it, never
  under it (`sketchRealmLayout`).
- Playback is one frosted bar above Google's credit, with 12 pt clear space
  and above the home indicator:
  - a 52 pt round icon Play/Pause named "Play"/"Pause";
  - a native range slider with a 4 pt track in her red and a 24 pt round
    thumb, 44 pt tall to grab;
  - distance so far and in all under the track, and "13.0 of 32.6 km" as
    its value text;
  - arrows step 1%, shift 5%, Page 10%, Home and End.
- Focus rings show for the keyboard only (`:focus-visible`), in system blue.
- The card and moment cards share the bar's material (frosted, rounded) and
  no longer repeat the distance.
- The stick figure is gone (no character yet). In its place is a position
  puck: her red with a white ring, a soft dark halo, and a white heading
  arrow turned by the route's bearing against the camera's heading.
  - It is 32 pt close up and 18 pt over the whole route (log-scaled by the
    camera's range), so it never reads as a body over the city.
- The immersive line (shared with production Replay):
  - the run in her red, 4.5 pt;
  - the way ahead in white, 3 pt;
  - both cased dark at 45%.
  - Widths are in screen points: Google draws in device pixels, so they are
    scaled by the device pixel ratio.
  - The line is drawn where tree canopy or a roof stands over it.
- How the camera moves is unchanged.

Bundles:
- the realm chunk is 15.6 KB (was 14.1);
- Overland is 131.8 of 150 KiB (was 129.9);
- the replay engine is 13.7 KB (was 13.5);
- the sketch world is unchanged.

## Round 10: the drawn city's buildings

**What the data has.** I decoded OpenFreeMap tiles with the worker's reader.
- Buildings carry render_height and render_min_height, and a colour where OSM
  tags one.
- There are no building-type or roof tags in OpenMapTiles.
- Type comes from context instead:
  - land use (industrial, school, university, hospital, retail);
  - places of worship (buddhist, shinto, christian points);
  - gates.
- Land cover gives gardens and grass.

**S29. Regional building rules.** All pure and tested, in
`sketch-region.ts`, `sketch-form.ts` and `sketch-massing.ts`, read in one
pass by `readContext`:
- *Region* from longitude and latitude: Japan, Mediterranean, Aegean
  (Greece, the Canaries), northern Europe, North America, tropical, and
  "other" as a neutral city. Each sets its houses' roof (form, pitch,
  eaves), its facade style and its colours.
- *Form* from footprint, height and land use: house, low block, mansion
  (Japan), block, tower, shed (industrial), institution (school, hospital),
  retail.
  - Japanese mid-rises are mansion blocks: balcony bands on the long faces,
    blank end walls, a plain ground floor with entrances, a plant room on
    the roof.
  - Towers outside Japan and the south get curtain walls.
  - Low Mediterranean blocks get low hipped roofs.
- *Landmarks* from a place of worship inside a footprint:
  - a temple: low walls with posts under a deep-eaved irimoya roof;
  - a shrine: a deep-eaved gable, vermilion where explored;
  - a church: a steep roof and a tower with a spire.
  - A point in no footprint is skipped.
- *Torii*, in ink, at gates within 40 m of a shrine.
- *Shrubs*: low ones in gardens and grass, as the trees in parks.
- *Facades in the shader*, not geometry: windows at human scale, ground
  floors, storey rhythm, balconies, ribs and posts. The patterns fade out
  with distance.
- *Eaves at no triangle cost*:
  - Roof planes overhang the walls: 0.7 m on Japanese houses, 1.6 m on
    temples.
  - Their undersides are shaded as soffits.
  - Kawara is a warm charcoal; tile lines show only close up.
- *Colour only where she has been* (correction A).
  - Outside her corridor: grey value on paper, with light walls and roofs a
    mid wash lightening with distance.
  - Inside it: the region's wall palette and roof material.

**Cost**, before and after, best of three on the same tiles (Kyoto ×4,
Fushimi, Calgary ×2, Rome ×2):
- Build time:
  - Node, V8: −5% in all (Kyoto −5%, Calgary and Rome a few ms more per
    tile).
  - Simulator Safari: −18% in all (Kyoto −23%). The neighbour-height
    lookup now keeps only real heights and asks only when a height is
    invented, which offsets the new work.
- Triangles −2% (Kyoto −0.6%, Rome −9.5%).
- In-browser triangles in the same Kyoto views:
  - street: +0.4%;
  - wide: −1.6%.
- Sketch bundle: 85.8 KiB, against a budget raised to 86 KiB.

## Round 11: the ridge line

**S30. The replay's control is the route's own profile.** This is the
owner's choice from the prototype studies, in the sketch skin only. The
pixel skin and production Replay keep theirs.
- The profile runs edge to edge along the bottom. Behind her it is
  coloured by effort: sand on the flat, red deepening to 12% grade, sage
  going down. The grade is smoothed over about nine samples, with a ±1.2%
  dead band. Ahead of her: hatched paper, an ink line and a loose second
  stroke.
- The marker rides the ridge. A tap on it plays or pauses. A press
  elsewhere takes her there, and a drag scrubs. A still hold (260 ms) opens
  the ridge to the 6 km round her, and the vertical scale adapts. Dragging
  is relative while it is open; release settles it back.
- Under reduced motion the zoom cuts instead of easing.
- The gesture is a reducer, `sketch-ridge-gesture`, registered as a
  lifecycle.
- The readout above the marker: the time of day she was there (in the
  route's own time zone, from its provenance), the distance and the
  elevation.
- Rings mark where she stood still four minutes or more, worked out from
  recorded time against distance. Zoomed in, they say how long. A flag
  marks the high point. Kilometre ticks adapt to the span: 5 km on her
  32 km run, 1 km zoomed, 25 km on a 192 km route.
- A run without recorded time shows no clock and no stops (1 of 67 routes).
- A flat run keeps at least 80 m of range, so it stays a calm, low ridge.
- For assistive tech and the keyboard: one "Route progress" slider whose
  value says the time and the distance of the total, plus a real Play/Pause
  button over the marker.
  - Arrows step 1%, Shift 5%, Page 10%, plus Home and End.
  - Space plays and pauses.
  - The focus ring shows for the keyboard only.
- *Google's credit*:
  - Map3DElement has no option to place, hide or style its attribution
    (checked against Google's current reference).
  - So the ridge sits on its own paper strip and Google's map ends where
    the strip begins.
  - The credit, which the map draws at its own bottom, stands on the map
    just above the ridge, uncovered.
- Touch:
  - `touch-action: none`, so the page never scrolls or zooms;
  - the marker is kept 32 pt from the screen's edges;
  - the strip's height takes the home-indicator inset;
  - a thumb may wander 6 pt before a tap becomes a drag.
- Drawing: a canvas, redrawn only when progress, play state, zoom or size
  changes. In simulator Safari that is about 10 draws a second while
  playing, at 0.6 ms each, and none while paused.

Round 9's frosted cards no longer boost saturation behind the blur, which in
Safari pulled bright road markings through as a pale patch.

Bundles:
- the realm chunk is 23.9 KB (was 15.6);
- Overland is 139.8 of 150 KiB (was 131.8);
- the sketch world is unchanged at 85.8 KiB.

## Round 12: planted moments, the TV storefront first

**S31. A catalog of moments and their placements, hers and private.**
- *Model* (`moment-catalog.ts`):
  - A catalog entry: an id, a kind ("tv-wall" first), a title for her
    reference (also its accessible name), a clip by URL or none, an optional
    caption, and a public flag (default false).
  - A placement: a building front (lat/lng and facing) showing one entry,
    or none.
  - An entry may stand in several places or none, and a place may be
    swapped or emptied.
  - A placement whose entry has gone shows nothing. An entry with no clip
    shows no signal.
- *Private by default*:
  - Her `moments.json` and clips live in `app/public/moments/`, which is
    gitignored. They are loaded over a committed example: one "no signal"
    entry, placed 370 m along route 064 at 34.995784, 135.769891, facing
    185°, a street-facing shop inside her corridor.
  - `make-dist.sh` rebuilds `dist/moments/` with only the entries she flags
    public, their placements and their clips (`app/scripts/moments-dist.mjs`).
    A public entry whose clip is not on the building machine ships with no
    clip and shows no signal. Without her file, nothing of hers ships.
- *In the world*:
  - Each placement is a button on its building: a small shop window, the
    one thing in colour and moving (CSS only).
  - It is shown from zoom 10 in and named "<title>, a planted moment".
  - It is placed by a lazy `moment-layer` chunk once the map is up; the
    world's own bundle grew 0.4 KiB.
- *Opening* (the `sketch-moment` lifecycle):
  - The camera flies to the street in front of the shop, looking at its
    front, and the drawn storefront (`moment-tv-wall`, its own chunk) fades
    in and pushes in to the window.
  - Nine sets play the clip muted, inline and looping, each treated
    differently. Sound is hers to turn on. The clip is fetched only now and
    released on leaving.
  - With Save-Data or reduced data, the clip waits for "Play the clip".
    Without a clip, or when it fails, the sets show no signal.
  - Reduced motion cuts the flight and the push-in.
  - Back or Escape puts the camera back exactly and focus back on the
    moment.
  - The caption shows only when the entry has one.
- *Her catalog view* (`#/lab/moments`): each entry with a silent preview,
  where it stands or "Not placed", and places that show nothing.
- *Not built: assigning and swapping in review mode.* It needs her private
  file written from the browser. The proposal:
  - Extend the owner writer of ADR-0010 (loopback `127.0.0.1:8766`), not a
    new path, with `GET`/`PUT /api/admin/moments`.
  - It writes `app/public/moments/moments.json` atomically under the
    existing mutation lock, origin check and size cap.
  - It validates the moments contract: ids, kinds, placements naming
    entries or null, coordinates, facing, and clip URLs only under
    `/moments/`.
  - It needs no rebuild.
  - It needs the live-pipeline security assertions extended, and ADR-0010
    amended to widen the writer's scope beyond curation.
  - The writer is loopback-only by design, so assigning stays a laptop task;
    her phone on the LAN can view but not save.
  - In review mode: tapping a placed moment offers swap or remove; tapping
    a building offers the catalog. The front faces the nearest street (from
    the tile's transportation lines) unless she turns it. That flow would
    be its own registered lifecycle.

Bundles:
- sketch world: 86.2 of 87 KiB (budget raised from 86);
- planted moments: 11.2 of 12 KiB (model 0.8, layer 3.3, tv-wall scene
  7.1 KiB);
- catalog page: 2.4 of 6 KiB;
- initial shell: +0.3 KiB, for the new lab route.
