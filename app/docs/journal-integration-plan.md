# Journal presentation: production-integration plan

Scope of this document: what is lab-only today, what already ships, and the
sequence by which the accepted journal presentation becomes the normal
experience without exposing the review-only `?theme` and `?type` parameters.

It is an integration plan, not a cleanup plan. Pre-existing debt encountered
along the way is named in "Deliberately out of scope" and left alone.

Version this plan describes: working tree on `clank/fable-opus-migration-70932f`
at `6b23f859` plus the uncommitted changes inventoried below.

---

## 1. Lab-only today

Nothing here is reachable except under `/lab/design-seeds/*`.

| | Lines | Notes |
|---|---|---|
| `src/labs/design-seeds/` | 4,271 | 14 modules: the three seed concepts, the journal Atlas and day, cartography, terrain, elevation, geometry, content rules, tokens, return context |
| `scripts/verify-journal-{return,replay,mobile}.mjs` | 604 | Behavioural verification, currently pointed at lab URLs |
| `scripts/measure-journal-paint.mjs` | 138 | Paint-order gate |
| `scripts/audit-journal-controls.mjs` | 69 | Control-size audit |

Of the lab modules, these carry the accepted design and are what integration
moves into production:

- `concept-b.tsx` — the journal Atlas, both compositions
- `concept-b-story.tsx` — the day, both compositions
- `concept-b-tokens.ts` — the warm palette and cartography values
- `seed-cartography.ts` — the journal basemap treatment
- `seed-terrain.tsx` — the map component, including the route-first paint order
- `seed-elevation.tsx` — the linked climb and its inspection
- `seed-geometry.ts` — one distance → position + altitude lookup
- `seed-content.ts` — the title, attribution, effort and evidence rules
- `seed-return-context.ts` — the scoped reading-position store
- `seed-profile.tsx` — route miniatures

`concept-a.tsx`, `concept-c.tsx` and `seed-manifest.ts` are the discarded
directions and the exploration record. They are deleted at step 6, not moved.

## 2. Already in production

Sixteen files, +590/-31. Everything except the first row is inert until
`?theme=journal` is present.

| File | Effect today |
|---|---|
| `surfaces/replay/components/route-context-hud.tsx` | **Live behaviour change.** Replay headlines the day's own name; place and date move to a second line. Applies to every Replay surface, including the playable-earth lab. |
| `domain/geometry/route-thread-style.ts` | Adds `JOURNAL_REPLAY_THREAD_STYLE`. `ROUTE_THREAD_STYLE` unchanged, so no surface changes colour. |
| `surfaces/replay/renderer-port.ts`, `renderers/maplibre-replay-engine.ts`, `components/earth-replay-stage.tsx` | Optional `threadStyle` mount option, defaulting to the shared constant. No change without a caller. |
| `surfaces/replay/replay-page.tsx` | Reads `?theme=journal`; the only production read of that parameter. Absent, nothing changes. |
| `index.css` | +329 lines, purely additive (no deletions). `.seed-*` selectors match nothing outside the lab. |
| `app/app-shell.tsx` | Suppresses legacy chrome for `/lab/design-seeds/*` only. |
| `app/route-paths.ts` | New lab-path helpers; `replayReturnPath` gains one allowlisted lab branch. |
| `app/router.tsx` | Two lazy lab routes. |
| `e2e/{earth-replay,playable-earth-lab,route-loading}.spec.ts` | Updated to assert the corrected Replay headline plus its secondary line. |
| `package.json` | `@fontsource-variable/source-serif-4`; five verification scripts. |
| `DESIGN.md` | Documents the accepted rules. |

**Cost already carried in the production bundle**

- Initial shell JS: **230.4 KiB, unchanged** from `88a49b9a` (measured against a
  clean build of that commit: 234.9 KiB entry, same as now).
- Stylesheet: 3.6 KiB of `.seed-*` rules and 1.9 KiB of Source Serif
  `@font-face` inside 118.8 KiB.
- Build output: 177 KiB of Source Serif woff2 across six subsets. The browser
  fetches a subset only where the family is used, so today that is lab pages
  only — but the files ship.

**Constraint discovered here, worth keeping**: importing `formatRouteDate` into
`route-context-hud.tsx` — from the `@/domain/route` barrel or from its own
module — puts that file into the entry's chunk group and takes lucide-react with
it (235.9 → 336.9 KiB, per-icon chunks dissolved). The date is formatted in
place for that reason. Expect the same trap when moving other lab modules into
production surfaces.

## 3. Making the presentation normal

The review parameters are **deleted, not defaulted**. A default leaves the other
values reachable; deletion is what "one product, one presentation" means.

Two parameters and one function to remove:

- `?theme=journal|expedition` — read in `replay-page.tsx` and the lab page
- `?type=cormorant|source-serif|role` — read in the lab page only
- `resolveSeedTheme` / `resolveSeedTypeface` and the `SEED_THEMES` /
  `SEED_TYPEFACES` tables

### Sequence

Each step is independently reviewable and leaves the product working.

**Step 1 — promote the tokens.** Move the journal palette and cartography from
`.seed-theme-journal` and `.seed-type-role` into the product's own theme
declaration. Keep `--font-prose`; keep `.seed-control` (rename). Delete
`.seed-theme-expedition`, `.seed-type-cormorant`, `.seed-type-source-serif` and
both resolver functions. Must be first: everything after it reads these tokens.

