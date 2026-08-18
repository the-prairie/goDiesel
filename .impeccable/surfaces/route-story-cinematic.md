# Luminous Cartography

## Scope

This brief documents Variant 4, Cinematic Cartography, in the route-story prototype lab.
It governs only `CinematicCartographyPrototype` and does not replace the production design contract in `app/DESIGN.md`.

## Visual thesis

The route story is a quiet, luminous encounter with recorded geography.
Source-backed terrain is the hero, the recorded trace is the connective thread, and story chapters reveal evidence without turning the page into a dashboard, ticket, or themed travel artifact.

## Palette and type

- Cloud white (`#fbfcf8`) carries the header and chapter timeline.
- Atmospheric blue (`#dcebf1`) protects editorial text over geography.
- Deep ink (`#132b42`) carries text and primary controls.
- Cobalt (`#3e78c8`) identifies recorded route structure.
- Pale cobalt (`#a9c9f1`) shows the unvisited trace.
- Coral (`#ef7d74`) identifies chapter progress and the current recorded point.
- Sun yellow (`#f4bb57`) is reserved for selection and focus.

Newsreader carries route titles, premises, and primary facts.
Figtree carries controls, labels, evidence, and navigation.
The owner's route title is preserved exactly and constrained through responsive measure rather than rewritten.

## Composition

Terrain fills the viewport beneath a compact white route-story header.
On desktop, a translucent atmospheric field occupies the left edge so the title reads directly over the world without a floating card.
The trace is framed primarily in the right two-thirds, keeping geography visible and preventing the line from crossing the title.
Facts sit as an unframed line beneath the premise.
The chapter sequence is an edge-to-edge translucent film index near the lower edge, with a coral progress rule and evidence-labelled stops.

On mobile, the atmosphere occupies the upper portion of the viewport, the route moves into the middle terrain field, and the chapter timeline becomes horizontally scrollable.
The active chapter scrolls toward center without page-level scroll snapping.
The lab switcher receives dedicated clearance and must not obscure route controls.

## Route treatment

Render only `prototypeTrace(route)` geometry.
The trace uses a restrained terrain shadow, a narrow cloud casing, a two-pixel cobalt recorded line, and a coral active segment.
Rounded caps and joins preserve continuity without turning the route into a logo.
The current position is a small sun-colored point inside a cloud ring.
Discontinuities remain visible and no plausible replacement geometry is invented.

## Motion

Terrain performs one 760ms arrival settle and then remains still.
Chapter changes animate only the route-progress stroke and timeline rule.
Replay activation reveals the full route, clears story chrome, and navigates after 620ms.
There is no infinite motion or page-level animation loop.
Reduced motion removes the delayed navigation and collapses transitions without hiding state.

## Provenance

Distance, climb, date, region, geometry, chapters, and Replay eligibility come from the route record.
Every chapter retains its governed Recorded or Track derived label.
Generated or editorial narrative remains visibly labelled.
Satellite terrain comes through the existing source-backed imagery path and is geographic context, not owner-authored media.

## Accessibility

Back and Replay remain at least 44px square.
Keyboard focus uses cloud and cobalt rings visible over both terrain and paper.
The trace has a route-specific image label, facts remain concise and source-backed, chapters use labelled navigation, and the selected chapter exposes `aria-current="step"`.
The title, facts, active chapter, and evidence label cannot be removed by truncation.

## Do not reintroduce

Do not add railway, excursion, ticket, transport, postcard, scrapbook, or destination-branding metaphors.
Do not add invented imagery, decorative trains, dashed ticket dividers, faux perforations, or travel-poster copy.
Do not place the title in a floating card or obscure the real map with generic illustration.
