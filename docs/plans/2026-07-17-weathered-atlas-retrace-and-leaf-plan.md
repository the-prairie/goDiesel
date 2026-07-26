---
title: "feat: Weathered Atlas next layers — kintsugi seams, time-of-day wash, retrace scrubber, Leaf spread"
type: feat
date: 2026-07-17
status: proposed
---

# Weathered Atlas — Next Layers Handoff

## Summary

The Weathered Atlas design system is live (see `app/DESIGN.md`). Tokens, the Spine
navigation, the Margin detail system, patina route traces, and the pigment palette all
shipped and are covered by passing typecheck, unit, and e2e suites.

Four progressive layers remain specified but not yet built into the live experience:

1. **True GPS kintsugi seams** — render real GPS gaps/pauses as gold repairs on every
   route trace (Atlas thread, Leaf briefing, Replay playback), with tap-to-annotate.
2. **Time-of-day wash on Retrace** — tint the replay stage to match the recorded time of
   day and drift the wash as playback advances.
3. **Elevation-as-scrubber dock** — replace the plain `<input type="range">` in the replay
   dock with the elevation profile itself as a single-stroke scrubber (playhead = vermilion
   brush tip; chapters = splits/waypoints/seams).
4. **The Leaf** — rebuild route detail (`route-detail-page.tsx`) into a true two-thirds
   geography / one-third Margin spread using the shared `Margin` primitives.

This document is written so another agent can pick up any one of these independently. They
are ordered by dependency: layer 1 (seams) produces the data structure that layers 3 and 4
consume, so **build seams first**.

## Ground Rules (do not violate)

From `app/DESIGN.md`:

- **Gold (`--gold-repair`) is for kintsugi seams only.** Never decorative.
- **Vermilion (`--coral`) is the singular "now" mark only** — playhead, current position,
  active waypoint. Never a route fill, never general action color.
- **Indigo (`--route`) is all route ink.** Moss (`--forest`) is all actions/playback controls.
- **Motion verbs only:** `settle` (250–400ms), `breathe` (600ms+), `draw` (direction-aware).
  No bounce/spring/idle-loop. Every animation needs a `prefers-reduced-motion` collapse.
- **Source truth:** never invent geometry or annotations. A seam is only rendered when the
  recorded data actually shows a gap/pause. If no timestamps exist, render no seam.
- **Contrast:** body text and controls meet WCAG AA. Focus rings visible over terrain.
- Ship through the existing `field-guide-theme` / `weathered-atlas` class. Do not add a
  global dark theme.

## Verification Commands

Run from `app/`:

```bash
npm run typecheck
npm run test:unit
npm run build
npx playwright test e2e/design-system-foundation.spec.ts e2e/navigation.spec.ts
```

Full gate (slow, includes bundle budget + all e2e): `npm run verify`.

---

## Layer 1 — True GPS Kintsugi Seams

### Concept

A seam is a stretch of route where the recorded track is untrustworthy: GPS signal was
lost (large jump between consecutive points), or the athlete paused (large time gap with
little movement). Instead of hiding or smoothing these, render them as thin **gold**
segments joining the indigo ink, slightly raised (1px lighter halo). Tapping a seam opens
a marginalia note.

### Data model — build this first

Create `app/src/domain/route-seams.ts` with a pure, tested function. `RoutePoint`
(`app/src/domain/routes.ts:9`) has `{ lat, lng, elev, d }` where `d` is cumulative distance
in metres. **Note:** the current `RoutePoint` has no timestamp field. Check the generated
route JSON (`app/src/data/generated/`) and the parser in `app/src/domain/routes.ts` to see
whether per-point time exists. Two cases:

- **If timestamps exist:** detect pauses (elapsed time high, distance delta near zero) and
  dropouts (distance delta between consecutive points far exceeds the median spacing).
- **If only distance exists (likely):** detect dropouts only — a segment where the straight
  distance between two consecutive recorded points is an outlier (e.g. > 6× median spacing
  or > 150m). Do not fabricate pause seams you cannot prove.

Suggested API:

```ts
export interface RouteSeam {
  kind: "dropout" | "pause";
  startIndex: number;   // index into route.route
  endIndex: number;
  startD: number;       // cumulative metres
  endD: number;
  lengthM: number;
  note: string;         // e.g. "Signal lost for 420 m — path estimated"
}

export function detectRouteSeams(points: RoutePoint[]): RouteSeam[];
```

Keep the note strings factual and source-backed. Follow the fade/wear precedent in
`app/src/domain/route-patina.ts` for style (pure functions, exported thresholds, colocated
`.test.ts`). Add `app/src/domain/route-seams.test.ts` with fixtures: a clean route (0 seams),
a route with one obvious dropout, and an edge case (seam at start/end).

