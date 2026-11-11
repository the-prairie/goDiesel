# Independent Field notes and Atlas review — 2026-10-14

Fresh reviewer inspected the actual app at `http://127.0.0.1:8787` through CUA's in-app browser. Desktop viewport was 1280 × 720; mobile checks used 390 × 844 and 320 × 740. This review does not approve production deployment. The initial review edited no application files; a subsequently authorized repair pass is recorded below. Temporary viewport overrides were reset and the review tab was closed.

## Original findings (repaired in the follow-up below)

### P2 — The mobile cover crop removes recorded route geometry

At 390 px, open Routes and inspect the first Tokyo card. The white trace enters the top edge and exits the bottom; the northern end and southern turning loop are missing. Its square image and SVG are both cropped with `cover`/`xMidYMid slice` into a 356 × 208 media frame.

The live DOM yielded a frame from y=361.39 to 569.39, but the projected route extends from y=333.54 to 597.24. 109 of 377 polyline vertices are outside that frame. Applying the same read-only calculation to the initial page flags 13 of 24 covers, including Japan, Okayama, Hiroshima, Bragg Creek, Calgary, London, and several Canary Islands routes. The counts describe vertices, not route distance.

Source: `app/src/ui/route-cover.tsx:17`, `app/src/index.css:681`, and `app/src/index.css:698`. Preserve the full route extent with matching imagery/geometry transforms; changing only the overlay fit would misregister the route. Add a responsive bounds assertion covering tall and wide routes.

Evidence: [390 px Routes screenshot](../../app/e2e/evidence/field-notes-independent/routes-390.jpg).

### P2 — Draft interpretation is shown as undisclosed card copy

The Tokyo card displays “Tokyo opens toward the water on this 21.8 km circuit.” under “Recorded Run”, without a draft or interpretation label. Open its guide and Read guide: the same source text is explicitly identified as AI-written and awaiting owner review. The Routes card implementation extracts `route.guide.vibe` without checking review status. The selected Crete Atlas cards still show “Guide not yet reviewed”, making the new Routes surface inconsistent.

Source: `app/src/ui/route-card.tsx:16` and `app/src/ui/route-card.tsx:30`. This conflicts with CONTEXT's provenance/honesty and unreviewed-guide requirements. Use reviewed text only with factual fallback, or identify draft interpretation on the card.

Evidence: [desktop Routes screenshot](../../app/e2e/evidence/field-notes-independent/routes-desktop.jpg) and [390 px Routes screenshot](../../app/e2e/evidence/field-notes-independent/routes-390.jpg).

## Scenarios personally exercised

- Desktop library rendered the Tokyo/Kyoto enhanced covers with visible “AI-enhanced illustration” and “Based on Esri imagery” labels. Other inspected covers identified Esri World Imagery. The white route overlay was separate from the raster artwork in the DOM.
- Tokyo region filter returned three routes. Opening Tokyo retained the filtered All routes target. Discovered status returned the Rome route with “Discovered Run”. An unmatched search showed an explicit empty state; Reset filters recovered the library.
- Load more increased the actual DOM card count from 24 to 48 to 67. Opening Kyoto and using All routes preserved `page=3` and all 67 cards.
- 390 px and 320 px cards, filters, navigation, metrics, titles, and action text were usable without horizontal page overflow in the inspected views. The search placeholder truncates at 320 px, but the input remains labelled and usable. No clipped text or unreachable card action was found. This layout pass does not waive the route-geometry crop finding.
- Tokyo's guide displayed the actual map, route line, metrics, and draft disclosure. Read guide moved focus into readable content. Kyoto's mobile Read guide expanded its panel at 320 px; the review status, content, and replay action remained readable. [320 px guide screenshot](../../app/e2e/evidence/field-notes-independent/guide-320.jpg).
- Tokyo Open replay loaded actual Google 3D imagery. Play changed to Pause and progress advanced from 0.00 to 0.02 km. Pause and All routes worked. This is a launch/playback smoke check, not a complete camera or provider benchmark.
- Atlas rendered its actual globe. Drag rotation and zoom changed the view, visible labels remained separated in inspected screenshots, and clicking Crete loaded the region terrain and eight-route carousel. Global return worked.
- After camera settling, 24 samples at 50 ms intervals showed identical visible label names and pixel positions on desktop; a separate 24-sample mobile run did likewise. Desktop sample: Crete, Canary Islands, Bologna, Tokyo. Mobile sample: Crete and London. Labels measured 44 px high. No stationary oscillation or label overlap was reproduced. [Desktop globe](../../app/e2e/evidence/field-notes-independent/atlas-rest-desktop.jpg); [390 px globe](../../app/e2e/evidence/field-notes-independent/atlas-390.jpg).
- Atlas also rendered at 320 px with accessible zoom controls and a visible Crete label after zooming out.
- Final browser console retrieval returned no warning/error entries. The four cover images intersecting the desktop viewport were complete with nonzero natural width. Manifest filesystem inspection found 67 covers, with all referenced assets present (two AI-enhanced, 65 satellite).

