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

**S17. The join: one continuous world.** Decided and recorded. Not built
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
