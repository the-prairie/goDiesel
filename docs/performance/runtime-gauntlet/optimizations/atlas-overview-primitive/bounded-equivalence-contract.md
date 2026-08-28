# Atlas overview primitive bounded-equivalence contract

This contract covers only the global Atlas overview.
Selected-region rendering remains on the existing ground-clamped, classified, pickable Entity path.

## Inputs and scale

The comparison uses two distributions.

- The production distribution contains all 66 completed generated routes once.
- The scale distribution contains 2,500 distinct source-derived traces and cycles through all 67 generated route summaries as shape sources.

Each scale trace preserves its source trace's point count, point order, and shape under a rigid latitude/longitude translation.
Every scale trace must have a unique sampled geometry key, and the renderer must submit one geometry instance for every renderable route.
No exact-coordinate deduplication or coincident-trace suppression is allowed.

## Domain budgets

- Horizontal spatial deviation at every retained source vertex: exactly 0 metres between the Entity control and Primitive candidate inputs.
- Endpoint preservation: exact first and final sampled coordinates for every route.
- Segment-boundary preservation: exact sampled point sequence and boundaries for every route.
- Route-order preservation: exact region order, route order, and vertex order.
- Route identity and provenance: unchanged.
- Regional terrain classification, picking, selection, and styling: unchanged.
- Global altitude semantics: explicit 10,000 metre ellipsoid-relative locator height with no recorded-elevation or terrain-adherence claim.

The explicit overview height prevents ellipsoid-level route pixels from fighting the globe surface.
It changes only the locator's vertical presentation; longitude, latitude, point order, and regional ground-clamped behavior remain exact.

## Visual budgets

The deterministic fixture captures the direct WebGL canvas at global, east, and west camera positions on desktop and mobile for both distributions.
Route masks use the production cobalt route color.
The candidate material is opaque to avoid overlap saturation.

- Bidirectional route-mask Hausdorff distance: at most 6 physical pixels at every camera.
- Route-pixel count ratio, candidate divided by control: 0.80 through 1.20 at every camera.
- One-cell-dilated occupied-cell Jaccard overlap on a 48 by 24 grid: at least 0.80 at every camera.
- Visible route pixels: more than 100 at every camera.
- Candidate route-adjacent near-black pixels: at most 5 at every camera.
- Candidate enclosed near-white pixels: at most 5 at every camera.

The initial raw occupancy comparison was rejected because a passing pixel-space displacement can cross a sparse grid boundary.
The final evidence retains raw Jaccard and applies one-cell dilation for acceptance while also retaining the stronger Hausdorff check.
The opaque stroke width was calibrated before the final measured run; the evidence budgets were not widened to make that calibration pass.

## Interaction and accessibility budgets

- Atlas labels, controls, accessible names, keyboard behavior, URL state, and responsive layout: exact existing Playwright assertions on desktop and mobile.
- Camera reset destination, heading, pitch, input behavior, and selected-region target: exact existing unit and Playwright assertions.
- Global overview readiness: reported only after the Primitive is ready and four route-mask samples are stable.
- Regional route selection: exact existing selected-route and region behavior.
- Failed or superseded regional construction: staged Entities are removed atomically and the global Primitive is restored.

## Performance acceptance

The control and candidate run from clean exact commits on the same machine, operating system, Node, Chromium, and Cesium versions.
Each side runs one explicit warmup followed by five recorded repetitions for desktop and mobile.
The 2,500-route evidence reports route count, unique sampled geometry count, and submitted geometry count separately.
The committed evidence also reports settled heap, peak observed heap, total sample wall time, post-readiness task duration, frame p95 availability, estimated p95 FPS, long-task count, and total long-task duration.

This optimization must materially improve route-ready action latency and total post-readiness task duration without increasing settled or peak heap.
It does not by itself satisfy the runtime gauntlet's final frame-time target.

## Required approvals

A fresh domain critic must approve route truth, regional behavior, and the stated global altitude semantics.
A fresh standards critic must approve the captured control/candidate artifacts, privacy treatment, visual-purity checks, and test mapping.
The pull request remains draft until the configured live-provider Atlas suite passes.