## Limits and evidence discipline

- No image-failure injection was performed in the live CUA browser. Source inspection confirms `onError` switches to RouteThread; `routes-library.spec.ts` contains a focused aborted-cover test that verifies the route trace and guide remain usable. Its existence is not a claimed test pass from this reviewer. The main agent should retain its independent execution result.
- No quantified loading-speed/FPS claim, full provider gate, release gate, all-route geographic accuracy assessment, or production verification is made. Cached cover presence does not prove every image is geographically faithful. AI labels correctly identify the two changed rasters as illustrations; only the separately sourced route overlay was checked structurally.
- One early filter attempt coincided with the main agent's final hot reload. It was repeated successfully after the application stabilized and is not reported as a user-facing defect.
- The full app workflow was exercised through CUA, with code used afterward to locate causes. Screenshots are local evidence and should not be mistaken for a deployed-state receipt.

## Authorized repair and visual re-review

The main agent subsequently authorized this reviewer to repair both findings in the card components/CSS and add focused regressions. Manifest generation and image assets remain owned by the main agent; they were not changed in this repair.

- **Crop repaired:** sharp imagery now uses `object-fit: contain`, and the SVG uses `xMidYMid meet` in the exact same inset box. A dim, blurred, decorative copy fills spare background space. The full source extent and route stay registered, with padding, while mobile media remains 208 px high. No stretched or separately recentered route is used.
- **Draft copy repaired:** only `reviewed`/`published` guides supply prose; draft guides use distance, activity, and climb. No workflow badge was added. Tokyo now reads “21.8 km run with 286 m of climbing.” Kyoto retains its reviewed excerpt.
- **Regression coverage:** the rendered coordinate test checks every vertex of all 67 routes at 320, 390, 768, and 1280 px, checks the image/SVG boxes and fit modes match, and rejects oversized mobile media. A separate test checks draft and reviewed card copy. Existing cover-failure and cache/lazy tests were included.

From `app/`, `npx playwright test e2e/routes-library.spec.ts --grep 'Field notes|cached cover failure|covers are cached'` passed **8 tests in 14.7 seconds**. This also built/typechecked the app through the configured browser-test server. A second run after adding screenshot evidence, `npx playwright test e2e/routes-library.spec.ts --grep 'Field notes preserve'`, passed **4 tests in 11.5 seconds**. `git diff --check` on the touched files passed. No full suite or deployment was run.

The reviewer personally opened and visually inspected all four saved browser renders:

- [320 px repaired library](../../app/e2e/evidence/field-notes-independent/routes-fixed-320.png)
- [390 px repaired library](../../app/e2e/evidence/field-notes-independent/routes-fixed-390.png)
- [768 px repaired library](../../app/e2e/evidence/field-notes-independent/routes-fixed-768.png)
- [1280 px repaired library](../../app/e2e/evidence/field-notes-independent/routes-fixed-1280.png)

Tokyo's northern end and southern loop are now both visible, attribution and AI labels remain readable, and the cards have not become taller to accommodate geometry. The background treatment is deliberately subdued so the cropped decorative layer is not mistaken for the mapped route surface. Kyoto's existing 960 × 390 raster yields a shallow sharp strip on desktop; it is complete but has less visual weight than square Tokyo. The main agent was advised to prefer more consistent source framing during the newly requested all-route AI cover generation. These screenshots predate completion of that asset generation.

