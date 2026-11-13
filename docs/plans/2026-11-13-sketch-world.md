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
