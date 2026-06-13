---
date: 2026-06-13
topic: earth-replay-lab
---

# Earth Replay Lab Requirements

## Summary

Build an isolated `?lab=earth` route viewer that turns a real goDiesel route into a continuous photorealistic 3D world. The first version should prove that route playback, scrubbing, and camera follow can work over Google Photorealistic 3D Tiles without destabilizing the current MapLibre atlas.

---

## Problem Frame

The current atlas has the right product instinct but still exposes the seams between visual sources. MapLibre gives route continuity, Street View gives ground-level realism, and personal photos have already proven too noisy when they are not reliably geolocated. The user wants something closer to Google Earth or Project Genie: a believable route world that moves through the real place instead of switching between unrelated panels.

The spike in `docs/spikes/2026-06-13-google-earth-route-navigation.md` confirms the key technical premise: the current Google project can access the Photorealistic 3D Tiles root tileset. That means the next product question is not whether a real Earth-style route world is possible, but whether a focused prototype can make one route feel smooth, legible, and worth building on.

---

## Key Decisions

- **Earth is a lab mode first.** The first experience lives behind `?lab=earth` so it can be evaluated without replacing the working atlas.
- **Photorealistic 3D is the primary visual source.** The Earth lab should not split the screen between map, satellite, Street View, and photos during normal playback.
- **Street View is secondary.** Ground imagery may become a later windshield moment, but it is not required for the first Earth Replay Lab requirements.
- **The prototype is desktop-first.** Mobile support can be a deliberate fallback state while performance and interaction quality are being validated.
- **Route truth beats visual embellishment.** The route line, marker, distance, climb, and playback state must stay grounded in the existing route trace.
- **Use one canonical route first.** The first acceptance route is `13935098460`; broader route coverage is a follow-up validation pass.
- **Fallback includes both explanation and escape.** When Earth mode fails, the user should get a clear unavailable state and a path back to the standard atlas.

---

## Actors

- A1. Route owner reviewing a real Strava route and deciding whether it feels vivid enough to keep.
- A2. Quest explorer previewing a route before deciding whether to run or ride it.
- A3. Builder validating whether Earth mode is strong enough to become the future primary route view.

---

## Requirements

**Route World**

- R1. The Earth lab must render a photorealistic 3D world for a selected quest route when opened with a route deep link and `?lab=earth`.
- R2. The Earth lab must draw the selected route as a visible route layer above the 3D world.
- R3. The Earth lab must show the current route position as playback progresses.
- R4. The Earth lab must preserve existing route facts such as route name, distance, climb, activity type, and objective.

**Playback and Camera**

- R5. Play and pause must move the current position and camera along the route rather than only moving a progress number.
- R6. Scrubbing must update the Earth view to the corresponding route position.
- R7. The default camera should feel like a guided route preview, looking along the route with enough height to understand surrounding terrain.
- R8. Camera movement must prioritize smoothness and legibility over dramatic motion.
- R9. The viewer must avoid sudden source changes during normal playback.

**User Interface**

- R10. The Earth lab must keep the existing bottom playback controls available in the Earth experience.
- R11. The Earth lab must make it clear when the user is in experimental Earth mode.
- R12. The Earth lab must provide a clear way back to the standard atlas or quest list.
- R13. The route surface must avoid bringing back the personal photo strip or default photo cards.

**Fallbacks and Honesty**

- R14. If the 3D world cannot load, the app must fail into an intentional fallback rather than showing a blank or broken canvas.
- R15. If the device or viewport is not suitable for the first Earth prototype, the app may show a desktop-first message instead of attempting a degraded mobile experience.
- R16. The prototype must not represent a map inset or terrain-map crop as photorealistic ground imagery.

---

## Key Flows

- F1. Deep-link route replay
  - **Trigger:** A user opens a route link with `?lab=earth`.
  - **Actors:** A1, A2.
  - **Steps:** The route detail loads, Earth mode initializes, the route appears over the photorealistic world, and the camera frames the start of the route.
  - **Outcome:** The user can immediately understand the place, route, and playback state.
  - **Covered by:** R1, R2, R3, R4, R11.

