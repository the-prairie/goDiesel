# Direction D handoff — "the carried notebook"

For whoever picks this up next. Everything below was run in this worktree; where
something is a claim rather than an observation it says so.

---

## 1. Where the work is

| | |
|---|---|
| Worktree | `/Users/laurenzary/Desktop/goDiesel/.claude/worktrees/fable-opus-migration-70932f` |
| Branch | `clank/fable-opus-migration-70932f` |
| Checkpoint | `2abe97dd` `feat(labs): journal presentation baseline and Direction D checkpoint` |
| Parent | `6b23f859` `test(navigation): refresh field-guide shell baselines for 68 routes` |
| Merge base with `main` | `30e60425` |
| Toolchain used | Node v26.7.0, npm 11.19.0 |

Nothing has been pushed, merged or deployed. `6b23f859` is itself local.

Untracked and **deliberately not committed**: `.serena/` at the repo root. It is
a Serena MCP tool artifact belonging to someone else's tooling, not to this
work. It has been left in place, not deleted, and is not in `.gitignore`.

Install and run:

```bash
cd app && npm install && npm run dev
```

`npm run dev` serves on **port 8787**. Every verification script below defaults
to `http://localhost:8787` and takes a `BASE` override.

## 2. Launching both directions

Two directions live side by side in one lab. The accepted baseline is B; the
ambitious exploration is D. Neither is reachable from production navigation —
only by URL.

**Direction D (the exploration)**

```
http://localhost:8787/#/lab/design-seeds/d/atlas?region=Crete%2C%20Greece&route=14130782031
http://localhost:8787/#/lab/design-seeds/d/story/15573295095?region=Banff%2FKananaskis
http://localhost:8787/#/lab/design-seeds/d/story/17654151284?region=Kyoto%2C%20Japan
```

`15573295095` is Banff — **no photographs**, the primary case. `17654151284` is
Kyoto — the only day in the collection with real photographs.

Optional `&at=<metres>` on a D day URL opens with the thread already held at
that distance along the recorded route.

**Direction B (the accepted baseline)**

```
http://localhost:8787/#/lab/design-seeds/b/atlas?region=Crete%2C%20Greece&route=14130782031&theme=journal
http://localhost:8787/#/lab/design-seeds/b/story/15573295095?region=Banff%2FKananaskis&theme=journal
```

B's review-only parameters, which exist for comparison and must not become
product settings: `?theme=journal|expedition`, `?type=cormorant|source-serif`
(default is the accepted role split). See
[`journal-integration-plan.md`](./journal-integration-plan.md) for how those get
deleted rather than defaulted when B is integrated.

**Observed:** the six B surfaces were re-captured at this checkpoint and
pixel-diffed against captures taken before D existed — **0 differing pixels**.
D does not alter B.

## 3. Files and renderer boundaries

### Direction D
| File | Lines | Role |
|---|---|---|
| `src/labs/design-seeds/concept-d.tsx` | 357 | The region: one landform carrying every recorded day, notebook leaf beside it |
| `src/labs/design-seeds/concept-d-story.tsx` | 407 | The day: leaf over the geography, the entry action, the descent trigger |
| `src/labs/design-seeds/seed-relief-map.tsx` | 676 | **The renderer.** MapLibre + terrain + the thread overlay |
| `src/labs/design-seeds/seed-relief.ts` | 281 | DEM source, hillshade, sky, cartography restyle, palette |
| `src/labs/design-seeds/seed-ribbon.tsx` | 249 | The climb as the second grip on the same thread |

### Shared with Direction B (do not fork casually)
`seed-content.ts` (title, attribution, effort and evidence rules),
`seed-geometry.ts` (the single distance → position + altitude lookup),
`seed-profile.tsx` (route miniatures), `seed-return-context.ts` (scoped reading
position), `seed-media.ts` (`useWideLayout`), `concept-b-tokens.ts` (the warm
palette D reuses unchanged).

### Renderer boundaries — the important part

- **`seed-terrain.tsx` is B's renderer. `seed-relief-map.tsx` is D's.** They are
  separate files on purpose. B is flat, keeps MapLibre's own pan/zoom gestures,
  and is pixel-frozen by B's checks; D is pitched, disables those gestures
  because the drag belongs to the recorded line, and adds terrain. Changing one
  must not touch the other.
- **The thread is DOM over the canvas, not MapLibre markers.** That is what lets
  the handle be a real focusable `role="slider"` with a 48px target and each
  photograph a real button. Screen positions are recomputed on every `move` and
  `render`; **every setter compares before it sets**. Handing React a fresh
  array on each render event is an update loop — it produced 2,150 "maximum
  update depth exceeded" errors on the region, where there is no handle at all
  and the empty array was newly allocated every frame.
