# Field notes covers and Atlas label release — 2026-10-14

## Delivered

All 67 recorded routes have individual AI-enhanced aerial covers, generated with built-in image_gen from their cached Esri source images. The optimized WebP set totals 18.8 MiB; the largest image is 424.1 KiB. Covers load lazily from the app. Opening the library makes no runtime AI-generation or map-image request. Original generated outputs remain available locally; provenance, source/artwork hashes, and recorded-point projection are in the cover manifest. See [pipeline and prompts](../../scripts/route-covers/README.md).

The Field notes cards use imagery, concise route information, and a clear guide action. AI artwork is visibly identified as illustration. The recorded GPS trace is drawn separately. Generated geographic detail is not navigation evidence.

Atlas labels stay measurable when hidden, use their actual bounds with separation, update with animation frames, and prioritize selection deterministically. This removes the hide/measure/show collision oscillation. A centered-pinch regression additionally exposed Cesium's attempt to normalize a zero rotation axis; a scoped guard ignores that no-op while retaining normal and invalid-input behavior.

## Independent review and fixes

A fresh agent interacted with the actual local app across desktop, 390 px, and 320 px. It found cropped mobile route traces and unreviewed guide copy leaking into cards. Both were fixed: image and SVG now share matching contain/meet framing, and draft cards use factual distance/activity/climb summaries. Every vertex of all 67 traces is checked at four widths. The main agent subsequently interacted with the completed asset set on desktop and mobile, including filtered card → guide → filtered library return. The fresh reviewer inspected all eight final screenshots and found no remaining visual blocker. Its final CUA session was unavailable, so this final independent pass was screenshot-based; the initial independent interaction and final root-agent interaction remain distinct. See [full independent review](2026-10-14-field-notes-adversarial.md).

## Verification

Logs are retained locally in `app/artifacts/route-covers/`.

- `npm --prefix app run verify:ticket`: typecheck/build, 283 unit tests passed, five skipped, and four core navigation checks passed.
- `npm run verify` from `app/`: unit/build/bundle gates passed; browser run had 223 passed, 39 skipped, and five failures. Failures were investigated rather than waived: the centered-pinch crash above, a canvas test mask conflicting with RAF label updates, an intentionally changed card visual baseline, and two outdated navigation-height assumptions.
- The original centered-pinch scenario was kept unchanged. Canvas masking now uses opacity; mobile overlap assertions compare against the actual navigation bounds. Updated desktop/mobile baselines were visually inspected and wait for visible cover assets to load.
- `npx playwright test e2e/atlas.spec.ts e2e/atlas-label-stability.spec.ts e2e/navigation.spec.ts e2e/redesign.spec.ts e2e/routes-library.spec.ts`: **86 passed**, resolving all five release failures and covering the affected behavior. Unaffected successful release checks were retained per repository gate-validity policy.
- Scoped engine unit tests: **4 passed**, including the added zero-axis regression; typecheck passed.
- `GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 npm run test:e2e:atlas-live`: **6 passed**, including hardware-rendered globe performance, regional Kyoto/Banff imagery, mobile/tablet framing, and actual satellite thumbnails.
- `./make-dist.sh`: production build, provider-key check, and bundle budget passed. Initial shell is 286.3 KiB. Output is 80 MiB across 745 files.

No claim is made that generated terrain is geographically exact. The separate GPS trace is sourced from recorded geometry. Full private Strava ingestion/Earth Engine export was not repeated for this cover/Atlas release.

## Production receipt

Published using `npx wrangler pages deploy dist --project-name=godiesel --branch=main --commit-dirty=true`.

- Deployment: https://67cdf4a1.godiesel.pages.dev
- Production: https://godiesel.pages.dev/#/routes
- Production index hash matches the built index. All **67 of 67** deployed AI WebPs returned successfully and matched local SHA-256 hashes. Receipt: `app/artifacts/route-covers/production-assets.json`. An initial Python urllib request was rejected with HTTP 403; the Node fetch verification completed successfully without changing the deployment.
- Actual production CUA checks at 1440 × 900 and 390 × 844: new cards and disclosure rendered; Bali search returned five routes; opening the 19.8 km guide and returning preserved the Bali filter. Atlas labels were visibly separated at both sizes; zoom and reset worked; selecting Crete loaded real provider terrain and the eight-route carousel. Retrieved browser warning/error log was empty.
- Production screenshots: [Routes desktop](../../app/e2e/evidence/field-notes-independent/production-routes-desktop.png), [Routes mobile](../../app/e2e/evidence/field-notes-independent/production-routes-mobile.png), [Atlas desktop](../../app/e2e/evidence/field-notes-independent/production-atlas-desktop.png), [Atlas mobile](../../app/e2e/evidence/field-notes-independent/production-atlas-mobile.png).
- Temporary viewport override was reset. The production Routes tab remains open as the deliverable. Existing working changes were preserved; no blanket commit or reset was performed.
