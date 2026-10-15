# Route editorial and discovery UX review — 2026-10-13

## Delivered

64 new route-specific guides across Pacific (19), Mediterranean (23), and Canada/Italy (22). Each author inspected the actual settled route map and full detail geometry, recorded metrics, elevation profile, endpoints and available source activity notes. The three existing guides were preserved. Every new guide remains `draft` and identifies AI/map-based authorship; no firsthand experience or owner approval is implied.

The batches were cross-reviewed by another agent. Corrections removed an unsupported reclamation claim, an unverified lake name, implied intent, and catalogue bookkeeping from public prose. Owner cautions about barriers, scrambling, poor connections and the expressly discouraged Crete recording were retained.

## Interface changes

- Guide body copy uses regular Inter at 16px with 1.7 line height.
- Atlas replaces the native region select with a dark, bounded, searchable place list, counts, selected state, keyboard navigation, Escape and outside dismissal.
- Finder starts with three actionable place previews instead of an empty world map and duplicate empty-state messages.
- Search results display the actual route map alongside results on desktop and above results on mobile. Zoom and fit controls are available.
- Starting-place shortcuts match the available activity and distance; Victoria now searches a Ride around 85 km.

## Integrity and verification

All 67 detail records, manifest previews and generated payload curations agree. All non-curation fields were compared against the pre-change snapshot, including geometry, lifecycle and provenance. Unassigned master records and all three pre-existing guides are unchanged.

- `npm run verify:ticket`: typecheck, production build, 240 unit tests and four navigation tests passed.
- Initial focused Atlas layout/Finder planning/new UX checks: 20 passed.
- Final affected Atlas, new editorial UX, route loading and route library suite: 73 passed (6.2 minutes).
- Incremental curation publication suite: five passed, including rebuild equivalence.
- Live mobile (390 × 844) and desktop (1280 × 900): two walkthrough tests passed, with actual map tiles and no interception. Manual CUA inspection also covered Finder initial/result layouts, mobile map controls, Atlas place filtering and new guide prose.

## Evidence

Screenshots and per-route drafting evidence are in `app/artifacts/route-editorial-review/` (local ignored artifacts). `publication-validation.json` records the integrity result. Each batch JSON includes its individual map review, geometry facts and uncertainties.

## Catalogue discrepancies observed

These existing catalogue labels were preserved because this task changes editorial content, not region classification:

- Generic Japan records resolve to Kyoto/Tokyo in their actual maps.
- Okayama record describes Tamano hills/coast.
- Vancouver record 5944474545 is in Nanaimo.
- Mainland Greece record 13941094274 is on Hydra.

Rome 8836227189 includes a substantial recording gap; its guide does not present the straight connection as a verified path. Two Crete recordings are separate legs of an outing. Similar Victoria recordings are described honestly rather than given invented distinctions.

## New guide inventory