- **Nothing may drape on terrain before the route has painted.** `setTerrain` is
  applied on the first `idle`, and the `styledata` handler that reapplies it is
  bound only after that. Binding it early is why the first attempt at this
  changed nothing.
- **`window.__reliefMap`** is set by `seed-relief-map.tsx` as a lab probe so
  capture scripts can read the live camera. It is a global; remove it if D is
  ever promoted.
- **Replay is the real product surface**, entered by URL. D touches it through
  two optional, defaulted props only: `threadStyle` (the journal thread) and
  `initialProgressM` (begin at the held distance). Omit either and Replay
  behaves exactly as before.

### Production files this checkpoint changes
Small and mostly seams. `surfaces/replay/components/route-context-hud.tsx` is
the only live behaviour change: Replay headlines the day's own name instead of
the generated region label, which affects every Replay surface. Then
`renderer-port.ts`, `renderers/maplibre-replay-engine.ts`,
`components/earth-replay-stage.tsx`, `replay-page.tsx` (optional props),
`domain/geometry/route-thread-style.ts` (a named variant; the shared default is
untouched), `app/app-shell.tsx`, `app/route-paths.ts`, `app/router.tsx` (lab
gating), `index.css` (additive only — no deletions), and three e2e specs updated
to assert the corrected Replay headline.

**Do not** import `formatRouteDate` into `route-context-hud.tsx`. From the
`@/domain/route` barrel *or* from its own module it puts that file into the
entry's chunk group and takes lucide-react with it: initial shell 235.9 → 336.9
KiB, per-icon chunks dissolved. The date is formatted in place for that reason.

## 4. External data and attribution

- **Vector basemap:** openfreemap Liberty, `https://tiles.openfreemap.org/styles/liberty`. No key.
- **Elevation:** Mapzen Terrain Tiles, terrarium-encoded, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, z≤15, public domain via the AWS Open Data registry. No key. **Credited in the attribution control** — keep it there.

Both are network dependencies. D will not render terrain offline.

## 5. Environment variables

Names only; no values are in this repo. `.env` and `.env.*` are gitignored, and
`.env.example` documents the shape.

| Name | Effect if absent |
|---|---|
| `GOOGLE_MAPS_API_KEY` or `VITE_GOOGLE_MAPS_API_KEY` | Replay falls back to the MapLibre "atlas" engine. Everything verified here was verified on that fallback. Must be an origin-restricted browser key. |
| `GODIESEL_LIVE_EARTH_E2E=1` | `npm run test:e2e:earth` skips or fails; it exercises live Google photorealistic tiles. |
| `BASE` | Verification scripts target `http://localhost:8787`. |
| `OUT` | `verify:journal-replay` writes screenshots to `test-results/journal-replay`. |

## 6. Test and verification commands

Standard suite — no server needed, `test:e2e:*` starts its own:

```bash
cd app
npm run typecheck
npm run test:unit
npm run build
npm run test:bundle
npm run test:e2e:core
npm run test:e2e:extended
```

Journal and Direction D checks — **need `npm run dev` running plus network
access** for the basemap and DEM:

```bash
npm run verify:direction-d      # D: the thread, and the whole journey
npm run verify:journal-return   # B: visible return link, Back/Forward, scoping
npm run verify:journal-replay   # B: playback, pause, thread identity, headline
npm run verify:journal-mobile   # B: five content shapes at 390x844
npm run audit:journal-controls  # B: the agreed 44px / 48px control sizes
npm run perf:journal-paint      # B: ground / route / basemap-tile paint order
```

## 7. Observed at this checkpoint

Everything in this section was run and its output read.

**Standard suite**

| Check | Result |
|---|---|
| `typecheck` | pass |
| `test:unit` | 48 files, **293 tests pass** |
| `build` | pass |
| `test:bundle` | initial shell **230.4 KiB**, unchanged from `88a49b9a` (measured against a clean build of that commit: 234.9 KiB entry) |
| `test:e2e:core` | **105 passed, 0 failed** |
| `test:e2e:extended` | **177 passed, 2 skipped, 0 failed** (run earlier this session, before D existed) |

**`verify:direction-d` — 20 checks, all passing**

- Photographs pinned on the map and on the climb, 2 each on Kyoto
- Dragging the climb reports `14.9 kilometres, 112 metres altitude`
- Map handle and climb are one value — byte-identical `aria-valuetext`
- Holding at a photograph raises it: caption `Stone stairway · taken 7.6 km in`
- Arrow keys move the handle: `7572 → 10124`
- The thread held at `12.1 kilometres, 2177 metres altitude`; the action reads `Enter at 12.1 km`
- The camera descends: pitch `54 → 70`
- Replay reached carrying `at=12102`; playback begins at **12.58 / 22.0 km**, not at the start
- The visible link returns to the day with the thread at `12.1 kilometres, 2177 metres altitude`, then back to the region
- 0 page errors in both passes

