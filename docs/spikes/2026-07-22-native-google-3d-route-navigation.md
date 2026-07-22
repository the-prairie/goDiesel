# Native Google 3D route navigation spike

## Question

Can goDiesel use the native Google 3D Maps JavaScript API to turn a recorded route into a continuous, game-like navigation experience?

## Field tests

The spike uses route `14736711660` as an urban San Francisco test and route `14023448720` as a mountainous Crete test.

Both routes render as native `Polyline3DElement` threads over a `Map3DElement` photorealistic world.

The lab provides runner, chase, and overview cameras, continuous playback, scrubbing, speed control, zoom, manual camera control, and ground-versus-mesh route placement.

## Findings

The architecture works in both field tests.

San Francisco proves that a camera can move continuously at street scale while keeping a real GPS route visible inside photorealistic urban geometry.

Crete proves that the same system can present a route against coast, elevation, and mountain terrain without changing visual providers.

The runner camera creates the strongest sense of direct movement, but photogrammetry can look distorted at very low altitude.

The chase camera is the most consistently legible navigation view because it retains terrain and place context while staying close to the route.

The overview camera is useful for orientation and route selection, but it is not the immersive experience by itself.

`CLAMP_TO_GROUND` and `RELATIVE_TO_MESH` both keep the route tied to the rendered world.

Mesh placement is the stronger default for photorealistic replay because it follows the visible 3D surface.

Recorded GPS drift and imperfect source photogrammetry remain visible, especially near buildings and route start points.

Native Google 3D Maps is substantially simpler than the Cesium integration for this narrow experience because camera and route geometry share the same provider runtime.

Earth Engine remains useful for route intelligence and editorial context, but it does not need to participate in frame-by-frame immersive playback.

The live provider requires a hardware-accelerated browser.

Headless Chromium displays Google's unsupported 3D map state, while headed Chromium and the in-app browser render both routes successfully.

The browser key must allow the exact local or deployed origin.

The current local key allows `http://localhost:8787` but rejects the equivalent `127.0.0.1` preview origin.

## Recommendation

Proceed with native Google 3D Maps as the preferred immersive route runtime.

Use chase as the initial camera, runner as an intentional close-view option, and overview as the entry and reset view.

Default the route to mesh placement and preserve ground placement as a diagnostic fallback.

Keep the experience continuous and provider-stable rather than mixing Street View, satellite panels, and personal photos during playback.

The next product slice should replace the lab controls with the shared replay HUD, add route-aware camera altitude tuning, and introduce a visible current-position marker that does not obscure the thread.

Do not replace the existing replay yet.

Run this implementation beside it until a broader route scorecard shows that the native world is usable across most of the atlas.

## Verification

- TypeScript typecheck passed.
- Controller unit tests passed.
- Route-intelligence navigation E2E passed.
- Headed live-provider E2E passed for San Francisco and Crete.
- In-app browser screenshots confirmed nonblank photorealistic rendering, route visibility, playback motion, and runner, chase, and overview camera behavior.