**Step 2 — the day.** `surfaces/routes/components/route-story-view.tsx` adopts
the two compositions, the caption threshold, the attribution rule, the in-flow
mobile action and the geography-plus-climb inspection unit. Independent of the
Atlas. Note that `routeStoryTitle` currently falls back to the region for a
title with no alphanumerics, which erases the emoji titles; the journal's rule
(`activityName || subtitle || name`) replaces it, and `route-story.test.ts:104`
asserts the old behaviour and will need the same honest update the Replay
headline tests got.

**Step 3 — the Atlas region view.** Adopts the journal list, the plate and both
compositions. **Gated** on the findability item below.

**Step 4 — Replay.** Remove the `?theme=journal` read; make the journal
presentation and `JOURNAL_REPLAY_THREAD_STYLE` unconditional for Replay, and
fold `.seed-replay-warm` into the Replay surface's own tokens. `ROUTE_THREAD_STYLE`
stays the default for the Atlas regional fallback, the Cesium engine and the
playable-earth lab unless separately decided.

**Step 5 — the return context.** Move `seed-return-context.ts` to `src/app/`
beside `navigation-continuity.ts`. One decision is genuinely open: whether the
journal store stays a second mechanism for the Atlas list, or
`useNavigationScrollRegion` gains a "restore on forward links too" mode and the
store is retired. Both are defensible; the store exists because the app
convention deliberately restores only on POP.

**Step 6 — delete the lab.** `src/labs/design-seeds/`, the two router entries,
`isDesignSeedLab` in `app-shell.tsx`, `DESIGN_SEED_PATH` and its helpers, the
lab branch in `replayReturnPath`, and the three lab cases in
`route-paths.test.ts`. Repoint the five verification scripts at production URLs.
Must be last.

## 4. Deliberately out of scope

Encountered, deliberately untouched:

- `:root` / `.field-guide-theme` declare the same shadcn aliases twice, which is
  why `.seed-replay-warm` has to restate them. A real cleanup, unrelated to
  this design.
- The shared `isImmersive` rule in `app-shell.tsx` applies
  `min-h-0 overflow-hidden` to every immersive surface. It clips page scroll and
  breaks `position: sticky`; the journal works within it rather than changing a
  rule that Atlas, Replay and route detail also depend on.
- Cesium's `ne2_shaded` relief source has `maxzoom: 6`, so there is no hillshade
  at region zoom on the Atlas globe.
- No broad token migration. 90 hardcoded hex literals remain across the product.

## 5. Gates before step 3

**Findability.** The journal Atlas has no search and no activity filter.
Production has "Search this place" and All / Runs / Rides. At 68 routes across
30 places, replacing the production Atlas without them is a capability
regression. This needs a design decision before step 3, not during it.

**Per-chapter evidence labels.** Production distinguishes recorded from derived
values per chapter. The journal demotes evidence to one quiet footnote. The
chapter-level distinction still needs a home.

## 6. Remaining verification

Three items. The first is a defect found while producing the evidence for this
plan; the other two are capability gaps.

**Touch scrolling over a map — actionable, measured.** `SeedTerrain` leaves
MapLibre's `dragPan`, `scrollZoom` and `touchZoomRotate` at their defaults, so a
gesture that begins on the map pans the map and the page does not move. Measured
at 390×844 with touch emulation:

| Surface | Map share of screen | Flick starting on the map | Same flick on the prose |
|---|---|---|---|
| Day (Kyoto) | 355 px of 844 (42%) | **0 px** | 658 px |
| Atlas | 226 px of 844 (27%) | **0 px** | 681 px |

The elevation strip already handles this correctly: `touch-action: pan-y` lets a
vertical drag scroll the page (199 px) without starting a scrub. The maps do
not. MapLibre's `cooperativeGestures`, or disabling `dragPan`/`scrollZoom` below
the layout threshold, would make them behave like the strip. Not changed here —
it alters gesture behaviour on an accepted composition.

**Real-device scrolling and touch inspection — unverified.** All touch evidence
is Chromium emulation, including the table above. Momentum scrolling, rubber
banding, and whether a scrub on the elevation strip feels precise under a thumb
are unknown until exercised on hardware.

**Live Google photorealistic imagery — unverified, blocked.** No browser API
key, so `VITE_GOOGLE_MAPS_API_KEY` is absent and Replay enters on MapLibre.
`test:e2e:earth` fails 4/4 in `earth-replay-live.spec.ts`, all four because the
stage never reaches `ready` within 60 s. This is a provider-credential gap and
is kept separate from the MapLibre evidence, which is verified end to end.

**Verified since the last report:** the complete Kyoto photo entry. Title, note,
byline, photograph, caption, all five metrics and the footnote each fully
on-screen and uncovered during an ordinary read to the bottom of the entry
(1,116 of 1,960 px), then back up.

## 7. Checks that must keep passing

Each needs a running dev or preview server and network access for the basemap.

| Command | Covers |
|---|---|
| `npm run perf:journal-paint` | Ground, route and basemap-tile paint order; route before tiles |
| `npm run verify:journal-return` | Visible return link, Back/Forward, Replay round trip, direct open, journey scoping, and the same journey at 390×844 |
| `npm run verify:journal-replay` | Playback advancing, pause, the journal thread on a dark surface, the personal headline, return through visible links |
| `npm run verify:journal-mobile` | The five real content shapes at 390×844 |
| `npm run audit:journal-controls` | The agreed 44 px / 48 px control sizes |

Plus the standard suite: `typecheck`, `test:unit` (293), `build`,
`test:bundle` (230.4 KiB), `test:e2e:extended` (177 passed, 2 skipped).
