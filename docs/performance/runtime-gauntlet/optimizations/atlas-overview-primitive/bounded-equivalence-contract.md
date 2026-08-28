# Atlas overview primitive bounded-equivalence contract

This contract was fixed before committing the final overview renderer implementation.
It covers only the global Atlas overview.
Selected-region rendering remains on the existing ground-clamped, classified, pickable Entity path.

## Inputs and scale

The comparison uses two distributions.

- The production distribution contains every current generated route once.
- The scale distribution contains 2,500 distinct source-derived traces.

Each scale trace preserves a real source trace's point count, point order, and shape under a rigid latitude/longitude translation.
Every scale trace must have a unique sampled geometry key, and the renderer must submit one geometry instance for every renderable route.

## Domain budgets

- Horizontal spatial deviation at every retained source vertex: exactly 0 metres between the Entity control and primitive candidate inputs.
- Endpoint preservation: exact first and final sampled coordinates for every route.
- Segment-boundary preservation: exact sampled point sequence and boundaries for every route.
- Route-order preservation: exact region order, route order, and vertex order.
- Route identity and provenance: unchanged.
- Regional terrain classification, picking, selection, and styling: unchanged.
- Global altitude semantics: the overview is an ellipsoid-level route locator and does not claim recorded elevation or terrain adherence.

## Visual budgets

The deterministic fixture must capture the direct WebGL canvas at the global, east, and west camera positions on desktop and mobile.
Route masks exclude the globe rim and use the production cobalt route color.

- Bidirectional route-mask Hausdorff distance: at most 3 physical pixels at every camera.
- Route-pixel count ratio, candidate divided by control: 0.80 through 1.20 at every camera.
- Occupied-cell Jaccard overlap on a 48 by 24 grid: at least 0.80 at every camera.
- Visible route pixels: more than 100 at every camera.
- Current production route distribution: the same budgets apply at every camera.

## Interaction and accessibility budgets

- Atlas labels, controls, accessible names, keyboard behavior, URL state, and responsive layout: exact existing Playwright assertions on desktop and mobile.
- Camera reset destination, heading, pitch, input behavior, and selected-region target: exact existing unit and Playwright assertions.
- Global overview readiness: reported only after the primitive is ready and the route mask is present.
- Regional route selection: exact existing selected-route and region behavior.

## Performance acceptance

The control and candidate must run from clean exact commits on the same machine, operating system, Node, Chromium, and Cesium versions.
Each distribution requires warm-up plus at least five recorded repetitions per desktop and mobile project.
The candidate must materially improve route-ready action latency without moving the cost into wall time, heap, or post-readiness main-thread work.
The 2,500-route evidence must report route count, unique sampled geometry count, and submitted geometry count separately.

## Required approvals

A fresh domain critic must approve route truth, regional behavior, and the stated global altitude semantics.
A fresh visual and accessibility critic must approve the captured control/candidate artifacts and the test mapping.
The pull request remains draft until all applicable live-provider checks pass.
