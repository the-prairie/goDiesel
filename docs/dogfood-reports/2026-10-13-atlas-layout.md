# Atlas layout cleanup — 2026-10-13

## Scope

Implemented the approved Atlas layout follow-up in the local checkout. This report covers this layout pass, independently of the earlier full-app redesign and dependency remediation. No deployment was performed.

- Consolidated search into one surface. Region browsing and Admin are inside the expandable options area; Escape closes it and returns focus to its trigger.
- Kept a single All / Runs / Rides selector beneath search.
- Moved reset and zoom into an edge toolbar, above the route carousel when a region is selected. Short screens use a horizontal toolbar and compact route cards.
- Reduced globe label typography and separated route counts into badges, retaining 44-pixel touch targets.
- Reduced mobile primary navigation to Atlas, Finder, Routes, and Replay. Admin remains in Atlas options and desktop navigation.
- Fixed narrow-screen title crowding and route-link wrapping. No provider, terrain, imagery, or camera implementation changed.

## Manual browser verification

Used the Codex in-app browser against the running app at http://127.0.0.1:8787/. Inspected desktop 1280×900, mobile 390×844 and 320×568, 390×660 at the compact-layout boundary, and the extreme 390×320 layout. Checked global and selected-region views with live map imagery.

Verified search results, region selection, option expansion/collapse, keyboard Escape, the All / Runs / Rides controls, zoom in/out, reset, region close, previous/next route, route guide and replay handoffs, return-state preservation, and mobile Admin navigation. Runs rendered 61 route lines; rides rendered 5. Zoom in and out changed the camera target as expected. The browser error log was empty at the end. Restored the natural viewport and left Atlas open.

## Automated verification

- TypeScript: passed.
- Unit tests: 240 passed across 40 files.
- Focused layout checks after overlap fixes: 23 passed.
- Affected browser suite: 81 passed (7.4 minutes).
- Final layout recheck including the new 390×660 boundary: 7 passed (1.8 minutes).
- Production build: passed (`npm run build`).
- Whitespace validation: passed.

The affected browser command is:

```sh
npx playwright test e2e/atlas.spec.ts e2e/atlas-layout.spec.ts e2e/atlas-cesium.spec.ts e2e/navigation.spec.ts e2e/weathered-route-journey.spec.ts
```

After the 81-test run, the compact breakpoint was extended from 658 to 700 pixels to fix an observed overlap at 390×660. The existing tested sizes kept the same behavior. Ran `npx playwright test e2e/atlas-layout.spec.ts` again against the final source: all seven cases passed, including the added boundary case (82 unique browser cases verified overall).

The mobile shell screenshot baseline was intentionally updated for the approved four-tab navigation. The final suite runs without snapshot updating. New layout checks cover discovery spacing, 44-pixel map controls, keyboard dismissal, Admin access, and non-overlap with the selected-region carousel. The existing Atlas matrix covers additional narrow, tablet, desktop, and short viewport combinations.

Browser automation uses the repository's normal test configuration, with live providers disabled and deterministic fixtures in relevant Cesium scenarios. Manual browser checks used the running development app. No live-provider performance or full release gate was rerun for this layout-only change, per the repository testing policy.

## Evidence

Screenshots and logs are saved locally under `app/artifacts/atlas-layout/` (ignored by Git). In particular, `global-390x844.png`, `global-1280x900.png`, `region-320x568.png`, and `region-390x320.png` capture the final responsive compositions. The tracked mobile navigation baseline is in `app/e2e/navigation.spec.ts-snapshots/`.
