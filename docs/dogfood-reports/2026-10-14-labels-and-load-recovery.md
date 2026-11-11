# Label cleanup and stale-deployment recovery — 2026-10-14

## User-facing changes

- Removed the AI artwork badge from route covers, without moving it to another visible label. The small imagery-source credit remains. Cover alt text describes aerial artwork and the recorded trace.
- Removed the AI-written introduction and About this guide process note from public route guides. Route-specific terrain, highlights, cautions, seasonality, and review status remain. Editorial provenance remains available in curation metadata/Admin.
- Restored the user's production Finder tab by reloading it. Its previous loaded shell requested `/assets/finder-page-LUguK_H_.js`, which belonged to an earlier deployment. A direct request returned HTTP 200 with `text/html` and the SPA index instead of JavaScript, confirming the obsolete asset was unavailable. The router exposed its default developer error screen.

## Recovery

The app listens for Vite's supported preload-error event. Recognized dynamic-import/CSS loading failures trigger a refresh while preserving the full URL. A session-storage marker permits only one automatic attempt per loaded shell. Offline state or blocked session storage skips automatic recovery. A root route error view offers Try again and Back to routes without exposing the developer stack. The fallback respects single-route microsite destinations. HTML responses for `/` and `/index.html` now require cache revalidation.

Reference: [Vite load error handling](https://vite.dev/guide/build.html#load-error-handling).

## Verification

Logs: `app/artifacts/route-covers/`.

- Label/card checks and desktop/mobile visual baseline: **4 passed** (`label-removal-tests.log`). Both refreshed screenshots were visually inspected.
- Route-guide and navigation checks at 390 and 1280 px: **2 passed** (`guide-note-removal-tests.log`). Bragg Creek's actual local guide was also inspected; the authorship note is absent and its route-specific cautions remain.
- Recovery fault injection: **3 passed** (`chunk-recovery-focused.log`). A failed Finder chunk recovers on the next load with its URL query preserved; a persistent failure stops after one retry and the manual action works; blocked storage avoids automatic reload and Back to routes works.
- Full regression suite: **284 unit tests passed, 5 skipped; 231 browser tests passed, 39 skipped** (`recovery-release-gate.log`). Typecheck, build, and bundle budget passed.
- Recovery evidence rerun: **3 passed** (`chunk-recovery-visual.log`), with direct visual inspection of the recovery screen at 390 × 844 and 1280 × 720. [Mobile](../../app/e2e/evidence/load-recovery/mobile.png) · [Desktop](../../app/e2e/evidence/load-recovery/desktop.png).

The badge-only change was deployed as `7ac994b8.godiesel.pages.dev`. The combined guide cleanup and recovery release is **https://3ac5cecd.godiesel.pages.dev**, serving production at https://godiesel.pages.dev.

Production index SHA-256 matches the built file. Both the root HTML and `/index.html` redirect have `Cache-Control: no-cache`; the first edge observation of the redirected index had the prior revalidation header, and the subsequent explicit redirect/root verification confirmed the new rules. Receipt: `recovery-production-receipt.json`.

Actual production browser verification: Finder opened; Kyoto returned two collection matches and real map geometry; Routes opened without artwork badges; the Bragg Creek guide opened without AI-written or About this guide text. Its route-specific cautions and seasonality remained. No warning/error entries were returned from the verification tab. The affected user tab was refreshed into the new production version. Temporary test tab closed and viewport override reset.

Screenshots: [Finder](../../app/e2e/evidence/load-recovery/production-finder.png), [clean cards](../../app/e2e/evidence/load-recovery/production-clean-cards.png), [clean guide](../../app/e2e/evidence/load-recovery/production-clean-guide.png).

The application error was fault-injected locally; it was not induced against production. Live-provider suites were not repeated because this change does not alter provider, terrain, imagery-rendering, or camera behavior. Existing dirty workspace changes were preserved.
