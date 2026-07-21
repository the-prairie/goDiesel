# Issue 86 Cesium Atlas Verification

## Scope

This report verifies the feature-flagged Cesium global Atlas while retaining the Three.js globe as the default fallback.

## Automated Gates

- TypeScript build passed.
- All 88 unit tests passed.
- The bundle budget passed with the Cesium world remaining lazy-loaded.
- The four deterministic Cesium Atlas end-to-end scenarios passed on desktop and mobile.
- All 37 existing Atlas end-to-end scenarios passed against the default Three.js world.

## Live Cesium Evidence

The live browser used `VITE_ATLAS_WORLD_ENGINE=cesium` against the real Cesium renderer and bundled Natural Earth imagery.

- The WebGL canvas rendered nonblank pixels at 1440 by 900 and 390 by 844.
- All 66 completed route threads were mounted.
- Collision management left five visible place labels on desktop and two on mobile in the tested view.
- Selecting Crete updated the URL, opened the matching region guide, and moved the shared camera target from 18,500 km to 6,500 km.
- Wheel zoom, pointer drag, keyboard navigation, and mobile pinch changed the same Cesium camera.
- No page errors or console errors were observed.
- A synthetic renderer failure restored the Three.js Atlas without losing the selected URL state.

## Screenshots

![Desktop Cesium Atlas](assets/issue-86/cesium-atlas-desktop.png)

![Mobile Cesium Atlas](assets/issue-86/cesium-atlas-mobile.png)

## Follow-up Boundary

Issue 87 owns geographic route bounds, close regional terrain, photorealistic tile activation, terrain clamping, and reduced-motion camera transitions.
