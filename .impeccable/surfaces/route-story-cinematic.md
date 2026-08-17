# Daylight Excursion Atlas

## Scope and authority

This brief documents the shipped visual system for **Variant 4: Cinematic Cartography** in the route-story prototype lab.
It is implementation guidance for `CinematicCartographyPrototype` only.
It does not replace `app/DESIGN.md`, authorize a production route-page migration, or make the Daylight Atlas the product-wide visual authority.

The verified desktop and mobile screenshots are the rendered reference.
The decision comp supplies visual intent, but its composition and sample annotations are not data or production requirements.

## Visual thesis

Daylight Excursion Atlas is a bright, legible route story laid directly over source-backed terrain.
The route is the dominant material: a broad, tactile line that connects the editorial premise, current chapter, and Replay transition without separating story from geography.

## Palette

- **Cloud** (`#f8fbff`): paper panels, route casing, and light foreground separation.
- **Sky** (`#dfeafa`): shell background and quiet grouped surfaces.
- **Ink** (`#172951`): primary text, outlines, controls, and structural contrast.
- **Muted blue** (`#5c6c8f`): secondary labels and inactive chapter content.
- **Route blue** (`#6988e6`): the recorded trace and chapter continuity.
- **Apricot** (`#ef8d70`): travelled progress and visited chapter state.
- **Butter** (`#ffd45f`): current location, selected chapter, selection, and keyboard focus.
- **Berry** (`#a8395e`): provenance labels, kicker text, and small editorial accents.

Keep terrain brightened and slightly desaturated (`saturate(.78) contrast(.94) brightness(1.22)`) under a pale blue wash.
Accent colors carry distinct state or evidence roles; they are not general decoration.

## Typography

- **Newsreader Variable** is the editorial face for the route title, premise, journey count, and Replay reveal.
- **Figtree Variable** is the interface face for navigation, metrics, chapter controls, evidence labels, and status text.
- The title is medium-weight, tightly led, and balanced: `41-60px` on desktop and `31-38px` on mobile, with `0` letter spacing and about `.95` line-height.
- Interface labels are compact, bold, and uppercase only when they identify evidence or category.
- Preserve the owner's route title casing and wording. Do not rewrite it to fit the layout; constrain it through width and responsive size.

## Layout

The lab is a fixed, full-height atlas with hidden overflow, not a scrolling article.
Its `64px` desktop header holds Back, centered identity, and Replay; mobile reduces the header to `56px`, hides the edition label and Replay text, and keeps both actions at least `44px` square.

On desktop, terrain fills the stage, the story panel anchors to the upper left, the route occupies the full map plane, the current-chapter marker sits over the route, and the ticket-like journey strip spans the lower edge.
The story panel is capped at `min(680px, 55vw)` so geography remains visible.

At `760px` and below:

- The story panel becomes a compact inset sheet (`12px` side insets).
- The trace is reframed to the middle `58%` of the stage and receives a heavier casing for legibility.
- The separate position callout disappears because the selected stop carries the same state.
- Chapters become a horizontally scrollable row of stable `188px` stops and the active stop scrolls toward center.
- The generated premise clamps to one line; factual metrics remain visible.

At short desktop heights (`780px` and below), tighten vertical spacing and clamp the premise to two lines before reducing geographic presence.

## Route material

Render only `prototypeTrace(route)` geometry.
The desktop trace is four terrain-seated layers: `21px` ink shadow, `17px` cloud casing, `8px` route-blue recorded line, and `9px` apricot progress line.
On mobile, use `24px`, `20px`, and `10px` for the corresponding shadow, casing, and route/progress strokes.
All strokes use rounded caps and joins.

The current point is a butter center with an ink outline inside a cloud halo.
Chapter selection advances progress to the chapter's measured distance and selects the nearest recorded trace point.
Do not add decorative waypoints, substitute plausible geometry, or recolor activity types.

## Motion

- Arrival begins after `80ms`; terrain settles from a slight scale/vertical offset over `620-760ms`.
- Chapter progress eases over `620ms` using `cubic-bezier(.16, 1, .3, 1)`.
- Replay activation reveals the full route, fades story chrome, displays the terrain-opening message, then navigates after `680ms`.
- Hover and focus feedback stays within `150-160ms`; state should feel immediate even when cinematic transitions are active.
- Modified clicks and non-primary clicks retain normal link behavior.
- Under `prefers-reduced-motion`, arrival is immediate, chapter scrolling is not smooth, the Replay delay is skipped, and transitions collapse to effectively zero without hiding content or state.

## Provenance rules

- Recorded geometry, distance, climb, date, region, and Replay eligibility come from the route record.
- Every chapter retains its explicit `RECORDED`, `TRACK DERIVED`, or other governed evidence label.
- Generated narrative remains visibly labelled, including the route premise; it must not read as an owner-authored memory.
- Terrain imagery must come through the existing source-backed satellite thumbnail/provider path. It is geographic context, not proof that the owner photographed or experienced every visible feature.
- Missing or invalid trace geometry stays missing. Never invent a visually convenient route.
- The comp's place, trace, copy, train illustration, and annotations are illustrative only.

## Accessibility constraints

- Back and Replay controls remain at least `44px` square with explicit accessible names.
- Keyboard focus uses the two-stage butter and ink ring and must remain visible over both paper and terrain.
- The trace exposes a route-specific image label; decorative terrain and icons remain hidden from assistive technology.
- The story uses one `h1`, metrics use a description list, chapters use a labelled `nav`, and the selected chapter exposes `aria-current="step"`.
- Chapter position and Replay reveal changes remain announced through polite live regions.
- Text and controls must retain WCAG AA contrast after imagery or provider changes. Pale translucent panels cannot depend on a particular satellite tile for legibility.
- Truncation may protect compact controls, but it must not remove the route title, factual metrics, active chapter identity, or evidence label.

## Do not reintroduce

Do not pull the old field-guide system back into this lab through dark mineral surfaces, Cormorant-led typography, a permanent sidebar or rail, a scrolling chapter article, narrow baseline route strokes, coral-as-global-action styling, or nested card stacks.
Do not add ornamental paper textures, faux archival labels, scenic-photo hero treatment, decorative preview grids, or generic floating introduction copy.
Daylight Atlas must remain a bright, map-first cinematic lab until a separate migration decision establishes production authority.
