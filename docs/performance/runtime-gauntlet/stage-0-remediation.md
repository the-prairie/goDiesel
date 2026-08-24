# Stage 0 baseline remediation

This document records the correction boundary for the runtime performance harness after independent review.

## Corrected measurement semantics

- `activeContexts` counts only connected, non-lost WebGL contexts at the sample boundary.
- `totalContextsCreated` is retained as a lifetime diagnostic and is never used as an active-renderer oracle.
- Route detail intentionally owns one MapLibre WebGL context. The transition guard waits for the Route briefing and map settlement, then requires exactly one active context on route detail, Replay, and Atlas. A zero-context route-detail assertion would contradict the production renderer rather than prove cleanup.
- Every independent product surface runs in a fresh browser context and document.
- Resource timing is cleared at each action and observation boundary.
- CDP counters are reported as phase deltas, not page-lifetime totals.
- `actionLatencyMs` stops at an explicit readiness oracle.
- `observationWindowMs` is recorded separately and is not included in action latency.
- Action and observation resources, frame intervals, long tasks, React commits, and CDP deltas are reported separately.

## Corrected corpus semantics

- Scale corpora are passed explicitly to pure benchmark helpers; production singleton arrays are not mutated.
- The 2,500-route corpus cycles through every real generated route summary and preserves each source route's trace and measured/editorial attributes. Only fixture identity changes.
- The 10,000-candidate Finder corpus cycles through every current owner-curated candidate.
- The pure Finder provider is required to equal the current production provider on the canonical real-corpus intent.
- A benchmark-only Vite page renders the production Cesium Atlas component with the 2,500-route source-backed corpus on desktop and mobile.

## Required current-head evidence

The corrected run must produce and retain:

- the deterministic Node report;
- isolated desktop and mobile browser reports;
- 20-cycle active-context and heap evidence;
- reduced-motion Atlas and Replay samples;
- the 2,500-route Atlas rendering sample;
- explicit hosted-CI live-provider unavailability;
- a green typecheck and `git diff --check`.

No production optimization begins until this corrected Stage 0 packet is green and committed.