### Rendering

The same seam list feeds three surfaces:

1. **Atlas globe** (`app/src/components/globe/atlas-globe.tsx`) — three.js. The heat-line
   builder is `makeGlobeHeatLine` (~line 120). Add a parallel gold `TubeGeometry` sub-line
   for seam sub-ranges using color `0xb98a2f`. This is the lowest priority render target
   (globe lines are already dense); acceptable to defer.
2. **Leaf briefing** (`app/src/components/routes/route-briefing.tsx`, `RouteTrace` ~line 83
   and `ElevationProfile` ~line 121) — SVG. Easiest, do this first. Over-draw the indigo
   `polyline` with short gold `<line>`/`<path>` segments for each seam range, plus an
   invisible ≥44px-wide transparent hit path per seam that opens a note.
3. **Replay** — MapLibre (`app/src/replay/atlas/maplibre-atlas-replay-engine.ts`) and Cesium
   (`app/src/replay/cesium/cesium-replay-engine.ts`).
   - MapLibre: in the `map.once("load")` block (~line 104), after adding
     `replay-route-thread`, add a `replay-route-seams` GeoJSON source containing only the
     seam sub-linestrings, and a line layer painted `#b98a2f`, width 4, with a lighter
     1px halo layer beneath. Build seam features by slicing `route.route` between
     `startIndex`/`endIndex`.
   - Cesium: add sibling polyline entities for seam ranges near the route entity
     (~line 268) using `Color.fromCssColorString("#b98a2f")`.

### Interaction (seam annotation)

- Tap/click a seam → open a note in the **Margin** (`app/src/components/margin.tsx`).
  Reuse `Margin` + `MarginNote` (Cormorant italic) rather than a modal.
- On Leaf, the seam note appears inline in the right Margin column (see Layer 4).
- On Replay, tapping a seam chapter on the scrubber (Layer 3) opens the note in a small
  fold anchored above the dock. Keep it dismissible and keyboard-reachable.
- Hit target ≥44px even though the seam stroke is ~2–4px (use an invisible wide overlay path
  in SVG; use `line-width` padding or a transparent wider layer in MapLibre).

### Reduced motion & a11y

- Seams are static; no motion needed. The gold must still meet 3:1 against paper/terrain —
  verify over both the light Leaf surface and dark replay terrain (the gold sits on the
  indigo/terrain, so contrast is against terrain; add the pale halo for separation).
- Each interactive seam is a real `<button>` with `aria-label` describing the seam note.

### Acceptance

- `detectRouteSeams` unit-tested, deterministic, returns `[]` when data can't prove a seam.
- Leaf and Replay show gold seams only where seams exist; a clean route shows none.
- Tapping a seam opens a factual marginalia note; Escape/tap-away closes it.
- No new neon; gold used nowhere else. Typecheck + unit + design-system e2e green.

---

## Layer 2 — Time-of-Day Wash on Retrace

### Concept

The replay stage light should match the hour the route was actually recorded, and drift as
playback moves through time. A dawn run replays under a cool early wash; a summer evening
under warm amber. This is a full-viewport tinted overlay, cheap, and degrades to nothing.

### Where

`app/src/components/replay/earth-replay-stage.tsx`. The stage `<section>` is at ~line 229;
the terrain container is the `absolute inset-0` div at ~line 244. Add a sibling overlay div
**above terrain, below HUD** (HUD is `z-20`, avatar is `z-10`; put the wash at `z-[5]` and
`pointer-events-none`).

### Data

Determine the recorded start hour from the route. Check `QuestRoute`
(`app/src/domain/routes.ts`) and generated data for a start timestamp. If per-point time
exists, derive local hour; if only `route.date` (a day, no time) exists, **do not fake an
hour** — either skip the wash or use a single neutral daytime wash. Progression through the
route's time-of-day can be approximated from `control.progressM / totalDistanceM` combined
with an assumed duration only if real duration data exists; otherwise keep the wash static
per session. Prefer honesty over a fabricated day-night cycle.

### Implementation

- Map hour → tint via a small pure helper, e.g. `app/src/replay/time-of-day-wash.ts`:
  `washForHour(hour: number): { color: string; opacity: number; blend: "multiply" | "soft-light" }`.
  Dawn/dusk = warm low-sun amber (`soft-light`), midday = near-transparent cool, night =
  deep indigo `multiply`. Keep opacity low (≤ 0.22) so terrain stays legible.
- Apply as inline style on the overlay div. Transition the wash with a long `breathe`-class
  ease when the hour bucket changes.
- The stage currently hard-codes `bg-[#02070a]` (line ~242). Leave terrain as-is; the wash
  sits on top.

### Reduced motion & a11y

