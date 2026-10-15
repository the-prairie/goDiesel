# Atlas globe quality — 2026-10-13

Implemented and verified locally at http://127.0.0.1:8787. No deployment.

## Changes

- Reproduced the detached white atmospheric band by zooming out from Bali. Removed the regional off-axis frustum shift that misaligned the atmospheric pass at orbital distances.
- Hide the redundant ellipsoid once Google's photorealistic terrain is ready; retain the global surface during loading and restore it on return to the global Atlas.
- Replace the noisy star box with a dark background; soften the atmospheric light and keep the global map in consistent daylight.
- Improve Retina edge clarity with FXAA and bounded supersampling: at most 1.5x, with a 2.5-million-pixel supersampling budget. Large displays are never reduced below native CSS resolution.
- Gradually straighten the regional camera between 1,000 and 5,000 km altitude. Apply the 26,000 km maximum zoom distance to buttons and keyboard zoom as well as the mouse controller.
- Share the existing deterministic Atlas test fixture with layout tests so offline layout checks no longer depend on external terrain. Correct one stale region-search selector.

Existing imagery providers, attribution, route coordinates, and selected-route styling are preserved.

## Verification

- Ticket gate: typecheck, production build, 248 unit tests, and 4 navigation tests passed. Subsequent camera/rendering refinements were covered by a fresh production build and the focused/live checks below.
- Final focused Atlas suite: 28/28 passed, including six responsive layouts, search, keyboard and wheel controls, carousel navigation, resizing, renderer cleanup, and fallback handling.
- Final live suite: 9/9 passed, zero skips or retries. Covers Bali regional/orbital/global views at 390×844, 684×724, and 1440×900 with device scale factor 2; regional Kyoto/Banff terrain; mobile/tablet framing; satellite thumbnails; and global camera performance.
- The Bali regression checks validate the orbital pitch, zoom bound, absence of the wide white artifact, next-route selection, return to global Atlas, zoom/reset controls, and absence of page errors.
- Hardware renderer: ANGLE Metal, Apple M2. Final camera transition sample: 73 frames in approximately 2.03 seconds, **36.0 FPS**, above the 30 FPS gate. An initial 27.9 FPS sample prompted removal of the more expensive per-fragment atmosphere setting; the final run uses the standard atmosphere path.
- Manual in-app browser reproduction at 684×724 confirmed the original artifact and its correction. Final phone and desktop screenshots were visually inspected. Temporary browser tab and viewport overrides were cleaned up.
- `git diff --check` passed.

## Evidence

- [Desktop orbital globe](../../app/artifacts/globe-quality/bali-orbit-1440.png)
- [Phone orbital globe](../../app/artifacts/globe-quality/bali-orbit-390.png)
- [Tablet orbital globe](../../app/artifacts/globe-quality/bali-orbit-684.png)
- [Desktop global Atlas](../../app/artifacts/globe-quality/global-1440.png)
- [Phone global Atlas](../../app/artifacts/globe-quality/global-390.png)
- [Desktop Bali region](../../app/artifacts/globe-quality/bali-region-1440.png)

Local run logs: `/tmp/godiesel-globe-ticket.log`, `/tmp/godiesel-globe-focused-final.log`, and `/tmp/godiesel-globe-live-final.log` (the latter includes the JSON results and GPU/FPS attachments).

The global map still uses the bundled Natural Earth imagery; regional detail depends on streamed Google tiles. This change improves rendering and framing rather than replacing source imagery.
