# Discovery adversarial follow-up and Replay camera comfort

Verified locally on October 13, 2026 at http://127.0.0.1:8787. No production publication was performed.

## Discovery review

An independent adversarial agent reviewed Finder, the Atlas region picker, and route guides. The fixes address:

- Cross-region Atlas search: one search field can find Kyoto even while London is selected; an empty query has a Browse all places recovery action.
- Selected Atlas option scrolls into view on reopening; Arrow Down starts at the selected option. Desktop no longer repeats Admin in the picker.
- Finder cards expose distance, climb, and activity on mobile, offer a direct Route guide action, and restore the exact Finder search on return.
- Compact cards remove redundant activity headings, tags, and selected-map actions; match explanations focus on the requested criteria.
- Route details offer Read guide with scroll and keyboard focus, including the mobile sheet. AI draft disclosure is visible before the guide prose; the provenance section is named About this guide.

The independent reviewer re-inspected six refreshed screenshots after the first capture showed loading imagery and a sheet transition. The refreshed captures show settled Atlas maps and the expanded guide. Final assessment: no remaining actionable blockers in the reviewed evidence. Parent browser checks exercised both widths and the guide-return and cross-region flows.

## Replay camera and route thread

The Bali replay (10082410891) was used to investigate the reported jitter and harsh turns.

- Camera updates now follow the animation frame rather than a separate 32 ms cadence.
- The interactive camera uses a single time-based motion controller; the renderer's second, frame-dependent heading filter is bypassed for this view.
- Heading response is slower and limited to 30 degrees per second with 45 degrees per second squared acceleration. Tilt is limited separately; range changes use a gentler response.
- Same-timestamp mode changes skip integration. Live rapid-control testing exposed an Infinity-times-zero edge case, now covered by a regression test.
- The densified path retains recorded distances. Filament slicing interpolates by distance instead of vertex count, preventing the moving thread head from drifting along unevenly sampled GPS data. Recorded route geometry is not smoothed or rewritten.
- Interactive Replay uses a white completed thread, restrained slate route ahead, and dark casing. The cinematic-film palette is preserved through an explicit interactive palette option.

Bali was exercised at 4x around both the descent and summit turnaround, with mobile and desktop screenshots. Live tests sample the provider camera using animation-frame timestamps, verify the angular speed envelope, and test mode changes, free exploration/follow toggles, pause, and scrubbing. Unit tests cover sharp reversals across 20/30/60/120 Hz, settling, zero elapsed time, and distance-based slicing of uneven samples.

## Verification

- Ticket gate: passed (typecheck, production build, 240 then-current unit tests, 4 navigation checks).
- Final typecheck and production build after camera changes: passed.
- Final unit suite: 244 tests in 40 files passed.
- Focused Discovery regressions on final Discovery behavior: 15 passed; the earlier focused pass also passed route-loading and Atlas-layout coverage. One stale Kyoto preset assertion was corrected from 20 km to the actual 21 km preset.
- Live Discovery visual/interaction checks: 2 passed, 390x844 and 1280x900.
- Final live Google 3D checks: 7 passed (San Francisco/Crete desktop and mobile, San Francisco runner clearance, Bali comfort mobile and desktop).
- Updated legacy live selectors for Follow route and mobile camera settings; camera settling now uses a bounded range poll instead of a fixed two-second delay.
- git diff --check: passed.

Evidence directories:

- app/artifacts/discovery-adversarial/ — Finder, guide and Atlas screenshots at both widths.
- app/artifacts/replay-comfort/bali-390.png and bali-1280.png — final Bali replay screenshots.
- app/e2e/evidence/auto-director/ — live San Francisco and Crete camera captures.

Limits: camera checks use live Google photorealistic 3D in Chromium and the in-app browser. Recorded elevations remain an approximation to Google's surface mesh; these checks do not establish identical rendering or frame rates on every device. The adversarial sign-off covers Discovery UX, not a separate adversarial review of Replay.
