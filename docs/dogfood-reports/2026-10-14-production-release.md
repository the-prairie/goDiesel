# Production release — 2026-10-14

Published the current working copy to https://godiesel.pages.dev.

- Deployment: `2f5a3bb2-3475-46ba-86df-1463547491b0`
- Immutable deployment URL: https://2f5a3bb2.godiesel.pages.dev
- Cloudflare environment: production; branch: main.
- Base checkout: `30e60425`, with the accumulated local changes included (`--commit-dirty=true`). This was an artifact deployment, not a Git push.
- Artifact manifest SHA-256: `5b1df806685aab1ebca424637cb59c80077cfad605f0bf5f2a3f70383fe4ad2b`.
- Previous production deployment, retained as rollback point: `44990c92-b249-4c11-8be1-1465040d2a47`.

## Configuration

Authenticated Wrangler on the new computer with account/user read and Pages write access. Verified the existing `godiesel` project, production domain, and branch before deploying.

The fresh `./make-dist.sh` build included the Google browser key, all 67 route details, and the semantic search index. No live-provider-disable or single-route flag was set. The package contained 611 files, with the largest asset below Cloudflare's file limit. Private-secret scanning passed. The discovery Pages Function compiled and uploaded successfully.

Corrected the previously blank Git build configuration: `npm --prefix app ci && ./make-dist.sh`, output `dist`, repository root. Both production and preview now have Node 22 and the existing browser map key in `VITE_GOOGLE_MAPS_API_KEY` (encrypted build variable). No Strava credentials were added. Compatibility date is `2026-07-14`, matching wrangler.toml. These settings were read back, and the canonical deployment remained unchanged. A future Git-triggered build itself has not been run; today's deployment used the verified local artifact.

The production HTML, entry JavaScript, CSS, semantic index, and London/San Francisco/Bali route JSON were compared byte-for-byte with the packaged files and matched. Production Admin was verified read-only in the browser.

## Validation

- `npm run verify`: typecheck, build, bundle check and 277 standard unit tests passed. Browser suite: 218 passed, 39 opt-in skips, one font-loading measurement failure in the design lab.
- The lab test now waits for the mounted fixture and loaded fonts before checking layout. Both foundation cases passed three repeated runs (six passes). All 219 applicable deterministic browser cases are covered by the initial run plus this targeted correction.
- `GODIESEL_SEARCH_EVAL=1 npm run test:unit`: **282 passed**, including real semantic-model evaluations.
- `.venv/bin/python -m pytest -q`: **86 passed, 6 skipped**. Fixed temporary-workspace source paths in the rebuild equivalence tests, updated the obsolete navigation assertion, and excluded scratch checkouts from discovery with pytest.ini.
- `.venv/bin/python pipeline_verification.py --rebuild --output /tmp/godiesel-production-source-check.json`: **67 real routes, 103 source columns, 72 output field/type paths verified**. Regeneration happened in an isolated workspace.
- `./make-dist.sh`: passed; initial shell **286.3 KiB**, provider-key check passed.
- `git diff --check`: passed.

Live tests targeted **https://godiesel.pages.dev**, without mocked provider responses:

```sh
GODIESEL_ATLAS_PREVIEW_URL=https://godiesel.pages.dev \
GODIESEL_FINDER_LIVE=1 GODIESEL_LIVE_GOOGLE_3D_E2E=1 \
GODIESEL_DISCOVERY_REVIEW_LIVE=1 npx playwright test \
  --config playwright.live.config.ts \
  e2e/atlas-region-live.spec.ts e2e/atlas-globe-quality-live.spec.ts \
  e2e/atlas-attribution-live.spec.ts e2e/google-route-navigator-live.spec.ts \
  e2e/replay-camera-comfort-live.spec.ts e2e/finder-discovery-live.spec.ts \
  e2e/discovery-adversarial-live.spec.ts
```

Initial live result: 21 passed, two false positives in the globe image detector. Pixel inspection located the 64.5 CSS-pixel white run in the underlined Data sources control, not the globe. The test now bounds its scan above the outer route tray and credit strip, keeping the original 60-pixel atmospheric-artifact threshold. All three globe viewport cases then passed against the same deployment. **All 23 live scenarios passed across these runs.** No application behavior changed after deployment.

Coverage includes hardware-rendered Atlas performance (unchanged 30 FPS minimum), real regional terrain and thumbnails, mobile/tablet/desktop globe quality and attribution, Atlas dropdown/guide interactions, semantic external discovery, plan save/reload/preview/remove, Google 3D city and mountain replay, runner clearance, and Bali camera turn-rate checks.

Production API checks: Banff geocoding returned 200 and real disambiguation choices; invalid coordinates returned 400; POST returned 405. Browser discovery exercised actual Overpass geometry and browser-local model inference.

## Manual browser walkthrough

Used the actual production site at 1280×900 and 390×844. Searched the collection, switched to external discovery, selected Banff, and observed semantic ranking put Stoney Lookout first with matching map geometry. Saved it as a plan, reloaded Routes, opened the mobile preview, used zoom/fit controls, and downloaded GPX. The downloaded file contains 266 points in one segment, with no fabricated elevations or timestamps. Removed the test plan afterward.

Visually inspected the mobile London guide and its Inter typography, filtered the Atlas dropdown, selected London, inspected the terrain and compact card, opened replay, played/paused it, and switched to desktop Overview. Confirmed production Admin displays read-only controls. Restored the browser viewport afterward.

Evidence and command logs are under `app/artifacts/production-2026-10-14/` (ignored). Provider screenshots also remain in the respective Finder, globe, attribution, and replay artifact folders.

## Scope and limitations

Saved plans are device-local. Photon/Overpass remain community services appropriate to this personal deployment; this release adds no hosted capacity or durable global throttling. Provider availability and model downloads still affect first use. No fresh full Earth Engine regeneration/cinematic-export pipeline run was performed; this report covers route regeneration, the application release gate, and the deployed journeys listed above. The local source changes have not been committed or pushed by this release.

## Follow-up: compact mobile navigation

Published https://bff56052.godiesel.pages.dev to the same production domain after
the user flagged excessive bottom-navigation space. Reduced the content height
from 82px to 56px, retained safe-area padding and 55px-high links, used 11px
labels with 18px icons, and replaced the full active-tab background/dot with a
small top indicator and semibold label. Desktop navigation is unchanged.

Ran the affected navigation, Atlas layout, route detail, and Replay suites:
54 passed initially; the two expected changes were the old 106px safe-area
assertion and mobile screenshot baseline. Reviewed the screenshot diff (only
the footer changed), updated those expectations, and reran both normally:
2 passed. This revalidates the affected 56 cases while retaining the prior
release's unaffected checks. Fresh deployment build, provider-key check and
bundle budget passed. Production HTML matches the artifact.

Used the actual browser at 390×844 and 320×568 locally, then checked production
at 390×844: navigation measured 56px and tapping Routes updated both the page
and active item. Safe-area regression confirms 80px total with a simulated
24px inset and no Replay overlap. Evidence: `app/artifacts/compact-navigation/mobile.png`.
