# Current truth specification

This specification freezes the behavior and data contract against which runtime optimizations are judged.

## Current data set

At the branch base:

- `routes.manifest.json`: 498,249 bytes;
- 67 route summaries;
- 66 completed routes and 1 discovered route;
- 62 Runs and 5 Rides;
- 29 free-text regions;
- every current summary trace has 96 points;
- 67 lazy detail records totaling 4,315,431 bytes;
- `quests.generated.json` is 4,315,712 bytes and is not imported by the application.

Counts are baseline metadata, not hardcoded product rules.

## Preserved user-observable behavior

### Application and routing

- The root canonicalizes to `#/atlas`.
- Atlas, Finder, Routes, route detail, Replay, and Admin retain their canonical URLs.
- Browser history, Atlas return state, selected region, selected route, Routes filters, and Finder intent remain restorable.
- Replay and route detail remain lazy-loaded.

### Route data

- Summary parsing remains lenient and isolates malformed records.
- Detail parsing remains strict and reports invalid data rather than drawing plausible output.
- Route order, lifecycle, activity type, region label, summary metrics, guide preview, trace coordinates, and replay metadata remain identical during exact-isomorphic work.
- Full route details are fetched only when selected and request deduplication remains per slug.

### Atlas

- Cesium remains the production global and regional world.
- The global world works without provider credentials using bundled Natural Earth imagery.
- Region selection preserves URL and route selection state.
- Regional Google Photorealistic 3D Tiles remain an optional credentialed enhancement.
- Provider and render failure converge on the named MapLibre regional fallback.
- Global and regional route threads remain selectable and preserve their current visual meaning.
- Keyboard, pointer, touch, wheel, search, carousel, and reduced-motion behavior remain intact.

### Finder

- Finder returns only the current owner-curated route-backed candidates.
- Place, activity, distance tolerance, terrain, and vibe matching preserve exact current membership and result order.
- Unsupported searches remain honest and do not fabricate routes.
- This gauntlet may improve the data structure and scalability of matching but may not broaden the candidate product model.

### Routes

- Search and all filters preserve exact membership and order.
- URL canonicalization, progressive reveal, return scroll, empty states, and planned-route composition remain unchanged.
- Route detail JSON is not fetched merely to render or filter the library.

### Replay

- Native Google Maps 3D remains the primary renderer.
- `?renderer=cesium` and `?renderer=atlas` remain explicit alternatives.
- Recorded route geometry and provenance drive playback.
- Camera, telemetry, route-thread reveal, grounding, and named degradation retain their current output for the same state.
- Destroying Replay releases its renderer and listeners.

### Accessibility and visual contract

- Accessible names, landmarks, live regions, focus restoration, keyboard commands, reduced-motion behavior, and mobile touch targets remain unchanged or improve without altering meaning.
- Field-Guide design semantics and route-color meaning remain intact.
- A performance improvement may not hide route context, remove evidence, or reduce legibility to meet a metric.

## Exact-equivalence oracle

Exact-isomorphic commits must preserve:

- parsed current manifest JSON values and route order;
- `findRouteBySlug` results for every current slug and unknown slug;
- route-region membership, ordering, bounds, centers, and aggregates;
- Finder result IDs and order for the golden intent matrix;
- Routes filter result slugs and order for the golden filter matrix;
- `routePathPose` values within the existing numeric tolerance for boundary, interior, duplicate-distance, and out-of-range progress;
- Replay camera/telemetry snapshots for the current fixture matrix;
- current browser URLs, accessible names, and named failure states;
- current bundle constraints and lazy chunk boundaries.

Generated files should be byte-compared when the optimization claims not to affect generation. Parsed value equality is acceptable only when serialization is intentionally changed and separately approved.

## Bounded-equivalence rule

Geometry simplification, route batching, request-driven rendering, altered update frequency, and visual LOD are not exact-isomorphic by default. They require an approved error budget and separate visual/domain review before implementation.
