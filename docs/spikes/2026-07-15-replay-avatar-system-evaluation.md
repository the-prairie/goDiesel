# Replay Avatar System Evaluation

**Issue:** #46

**Decision date:** 2026-07-15

**Status:** Accepted

## Decision

Use custom dotLottie assets for the production runner and rider set in issue #47.

Keep native Cesium GLB rendering as an experimental path for a future world-grounded character system.

Do not adopt Rive Canvas Lite for production Replay avatars now.

The evaluation lab remains available from the Replay avatar menu and at `#/lab/avatar-evaluation/:routeSlug`.

It runs every candidate in the same Cesium route world with one shared play, pause, seek, speed, camera, route, and reduced-motion control surface.

## Evaluation Matrix

Scores use a five-point scale where five is the strongest fit for the current goDiesel product and architecture.

| Criterion | Custom dotLottie | Native Cesium GLB | Rive Canvas Lite |
| --- | ---: | ---: | ---: |
| Near, mid, and far visual quality | 4 | 4 | 2 |
| Terrain grounding and occlusion | 3 | 5 | 3 |
| Transparent avatar presentation | 5 | 5 | 1 |
| Route-synchronized animation control | 5 | 4 | 5 |
| Mobile stability | 5 | 4 | 4 |
| Local runtime and predictable network | 5 | 5 | 4 |
| Lifecycle and cleanup behavior | 5 | 5 | 5 |
| Evaluated asset provenance | 1 | 5 | 1 |
| Fit with the current Replay architecture | 5 | 3 | 2 |
| **Total** | **38 / 45** | **40 / 45** | **27 / 45** |

The totals are an unweighted comparison of the evaluated samples, not the production decision by themselves.

Native GLB scores highest on sample provenance and world grounding.

Custom dotLottie remains the recommended production system because route synchronization, mobile legibility, and compatibility with the existing Replay overlay are the priorities for issue #47.

Issue #47 must replace the unlicensed evaluation sample with original goDiesel assets before the recommendation is production eligible.

## What Was Built

The lab renders the archived evaluation-only dotLottie runner as a screen-space route avatar with exact frame control.

It renders the locally bundled `CesiumMan.glb` as a native Cesium primitive with a world model matrix, real scene occlusion, and distance-driven animation.

It renders the locally bundled `vehicles.riv` through Rive Canvas Lite with exact timeline scrubbing when a linear animation is present.

Rive WASM is self-hosted at `/riveStatic/rive.wasm`, and CDN fallback is disabled.

The native GLB path waits for `Model.readyEvent` before registering animations and removes the listener and model primitive during engine teardown.

## Visual Findings

### Custom dotLottie

The dotLottie avatar remained crisp and readable at all three camera ranges and on a 390 by 844 mobile viewport.

The overlay tracks the projected route point correctly but does not gain true scene occlusion or distance-based perspective.

That tradeoff is acceptable for the current game-like route marker because it preserves legibility while the route world moves beneath it.

### Native Cesium GLB

The GLB model is the only candidate with true placement inside the photorealistic world.

It naturally participates in camera perspective and scene occlusion.

The first live run exposed a real lifecycle defect because animation registration happened before Cesium marked the model ready.

Moving animation setup to `Model.readyEvent` fixed the failure, and the complete desktop matrix then passed.

The current sample is not a production-quality goDiesel character, and producing a polished runner and rider would require a 3D modeling, rigging, optimization, and attribution pipeline that the product does not otherwise need yet.

### Rive Canvas Lite

Rive provided exact timeline scrubbing, deterministic local playback, and a stable mobile canvas.

The official sample visibly retained its rectangular artboard and vehicle treatment, so it did not demonstrate a transparent professional route avatar.

More importantly, it adds a separate WASM runtime without improving world grounding over dotLottie.

The sample `.riv` file also has no separately published redistribution grant, which makes it evaluation-only.

## Five-Minute Benchmark

The final live Chromium benchmark ran for 404.611 seconds, including 100 fixed wall-clock seconds of moving replay per renderer plus setup, garbage collection, renderer transitions, and teardown.

It recorded six samples per renderer.

There were no page errors.

The document count stayed at two for every renderer.

The world canvas count stayed at one for native GLB and two for the overlay systems because dotLottie and Rive each own one additional avatar canvas.

DOM node growth was 72 nodes for dotLottie, one node for native GLB, and 11 nodes for Rive.

Retained JS heap grew by 127,216,684 bytes during the first dotLottie interval while the shared Cesium world streamed route tiles.

After that initial tile residency, retained heap changed by positive 937,892 bytes for native GLB and negative 835,336 bytes for Rive.

That pattern does not indicate renderer-specific retained growth.

The Google tileset root request count stayed at two before and after all three renderer intervals, proving that renderer switching preserved one Cesium world instead of rebuilding it.

All avatar runtime requests stayed on `http://127.0.0.1:8787`.

The only unique avatar resources requested during the benchmark were the local dotLottie JavaScript and WASM runtime, dotLottie file, GLB file, Rive JavaScript and WASM runtime, and Rive file.

There were no failed avatar requests or non-success avatar responses.

After leaving the lab and navigating out of Replay, the page contained zero canvases and zero Cesium viewers.

The current DOM node count and retained document count remained unchanged after an additional five-second settling period.

## Control Coverage

Deterministic E2E covers renderer switching without remounting the Cesium world, state preservation, play, pause, seek, playback speed, camera ranges, route changes, reduced motion, local-only asset requests, engine destruction, and 320px and 430px layouts.

Live E2E covers all three renderers at near, mid, and far ranges on desktop and all three renderers at near range on mobile.

Each overlay screenshot proves nonblank avatar pixels, and each native GLB state proves that the model reached ready or static animation state.

The final desktop live matrix passed in 8.3 minutes on the reviewed source.

The mobile matrix passed in 1.4 minutes with no horizontal overflow and minimum 44px control heights.

## Source And License Record

The evaluation asset record is stored beside the files in `app/public/avatar-lab/PROVENANCE.md`.

The dotLottie web runtime exposes direct frame, speed, pause, and destroy controls in the [LottieFiles methods documentation](https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/methods/).

The Rive runtime documents local WASM configuration, animation and state-machine discovery, timeline lifecycle, and `cleanup()` in the [Rive parameters documentation](https://rive.app/docs/runtimes/web/rive-parameters).

Rive documents Canvas Lite as its smallest Canvas runtime, with a 707 KB uncompressed and 222 KB compressed WASM binary, in its [runtime size reference](https://rive.app/docs/runtimes/runtime-sizes).

Cesium documents GLB loading, world model matrices, `readyEvent`, active animation, and destruction in the [Cesium Model reference](https://cesium.com/learn/cesiumjs/ref-doc/Model.html).

`CesiumMan.glb` is credited to Cesium and licensed under Creative Commons Attribution 4.0.

`vehicles.riv` is an official Rive runtime example with no separate asset redistribution license published alongside it.

The production dotLottie assets created for issue #47 must be original goDiesel work with their source and authorship recorded in the repository.

## Rejection Rationale

Rive is rejected because it duplicates the existing overlay role, adds a WASM runtime, requires a specialized authoring tool, and lacks acceptable provenance for the evaluated asset.

Native GLB is deferred because its immersion advantage is real, but a credible production result depends on a professional 3D character pipeline and more aggressive distance and mobile optimization.

Custom dotLottie wins this gate because it provides the strongest complete fit now without closing the door on native 3D avatars later.
