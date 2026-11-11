# Active Theory whole-app design review — 2026-10-13

## Outcome

Reviewed and corrected Atlas, Finder, Routes, route guides, Replay/settings, and Admin against `design.md`. An initial adversarial agent reviewed the system; a separate final adversarial reviewer inspected the corrected source and settled screenshots. The final reviewer found no remaining P1/P2 design defects in the reviewed states at 390×844 and 1280×900.

This is local implementation and verification at http://127.0.0.1:8787. No production deployment was performed.

## Corrections

- Removed recorded-repair marks, click targets, and evidence panels from normal route guides and Replay. Repair records and diagnostic components remain intact; diagnostics require explicit component opt-in.
- Added a route-specific London guide for `14486170630`. An agent inspected the live map and 369 recorded points, then wrote an itinerary covering Somers Town, Holborn, the Thames, Westminster, Chelsea, Kensington Gardens, Paddington, Regent’s Park and Camden. The guide retains draft status and explicit AI/map-review provenance. No firsthand experience, verified surface/access claims, or elevation-based difficulty claims were invented.
- Suppressed empty editorial placeholder sections. Removed duplicated introductory prose where the guide already contains it.
- Reframed the mobile guide map above the collapsed sheet so the entire route, map controls, and credits remain visible.
- Aligned Finder, guide and Atlas fallback lines with their light basemaps: narrow dark paths with restrained white casing. Retained white paths on satellite/3D worlds. Loading maps now use black rather than beige surfaces.
- Removed remaining orange Replay route/playhead accents and projected panel shadows. Unified the elevation profile with neutral tones.
- Corrected the route-guide CTA hover contrast and destructive-button foreground contrast.
- Restored the missing `forest-soft` theme mapping. Admin selection now has a visible wash and filled indicator, with date/distance distinguishing repeated locations.
- Eliminated Admin’s false no-results flash during row selection by deriving the initial editor draft from the selected route immediately.
- Improved Admin sticky-footer opacity and aligned native filter selects with 44px controls.
- Fixed Atlas search-help contrast and removed duplicated Finder description text.

## Verification

- `npm run verify:ticket`: passed — typecheck, production build, 240 unit tests, 4 core navigation tests.
- Final focused suite: **84 passed**. Specs: `route-loading`, `redesign`, `admin-curation`, `routes-library`, `earth-replay`, `atlas-cesium`.
- Earlier focused suite also verified Finder planning, production Google Replay, and removal of repair affordances. It passed 47 checks; one stale cream-outline assertion failed, was corrected, and the entire affected route-loading spec passed in the final suite above.
- `GODIESEL_DESIGN_REVIEW_LIVE=1 GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 npx playwright test --config playwright.live.config.ts e2e/design-review-live.spec.ts --reporter=line`: **2 passed**, covering all six surfaces at both sizes with real providers. Captures wait for map readiness, settled Atlas camera, loaded thumbnails and rendered editors; these are not loading-state screenshots.
- Curation publisher tests: **5 passed**, including full-rebuild equivalence, with documented local source roots. Checked that only London’s curation changed across canonical and generated datasets; geometry and recorded provenance remain unchanged.
- `git diff --check`: passed.

Manual browser work exercised Atlas search and next/previous route selection across resize; Finder search presets and filter expansion; Routes search and guide navigation; guide zoom/reset and mobile sheet expansion; live Replay playback and camera selection; Admin filtering and selection. Verified settled desktop/mobile appearances and restored the browser viewport afterwards. Admin was read-only locally; editable save/error workflows were verified with the existing isolated browser fixtures.

## Evidence

Screenshots are under `app/artifacts/active-theory-review/` (ignored local artifacts):

- `atlas-390.png`, `atlas-1280.png`
- `finder-390.png`, `finder-1280.png`
- `routes-390.png`, `routes-1280.png`
- `guide-390.png`, `guide-1280.png`
- `guide-story-390.png`, `guide-story-1280.png`
- `replay-390.png`, `replay-1280.png`
- `replay-settings-390.png`, `replay-settings-1280.png`
- `admin-390.png`, `admin-1280.png`

Validation logs are in `app/artifacts/active-theory-review/validation/`. Focused deterministic tests additionally cover narrow screens at 320px, loading/failure states, fallback renderers, keyboard seeking, and return-navigation state.

No full release, production cutover, or performance gate was claimed for this styling/content pass. The live checks verify rendering and interactions, not a new FPS benchmark.