- Under `prefers-reduced-motion`, apply the wash instantly (no drift animation). The
  `useReducedMotion` hook is already imported in the stage (`reducedMotion` variable).
- The wash must not drop text/control contrast below AA. The HUD panels have their own
  `bg-surface/90` backing, so verify the dock and context card remain readable at max wash
  opacity (test the night bucket specifically).

### Acceptance

- Wash reflects real recorded time or is neutral when time is unknown (never fabricated).
- HUD/dock remain AA-legible at peak wash. Reduced-motion disables drift.
- No change to canonical URLs, engine selection, or playback math.

---

## Layer 3 — Elevation-as-Scrubber Dock

### Concept

Replace the plain range slider in the replay dock with the route's **elevation profile
drawn as a single indigo stroke**; the vermilion brush-tip is the playhead; chapters
(splits, waypoints, seams) are small marks on the stroke. Dragging the tip seeks. This makes
the route itself the control surface.

### Where

`app/src/components/replay/earth-replay-stage.tsx`. There are **two** range inputs to
replace (mobile ~line 437, desktop ~line 544), both `aria-label="Route progress"`, both
calling `commitControl((c) => seekReplay(c, value, totalDistanceM))`. Keep that exact seek
contract.

### Build a reusable component

Create `app/src/components/replay/elevation-scrubber.tsx`:

```ts
interface ElevationScrubberProps {
  route: QuestRoute;
  progressM: number;
  totalDistanceM: number;
  seams?: RouteSeam[];          // from Layer 1; optional
  disabled?: boolean;
  onSeek: (progressM: number) => void;
}
```

Rendering:

- Reuse the elevation sampling already written: `sampleElevationProfile`, `elevationRange`
  from `app/src/domain/route-visualization.ts` (see `ElevationProfile` in
  `route-briefing.tsx:121` for the exact projection math — copy its `left/right/top/bottom`
  approach). Draw the profile `polyline` in `--route`.
- Draw the traveled portion (0 → progressM) in full-strength indigo using the `draw` verb
  (`stroke-dashoffset`), and the untraveled remainder faded. This IS the re-inking metaphor.
- Playhead: a vermilion (`--coral`) dot with white ring at the x corresponding to
  `progressM / totalDistanceM`, sized ≥ its own hit area; mobile tip target ≥ 48px, desktop
  ≥ 44px (wrap the SVG in a full-height range affordance).
- Chapter marks: small ticks for seams (gold) and any splits/waypoints (indigo). Seam ticks
  are tappable → open seam note (Layer 1 interaction).

Interaction:

- Pointer/drag along the stroke maps x → `progressM` and calls `onSeek`. Support keyboard:
  the component must remain operable via arrow keys (Left/Right = seek by step, Home/End =
  start/finish). Simplest robust approach: keep a visually-hidden native
  `<input type="range">` layered over the SVG for keyboard + AT, and paint the SVG on top
  (`pointer-events` routed so drag still works). This preserves the existing
  `aria-label="Route progress"` semantics and screen-reader behavior the e2e relies on.
- Do **not** change `seekReplay` or the rAF loop (`earth-replay-stage.tsx:185`).

### The "erase → re-ink" ritual (progressive enhancement)

When a route first becomes `operational` (status ready) and playback starts from 0, the
traveled-portion stroke draws in from the start (direction-aware `draw`). This is the
scrubber-side expression of retrace. The terrain-side erase/re-ink (fading the map route to
pencil then re-inking) is a larger MapLibre/Cesium change — **out of scope for this layer**;
note it as a follow-up. The scrubber ritual alone delivers most of the feel cheaply.

### Reduced motion & a11y

- `reducedMotion` (already in stage) → no draw animation; traveled portion just renders at
  the correct length instantly.
- Preserve `data-testid="replay-controls"` on the dock container and keep an element with
  `aria-label="Route progress"` that reflects `progressM` so existing/replay e2e keep
  working. Check `app/e2e/` for replay specs before changing DOM hooks.

### Acceptance

- Both mobile and desktop docks use `ElevationScrubber`; the plain range is gone visually
  but keyboard/AT seek still works via the hidden input.
- Playhead is vermilion; profile is indigo; seam ticks gold. Traveled portion re-inks.
- Seeking still drives `seekReplay` with identical bounds. Typecheck + unit + e2e green.

---

## Layer 4 — The Leaf (route detail two-thirds / one-third spread)

### Concept

Rebuild `app/src/pages/route-detail-page.tsx` from the current stacked
`PageTitle → metrics card → RouteBriefing → RouteGuide` into a true spread:

