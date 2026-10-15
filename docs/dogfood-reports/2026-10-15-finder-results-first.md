# Finder results-first refinement — 2026-10-15

Requested: compact search and filters, results-first layout, mobile List / Map switch, shorter route-specific cards, selected-route map context, and separate discovery destination from the requested experience. A fresh agent was asked to walk through the actual app.

## Implemented

- Search results occupy the main workspace. Desktop uses a compact list beside the map; mobile defaults to List with a Map switch.
- Compact cards use route-guide highlights as grounded titles, aerial thumbnails, distance/climb, and Guide / Map / Save actions. Duplicate metric grids and search-engine status copy were removed.
- A selected-route caption identifies the single route being mapped. Resizing/revealing the map refits its route, including after switching from a hidden mobile map.
- The selected route is preserved in the URL for guide/back navigation.
- Experience words such as beach are not sent to place search. Legacy `place=beach&q=beach` URLs are interpreted correctly. Discovery has a separate Near where input, keeps the theme, and retains the destination when refining filters.
- Clearing the experience removes the query instead of only hiding a location chip.
- Negated beach references no longer qualify as beach matches. The 20 km beach search returns LA 23.2 km and Bali 17.3 km; the inland Crete and Bukit Peninsula comparisons do not match.

## Independent review

Fresh agent `finder_fresh_walkthrough` used the actual local app through CUA at verified 1280×720 and 390×844 viewports. It exercised search, distance changes, clearing beach, mobile List / Map, Bali selection, guide/back, discovery location entry, Atlas, and Routes. No P1/P2 redesign defect found.

Two P3 findings were fixed: returning from a guide reset the map selection; discovery still asked to choose a location after one had been entered. Root verified selection restoration in the actual browser after the fixes. The reviewer could not repeat the follow-up because its browser connection became unavailable; this is not represented as an independent second pass.

Screenshots: `app/e2e/evidence/finder-results-first/` (desktop Finder, mobile list/map, mobile Atlas).

## Verification

- `npm run verify`: typecheck, production build, bundle budget, and 286 unit tests passed (5 intentionally skipped). Browser run: 234 passed, 39 live/opt-in skipped, one screenshot-capture infrastructure failure in `chunk-recovery.spec.ts` (Chromium could not capture the screenshot after the assertions had passed).
- Reran all three chunk-recovery scenarios and all four new Finder scenarios against a rebuilt app: 7/7 passed. This also covers destination retention after editing distance. All 235 enabled release browser scenarios have passing results across the release run and targeted rerun.
- Earlier focused work: 25/27 scenarios passed; two obsolete assertions were corrected for the compact card content. Both passed in the subsequent release run.
- Final `./make-dist.sh`: typecheck/build, search-index check, bundle budget and provider-key check passed. The last changes retain human-readable degraded-search notices without showing engine terminology.
- Deployment: https://8fdb1cb0.godiesel.pages.dev, published to https://godiesel.pages.dev.
- Production index returns HTTP 200, `Cache-Control: no-cache`, and exactly matches the local production index (SHA-256 `e887b5db35e1e3c80a2a9e06743cbd1a35c251b674dcd1f57853e54e6d731576`). Receipt: `app/artifacts/finder-results-first/production-proof.json`.
- Actual production browser: desktop 1280×720 and mobile 390×844 inspected; mobile scrollWidth=390. Verified two beach matches, List/Map selection, fit-route control, guide/back preserving Bali selection, separate empty discovery location with beach retained, and applying any-distance before a real location request.
- Production screenshots: `app/e2e/evidence/finder-results-first/production-desktop.png` and `production-mobile.png`.
- Logs: `app/artifacts/finder-results-first/{release,final-focused,production-build,deployment}.log`.

Live-provider limitation observed locally: Photon returned real Banff disambiguation choices, but the subsequent route-source request returned a temporary-unavailability response. The UI retained the theme/location and offered retry; successful route-provider discovery is not established by that local request. Automated provider fixtures verify the UI, persistence, save/export behavior, and failure handling separately.

Production discovery recheck: a real Victoria search with beach retained and any distance also returned the temporary-unavailability response. The location and theme remained intact and Try again was available. Saved `production-discovery-unavailable.png`; this is a current external-provider limitation, not a successful new-route search. Collection search and planning UI remain usable. No provider implementation was changed in this refinement.
