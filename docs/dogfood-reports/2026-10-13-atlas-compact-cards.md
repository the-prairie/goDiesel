# Atlas compact cards and Active Theory refinement

Implemented in the active local goDiesel app. No deployment was performed.

## Current direction

The latest user-supplied Active Theory reference is preserved as root `design.md`. It supersedes the earlier vivid-violet direction, which the user rejected during this pass. The previous reference is retained at `docs/design-references/dope-security.md`.

The current treatment uses a black canvas, translucent black overlays with 4px backdrop blur, fine neutral dividers, white/gray text, and muted dusk-indigo primary buttons. Atlas routes and navigation indicators are monochrome. Inter replaces condensed headings; descriptive prose uses a Times-family serif. Primary buttons use white text for contrast rather than the reference's low-contrast black-on-indigo example. Existing 44px touch targets and reduced-motion behavior remain.

## Compact Atlas layout

- Standard selected-region tray: about 193px tall, versus roughly 320px previously (about 40% shorter).
- Short-height tray: about 145px, preserving both 44px card actions.
- Small square satellite preview and route summary replace the large image, repeated description, and elevation chart. Full route detail remains in the route guide.
- Square imagery requests and contained previews show the full recorded route instead of cropping a wide thumbnail into a narrow slot. The SVG fallback also uses a square frame.
- Region heading, route count, pagination, and close action share one slim header.
- Desktop cards start at the left edge; short lists stay together. Mobile retains a next-card peek and swipe navigation.
- Neutral hairline borders and a subtle fill identify selection. The selected route uses a fine white stroke above subdued neighboring routes.
- The selected card remains visible after desktop/mobile or short-height resizing. Thumbnail prefetching stays bounded to visible slides and their immediate neighbors.
- Map attribution sits above the tray instead of being covered by it. On normal-height screens it reserves space for map tools.

Shared navigation, buttons, headings, route preview strokes, and descriptive copy inherit the new design. Finder's selected candidate uses a subtle border rather than a thick ring. Route-guide charts use the light route color, independently of the muted primary-button fill. The underlying page workflows remain intact.

## Browser walkthrough

Personally inspected the current running app at 1280×900 and 390×844, including Atlas with both Kyoto routes and Finder with the Banff search. Verified route switching and preservation of the selected card across mobile-to-desktop resizing. Also opened and expanded the loaded mobile route guide; this caught and led to correcting a low-contrast elevation-chart stroke. Earlier compact-layout verification covered 320×568, keyboard selection, Route guide, Open replay, and return-to-Atlas state. Automated coverage includes narrow mobile, tablet, and short landscape sizes.

Final screenshots are saved under `app/artifacts/active-theory/`. Older Ember and violet captures do not represent the current design.

## Verification

- `npm run verify:ticket`: passed — typecheck, production build, 240 unit tests, and 4 navigation smoke tests.
- `npx playwright test e2e/atlas-cesium.spec.ts e2e/atlas-layout.spec.ts e2e/design-system-foundation.spec.ts e2e/redesign.spec.ts e2e/ember.spec.ts e2e/navigation.spec.ts e2e/finder-planning.spec.ts e2e/routes-library.spec.ts --reporter=line`: **83 passed**. Includes carousel interaction/resizing, control spacing, Finder planning, Routes filtering, shared navigation, and approved mobile/desktop screenshot comparisons.
- After the elevation-chart contrast correction, `npx playwright test e2e/redesign.spec.ts --reporter=line`: **5 passed**, including an explicit light-chart-stroke assertion across four viewport sizes.
- `EMBER_PREVIEW_URL=http://127.0.0.1:8787 GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 npx playwright test --config playwright.live.config.ts e2e/ember.spec.ts e2e/design-system-foundation.spec.ts --reporter=line`: **10 passed** against the local running app. Atlas captures wait for actual satellite thumbnails and verify that attribution clears the tray.
- `GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 npm run test:e2e:atlas-live`: **6 passed**, including hardware-backed 30 FPS, real Kyoto/Banff terrain, mobile/tablet framing, and loaded satellite thumbnails.
- `git diff --check`: passed.

The initial reference iteration and baseline updates were superseded by these final checks. No complete release gate or production deployment was run. The existing `ember.spec.ts` filename is retained, but these results cover the current Active Theory styling.

Final Atlas captures have loaded provider imagery. Other automated surface captures are layout evidence and may show an initial map-loading state; Finder and the loaded/expanded mobile route guide were also inspected manually.