- F2. Guided playback
  - **Trigger:** A user presses play in Earth mode.
  - **Actors:** A1, A2.
  - **Steps:** The current position advances, the route progress updates, and the camera follows along the route with smooth motion.
  - **Outcome:** The route feels like a moving preview through the real world.
  - **Covered by:** R5, R7, R8, R9, R10.

- F3. Scrub and inspect
  - **Trigger:** A user drags the route progress control.
  - **Actors:** A1, A2.
  - **Steps:** The current route position changes, the marker updates, and the Earth camera moves to the matching route segment.
  - **Outcome:** The user can inspect any part of the route without leaving Earth mode.
  - **Covered by:** R3, R6, R8.

- F4. Graceful fallback
  - **Trigger:** Earth mode cannot load the photorealistic world or the environment is unsuitable.
  - **Actors:** A1, A2, A3.
  - **Steps:** The app shows an intentional fallback state and keeps navigation available.
  - **Outcome:** The user understands that Earth mode is unavailable rather than thinking the route is broken.
  - **Covered by:** R12, R14, R15, R16.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a supported desktop browser, when a user opens `?lab=earth#quest/13935098460`, then the Earth world loads, the route is visible, and the current route position is represented in the world.
- AE2. **Covers R5, R6, R8.** Given Earth mode is loaded, when the user presses play and then scrubs to the middle of the route, then the marker, distance, and camera all update without stepped jumps.
- AE3. **Covers R9, R13, R16.** Given Earth playback is running, when the route reaches a point without Street View imagery, then the app continues in the same Earth world and does not swap to personal photos or a map-cam pretending to be ground imagery.
- AE4. **Covers R14, R15.** Given the 3D world cannot initialize, when the user opens Earth mode, then the app shows an intentional fallback with a path back to the standard atlas.

---

## Success Criteria

- The Earth lab can be opened from a route deep link without breaking the existing atlas.
- A 30-second playback sample moves the marker, route distance, and camera together.
- Scrubbing feels continuous enough that the route does not appear to jump segment-by-segment.
- The visual experience reads as one primary world source.
- No personal-photo UI appears in Earth mode.
- Failure states are understandable without opening the browser console.

---

## Scope Boundaries

Deferred for later:

- Street View windshield moments inside Earth mode.
- Route trailer or shareable video export.
- Mobile-first Earth playback.
- Full replacement of the current MapLibre atlas.
- Quest gameplay effects beyond a simple route layer and current-position marker.

Outside this product's identity for this pass:

- AI-generated fake terrain or invented route imagery.
- A general-purpose Google Earth clone.
- A route viewer that prioritizes cinematic spectacle over route truth.

---

## Dependencies / Assumptions

- The Google project remains authorized for Photorealistic 3D Tiles and the relevant production domains.
- The current route traces remain the source of truth for playback position and distance.
- The prototype can depend on a desktop-class browser while the interaction model is being validated.
- Cost and quota evaluation can happen before production release, not before the first local prototype.

---

## Outstanding Questions

- Exact camera height, pitch, lookahead, and smoothing constants.
- Exact library loading strategy and bundling approach for a static generated app.
- Exact billing guardrails and key restriction checks.

---

## Sources / Research

- `docs/ideation/2026-06-13-google-earth-route-world-ideation.html`
- `docs/spikes/2026-06-13-google-earth-route-navigation.md`
- `docs/dogfood-reports/2026-06-13-clanker-quest-atlas-dogfood.md`
- `build.py`
- Google Maps Platform: Photorealistic 3D Tiles - `https://developers.google.com/maps/documentation/tile/3d-tiles`
- Google Maps JavaScript API: 3D Maps overview - `https://developers.google.com/maps/documentation/javascript/3d/overview`
- CesiumJS guide: Photorealistic 3D Tiles from Google Maps Platform - `https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/`