- **Left two-thirds:** real geography (the recorded-path figure), permanent.
- **Right one-third:** the route's accumulated **marginalia** — title (Cormorant), premise,
  tabular metrics, elevation stroke, kintsugi seam notes, a "traveled" ledger, and the
  Open Replay action.

### Constraints

- Use the shared `Margin` primitives (`app/src/components/margin.tsx`): `Margin`,
  `MarginSection`, `MarginEyebrow`, `MarginNote`, `MarginLedger`. Do not invent a new panel.
- Geography stays primary; the Margin never exceeds one-third (`--margin-width` = 20rem).
- No cards inside cards. The current metrics `<dl>` is a bordered card — in the Leaf it
  becomes a `MarginLedger` (already built for exactly this).
- Keep all existing behavior: back link to `routeLibraryReturnPath`, the loading/error/
  not-found states in `RouteDetailContent`, the replay-eligible gating, and `RouteGuide`.
- Source imagery, if it exists, appears as a small tipped-in photo (slightly rotated, paper
  border) — never a hero banner. When none exists, geography stays primary (existing rule).

### Suggested layout

```tsx
<section className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
  <div className="min-w-0"> {/* geography: RouteBriefing's RouteTrace, enlarged */} </div>
  <Margin presentation="column" aria-label={`${route.name} details`}>
    <MarginSection> title + premise (Cormorant) </MarginSection>
    <MarginSection> <MarginLedger items={[distance, climb, activity, date]} /> </MarginSection>
    <MarginSection> elevation stroke (reuse ElevationProfile or ElevationScrubber static) </MarginSection>
    <MarginSection> seam notes (Layer 1) </MarginSection>
    <MarginSection> Open replay action </MarginSection>
  </Margin>
</section>
```

On mobile (`< lg`), collapse to a single column: geography first, Margin content below in
document order (not a fold here — this is a content page, not a map surface). Preserve
bottom-spine clearance (the shell already applies `pb-[var(--mobile-navigation-height)]`).

### Refactor notes

- `RouteBriefing` currently renders both the path and elevation in a two-figure grid with
  `--primary`/`#f5c451` colors. For the Leaf, either (a) split `RouteTrace` and
  `ElevationProfile` out of `route-briefing.tsx` into small exported components and reuse
  them, or (b) keep `RouteBriefing` for the geography column and move elevation into the
  Margin. Prefer (a); update the `#f5c451` finish marker to a pigment token
  (`--gold-repair` is reserved for seams — use `--forest` or a neutral finish dot, not gold).
- Update `PageTitle` usage: the Leaf title belongs in the Margin (Cormorant), so the page
  likely drops the top `PageTitle` in favor of the Margin heading. Keep an `<h1>` somewhere
  for document structure and any e2e that asserts the route name heading (grep
  `app/e2e/navigation.spec.ts` — it asserts `heading { name: "Kyoto, Japan" }` on **replay**,
  not detail, but verify route-detail specs before removing headings).

### Acceptance

- Route detail renders as a 2/1 spread on desktop, single column on mobile, geography
  primary in both.
- All prior states (loading, error+retry, not-found, replay-unavailable) preserved.
- Uses shared `Margin` primitives; no nested cards; no gold outside seams.
- Typecheck + unit + e2e green.

## Suggested Sequencing

1. **Layer 1 seams** (domain + Leaf SVG + MapLibre) — unblocks 3 and 4.
2. **Layer 3 scrubber** — consumes seams as chapters.
3. **Layer 4 Leaf** — consumes seams + reuses elevation stroke.
4. **Layer 2 wash** — independent, can slot anywhere; do last as polish.

Each layer is independently shippable and independently testable. Do not batch them into one
commit — one PR per layer keeps review and the migration rule (`app/DESIGN.md`) honest.

## Files Touched (reference map)

- `app/src/domain/route-patina.ts` — precedent for pure style helpers (already shipped).
- `app/src/domain/route-visualization.ts` — `sampleElevationProfile`, `elevationRange`.
- `app/src/domain/routes.ts` — `RoutePoint`, `QuestRoute` shapes; check for timestamps.
- `app/src/replay/route-path.ts` — `routePathPose`, `routeDistanceM`, `bearingDegrees`.
- `app/src/replay/replay-controller.ts` — `seekReplay` (do not change contract).
- `app/src/components/replay/earth-replay-stage.tsx` — dock inputs, HUD, wash overlay host.
- `app/src/replay/atlas/maplibre-atlas-replay-engine.ts` — seam line layer.
- `app/src/replay/cesium/cesium-replay-engine.ts` — seam polyline entities.
- `app/src/components/routes/route-briefing.tsx` — Leaf geography + elevation source.
- `app/src/pages/route-detail-page.tsx` — Leaf spread.
- `app/src/components/margin.tsx` — shared Margin primitives (already shipped).