**Post-fix interaction limitation:** CUA's browser inventory returned no browsers, and native Dia selection timed out. The post-fix visual review therefore used screenshots of the actual app from its focused Playwright browser tests at port 8791, not a second interactive CUA session. The earlier interactive CUA passes remain documented above; a final interactive check of the completed new cover set is still appropriate. The previously unexecuted failure-injection gap is now covered by the passing focused aborted-cover test, although its fallback screenshot was not personally inspected.

## Final all-route asset pass

After the main agent imported the requested complete AI cover set, this reviewer checked the current manifest: **67 of 67 covers are AI-enhanced, all 67 referenced assets exist, and every projection frame is square at 720 × 720**. Kyoto's wide prototype has been replaced by a square frame, resolving the composition concern above. The reviewer directly opened the final Canary Islands (`14422331296`), Bali (`10082410891`), and Victoria (`5786313644`) raster files. They show distinct coastline/dune, green inland terrain, and city/harbour compositions with no baked-in white route line. This is an artwork inspection, not geographic ground-truth validation or an app-interaction claim.

The attempted final CUA re-review was still blocked in this reviewer context: `cua.getBrowser({id: '2'})` returned `Browser is not available: 2`; `cua.getTab('31', {browser: '2'})` returned the same; and `cua.getState()` returned an empty `browsers` array. No viewport or root-session tab was changed. The main agent reports that its own CUA session can access this browser and is performing the final interactive checks. This reviewer has requested those final rendered screenshots for independent visual inspection; no final interactive pass is claimed here.

## Final screenshot review — completed cover set

The main agent subsequently supplied the following screenshots from its final CUA session. This reviewer personally opened and inspected all eight files:

- [Final Routes desktop](../../app/e2e/evidence/field-notes-independent/final-routes-desktop.png)
- [Canary Islands desktop](../../app/e2e/evidence/field-notes-independent/final-canary-desktop.png)
- [Bali desktop](../../app/e2e/evidence/field-notes-independent/final-bali-desktop.png)
- [Bali mobile](../../app/e2e/evidence/field-notes-independent/final-bali-mobile.png)
- [Victoria desktop](../../app/e2e/evidence/field-notes-independent/final-victoria-desktop.png)
- [Victoria mobile](../../app/e2e/evidence/field-notes-independent/final-victoria-mobile.png)
- [Atlas desktop](../../app/e2e/evidence/field-notes-independent/atlas-fixed-desktop.png)
- [Atlas mobile](../../app/e2e/evidence/field-notes-independent/atlas-fixed-mobile.png)

**Independent visual conclusion:** no remaining blocker found in these rendered views. Tokyo and the replacement square Kyoto have comparable visual weight; the earlier shallow Kyoto strip is gone. Canary Islands, Bali, and Victoria show distinct, place-specific compositions. The inspected route lines are visible through their extremities with surrounding space instead of abrupt clipping at the media boundary. Mobile Bali and Victoria preserve complete route shapes within compact cards. AI-enhanced illustration disclosure, Esri source credit, titles, factual summaries, distance/climb, dates, and Route guide affordances are legible. Desktop columns align consistently, and mobile navigation does not obscure the shown first-card actions. The inspected Atlas labels are separated and readable, with controls and credit unobstructed. Static images cannot prove flicker absence; that conclusion remains limited to the earlier sampled live checks.

**Interaction evidence ownership:** the main agent reports final CUA interaction at 1440 × 900 on Routes/Canary/Bali/Victoria and 390 × 844 on Bali/Victoria, including Bali card → guide → All routes with the filter preserved. Those are root-agent interactive results, not a second interactive session performed by this reviewer. This reviewer's final contribution is direct inspection of the supplied rendered evidence plus the manifest/file checks above.

Both original P2 findings are resolved for the inspected final set. This conclusion does not sign off the separate Cesium centered-pinch camera exception or the full release gate, which the main agent reported as still being verified when these screenshots were supplied. No additional application change was made in this final screenshot review.