| Route | Catalogue region | Map reviewed |
| --- | --- | --- |
| 17665674778 | Tokyo, Japan | Yes; pacific |
| 17636880071 | Kyoto, Japan | Yes; pacific |
| 17626995684 | Japan | Yes; pacific |
| 17616195995 | Okayama, Japan | Yes; pacific |
| 17606492777 | Hiroshima, Japan | Yes; pacific |
| 17597564971 | Hiroshima, Japan | Yes; pacific |
| 17586941421 | Japan | Yes; pacific |
| 17576988805 | Tokyo, Japan | Yes; pacific |
| 17569931129 | Tokyo, Japan | Yes; pacific |
| 13835672113 | Bay Area, CA | Yes; pacific |
| 13807396994 | Bay Area, CA | Yes; pacific |
| 14736711660 | Bay Area, CA | Yes; pacific |
| 10082410891 | Bali, Indonesia | Yes; pacific |
| 10075093128 | Bali, Indonesia | Yes; pacific |
| 9959792315 | Bali, Indonesia | Yes; pacific |
| 9953403673 | Bali, Indonesia | Yes; pacific |
| 9945324433 | Bali, Indonesia | Yes; pacific |
| 9915035779 | Los Angeles, CA | Yes; pacific |
| 9844581410 | New York, NY | Yes; pacific |
| 14422331296 | Canary Islands | Yes; mediterranean |
| 14415835303 | Canary Islands | Yes; mediterranean |
| 14394581660 | Canary Islands | Yes; mediterranean |
| 14349820520 | Canary Islands | Yes; mediterranean |
| 14262327221 | Canary Islands | Yes; mediterranean |
| 14160295943 | Canary Islands | Yes; mediterranean |
| 14130782031 | Crete, Greece | Yes; mediterranean |
| 14130772463 | Crete, Greece | Yes; mediterranean |
| 14130768855 | Crete, Greece | Yes; mediterranean |
| 14080158961 | Crete, Greece | Yes; mediterranean |
| 14064880083 | Crete, Greece | Yes; mediterranean |
| 14030669837 | Crete, Greece | Yes; mediterranean |
| 14023448720 | Crete, Greece | Yes; mediterranean |
| 13134774070 | Crete, Greece | Yes; mediterranean |
| 13971753429 | Mainland Greece | Yes; mediterranean |
| 13941094274 | Mainland Greece | Yes; mediterranean |
| 13935098460 | Mainland Greece | Yes; mediterranean |
| 8836227016 | Bologna, Italy | Yes; mediterranean |
| 8836226791 | Bologna, Italy | Yes; mediterranean |
| 8836226736 | Bologna, Italy | Yes; mediterranean |
| 8767788731 | Costa Brava, Spain | Yes; mediterranean |
| 8762819138 | Costa Brava, Spain | Yes; mediterranean |
| 8761568343 | Madrid, Spain | Yes; mediterranean |
| 16366737881 | Bragg Creek, AB | Yes; canada_italy |
| 15573295095 | Banff/Kananaskis | Yes; canada_italy |
| 15562324390 | Banff/Kananaskis | Yes; canada_italy |
| 15182597704 | Calgary, AB | Yes; canada_italy |
| 13534813116 | Saskatoon, SK | Yes; canada_italy |
| 13358070690 | Banff/Kananaskis | Yes; canada_italy |
| 9934715694 | Highwood Pass | Yes; canada_italy |
| 9845102380 | Banff/Kananaskis | Yes; canada_italy |
| 8836227189 | Rome, Italy | Yes; canada_italy |
| 8790922344 | Veneto, Italy | Yes; canada_italy |
| 8788969453 | Verona, Italy | Yes; canada_italy |
| 8788967538 | Treviso, Italy | Yes; canada_italy |
| 6496900063 | Ucluelet, BC | Yes; canada_italy |
| 6477420224 | Nanaimo, BC | Yes; canada_italy |
| 5981399261 | Nanaimo, BC | Yes; canada_italy |
| 5944474545 | Vancouver, BC | Yes; canada_italy |
| 5868096334 | Nanaimo, BC | Yes; canada_italy |
| 5837509151 | Nanaimo, BC | Yes; canada_italy |
| 5786313644 | Victoria, BC | Yes; canada_italy |
| 5650407638 | Victoria, BC | Yes; canada_italy |
| 5460495850 | Victoria, BC | Yes; canada_italy |
| 5420668682 | Victoria, BC | Yes; canada_italy |

## Reproduce

From `app/`:

```sh
npm run verify:ticket
npx playwright test e2e/route-editorial-ux.spec.ts e2e/atlas.spec.ts e2e/route-loading.spec.ts e2e/routes-library.spec.ts
GODIESEL_EDITORIAL_LIVE=1 GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 npx playwright test --config playwright.live.config.ts e2e/route-editorial-live.spec.ts
```

From the repository root:

```sh
GODIESEL_DIESEL_DIARIES_ROOT=/Users/larry/Documents/ChatGPT/DieselDiaries GODIESEL_TRAVEL_ROOT=/Users/larry/Documents/ChatGPT/Travel .venv/bin/python -m pytest -q test_curation_publish.py
```

The complete release suite and deployment were not part of this local editorial/UI change. Existing provider settings and map styles were preserved; the live Finder check covers the adjusted fit padding and new camera controls.