**Accessibility and performance on D's surfaces**

- **0 contrast failures** across 7 states (WCAG 2.2 AA thresholds, computed from live styles)
- **0 controls under the agreed sizes** (44px, 48px mobile) across 9 states. The photograph pips were 44×44 and failed the mobile minimum until fixed.
- Route-first paint order holds: cold day ground **974 ms** → route **1486 ms** → basemap tiles **5277 ms**
- No horizontal overflow at 390×844 on any D surface

**Baseline integrity**

- Six Direction B surfaces re-captured and pixel-diffed: **0 differing pixels**

## 8. Claims still requiring verification

Stated separately because none of these has been exercised.

1. **Real-device touch.** Every touch measurement in this work is Chromium
   emulation. The thread drag uses pointer capture with `touch-action: none`;
   whether it is precise under a thumb, and how it interacts with iOS momentum
   and rubber-banding, is unknown.
2. **Live Google photorealistic imagery.** No browser key here, so Replay always
   entered on the MapLibre engine. `test:e2e:earth` fails 4/4 in
   `earth-replay-live.spec.ts`, all four because the stage never reaches `ready`
   within 60 s. Whether the descent hands over convincingly to Google 3D tiles
   is untested.
3. **The DEM under load.** Terrain was exercised on one machine with a warm
   network. Tile volume, cost of `exaggeration: 1.35` on low-end hardware, and
   behaviour on a throttled connection are unmeasured. 21 DEM tiles were
   observed for one Banff framing.
4. **Regions other than Crete, Banff and Kyoto.** The collection has 30 places.
   D was rendered in three. Framing padding is hand-tuned per composition and
   may not suit a region whose routes are far apart.
5. **`test:e2e:extended` since D landed.** The 177-passing run predates
   Direction D's files. D adds no e2e specs, and `typecheck`, `test:unit`,
   `test:bundle` and `test:e2e:core` were all re-run after — but the extended
   suite has not been.
6. **Reduced motion.** The camera flight, the descent and the leaf transitions
   check `prefers-reduced-motion` and skip; that path is coded but was not
   exercised in a reduced-motion context.

## 9. Known limitations and open decisions

- **The region is pitched only 26°.** At 40° the far end of Crete foreshortened
  until the days recorded there were unreadable, and the collection is that
  view's whole point. Deliberate, and a legibility/drama trade-off worth
  revisiting with someone who knows the collection.
- **Findability is missing from both directions.** No search, no activity
  filter. Production has "Search this place" and All / Runs / Rides. At 68
  routes across 30 places this gates replacing the production Atlas — see
  §5 of the integration plan.
- **`window.__reliefMap`** is a lab-only global.
- **Two service-track road layers keep Liberty's default grey** (`#cfcdca`);
  the restyle did not take on them. Cosmetic.
- **Direction D has no unit tests.** Its logic is in rendering and camera
  behaviour, covered by `verify:direction-d` against the real application.
  `seed-return-context.test.ts` (11 tests) covers the shared store.
- **B's mobile map gestures still swallow page scroll** — a flick starting on
  the map scrolls 0px where the same flick on the prose scrolls 658px; the map
  is 42% of the day screen. D fixes this by disabling those gestures. B does
  not, and that remains the top actionable issue for the baseline.

## 10. Evidence in this checkpoint

`docs/evidence/direction-d/` — nine stills captured from this exact commit,
downscaled to 1× and JPEG-encoded so the repo carries evidence without carrying
2× PNGs (912 KiB total):

| File | What it shows |
|---|---|
| `01-region-desktop.jpg` | The region: one landform, every recorded day on it |
| `02-day-no-photographs-thread-held.jpg` | Banff, thread held — the primary case |
| `03-day-kyoto-photograph-raised.jpg` | Kyoto, real photograph raised at its recorded distance |
| `04-day-page-set-aside.jpg` | The page set aside, the whole place |
| `05-descent-arrival.jpg` | The end of the descent, standing on the ridge |
| `06-region-mobile.jpg` `07-day-mobile-thread-held.jpg` `08-day-kyoto-mobile.jpg` | 390×844 |
| `09-replay-entered-at-held-distance.jpg` | Replay having entered at the held distance |

Three recordings were produced at this checkpoint and sent to Lauren directly
rather than committed (≈6 MB of video): the desktop journey (58 s), the mobile
journey (67 s), and the Kyoto thread drag (26 s). Regenerate any of them with
`npm run verify:direction-d` for the assertions, or re-capture with Playwright
against the URLs in §2.
