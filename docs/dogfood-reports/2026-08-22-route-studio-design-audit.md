# Route Studio design-system audit

Date: 2026-08-22
Status: implementation input

## Scope

This audit compares the Route Studio owner workflow with `app/DESIGN.md`, the field-guide tokens in `app/src/index.css`, and the current Atlas, Finder, Routes, and Admin patterns.

The implementation already uses the correct light mineral palette and shared `Button`/`Input` primitives in several places. The remaining problem is structural rather than a simple color mismatch: Route Studio still behaves and reads like a legacy Admin utility composed from equal border blocks, instead of a first-class owner workflow with a clear route, current decision, and visual payoff.

## Governing design contract

Route Studio is an Admin workflow, so it should retain utility-workspace density. It must still follow the field-guide contract:

- terrain or real route geography is the canvas;
- route data is the annotation;
- operational controls use Inter;
- route/place payoff may use Cormorant Garamond;
- forest is for actions, route/cobalt is for route history and profiles, coral is reserved for the selected route or current map point;
- controls are at least 44px on desktop and 48px on mobile;
- panels use restrained one-pixel boundaries and may not become nested cards;
- loading, disabled, warning, error, focus, and reduced-motion states remain explicit;
- unavailable source evidence must never be rendered as fabricated data.

## Current-flow findings

### 1. Route Studio entry and drop state — needs revision

Strengths:

- The source is described as checksum-addressed before inspection.
- The drop target is a single obvious action.
- The page uses semantic color tokens rather than a dark or neon treatment.

Issues:

- The page does not explain the journey after upload. A user cannot see that the workflow is Source → Inspect → Identify → Preview → Film → Save.
- The drop zone and staged-jobs ledger have equal visual weight even though upload is the primary first action.
- The header uses a generic utility title rather than the current field-guide hierarchy.
- Loading and empty states are plain border rows rather than stable, reusable owner-workspace states.

Recommendation:

Lead with a compact field-guide title and six-step journey. Make upload the initial hero action, then transition the same shell into recent routes and repair/health work rather than presenting unrelated blocks.

### 2. Source inspection — needs revision

Strengths:

- Multiple geometries are explicit.
- Timing and elevation availability are visible.
- Blocker, warning, and information findings are distinguished in copy.

Issues:

- `RouteSketch` draws decorative invented grid lines rather than real geography.
- It flattens `previewSegments` before drawing one polyline, visually bridging real segment boundaries.
- The geometry candidate list, route preview, elevation profile, and findings all compete at the same hierarchy level.
- Source receipt details are promoted too early instead of being progressively disclosed.

Recommendation:

Use a segment-aware geography component. Prefer an existing MapLibre primitive. If an SVG fallback remains, draw each segment independently, remove invented map lines, and clearly label it as a geometry-only preview. Lead with the selected route and blocker state; move source internals into a disclosure.

### 3. Identify route — needs revision

Strengths:

- The form asks only for facts that cannot safely be inferred.
- Owner completion and privacy are explicit decisions.

Issues:

- Raw `<select>` controls use `h-9` and fall below the design contract’s minimum target size.
- The form is a generic grid without a clear distinction between identity, owner relationship, and publication/privacy.
- Preview versus Replay consequences are not explained beside the completion choice.

Recommendation:

Use shared 44px/48px field controls. Group the form into Route identity, Your relationship, and Visibility. Explain that not-completed routes receive Preview/cinematic timing while completed routes may receive Replay/recorded timing.

### 4. Staged route and preview — needs revision

Strengths:

- Preview/Replay and cinematic/recorded timing language is visible.
- Elevation unavailable is shown explicitly.
- Interactive preview is available before promotion.

Issues:

- The route identity, route facts, preview action, film action, render action, and promotion action are presented as peers.
- The raw job status and checksum dominate the header despite being diagnostic information.
- The facts grid truncates values and applies capitalization indiscriminately.
- There is no clear current step or recommended next action.

Recommendation:

Lead with the route title/place and a current-step panel. Present one primary next action and keep optional cinema or diagnostic actions secondary. Move SHA, receipt, render evidence, and event history into disclosures.

### 5. Film and teaser — needs revision

Strengths:

- The teaser is a real route-specific artifact.
- The artifact can be played and opened.

Issues:

- The visual payoff appears below a filesystem-path status line.
- There is no poster or intentional preview frame.
- Render evidence and user-facing artifact metadata are not separated.
- Large MP4s require range streaming to behave like a real media surface.

Recommendation:

Treat the teaser as the culmination of the workflow: poster/hero, playback, duration/resolution/quality status, and clear actions. Put frame evidence, checksums, and provider diagnostics in an audit disclosure. Support HTTP byte ranges.

### 6. Health, errors, and rollback — needs revision

Strengths:

- Backend failures are explicit and retryable.
- Promotion rollback protects canonical output.

Issues:

- One unhealthy private route currently suppresses every healthy private route.
- The frontend suppresses owner-route loading errors.
- Error, warning, unavailable evidence, and repair-needed states use one-off visual treatments.
- Healthy routes can disappear without an owner-facing explanation.

Recommendation:

Introduce a shared semantic owner-status component and route-level health results. Keep healthy routes visible. Display concise warnings in Atlas, Finder, Routes, and Admin with a route-health repair destination.

### 7. Mobile and accessibility — needs revision

Issues visible from code:

- The metadata selects do not meet the mobile 48px target.
- Desktop sections mostly stack rather than recompose for mobile.
- Event history and diagnostics remain fully expanded.
- The primary next action is not sticky or consistently reachable.
- The route-sketch SVG provides only a title and no equivalent description of segment count or ambiguity.

Recommendation:

Use a mobile current-step header, full-width 48px controls, compact route facts, and progressive disclosure for receipts/events. Verify keyboard order, focus visibility, live-region announcements, reduced motion, 390×844, and one short-height viewport.

## Required implementation outcomes

1. A shared Route Studio workflow model drives progress, labels, and primary action.
2. A segment-aware geography component replaces the decorative flattened sketch.
3. All form controls meet 44px desktop and 48px mobile targets.
4. Route title/place receives restrained editorial treatment; operational content remains Inter.
5. Source receipts, SHA values, render evidence, and events move into accessible disclosures.
6. Semantic owner-status UI is reused for information, unavailable evidence, warning, error, success, and repair-needed states.
7. The teaser becomes the visual payoff with poster, playback, metadata, and range serving.
8. Mobile receives a deliberate composition rather than a simple vertical stack.
9. Before/after desktop and mobile screenshots are captured from the deterministic flow.
10. Accessibility limits that screenshots cannot prove are documented alongside keyboard and Playwright checks.

## Evidence limits

This initial audit is code- and contract-grounded. The implementation pass must capture and inspect real before/after screenshots for every critical state before claiming visual completion or accessibility compliance.
