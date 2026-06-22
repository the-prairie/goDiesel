---
date: 2026-06-21
topic: godiesel-react-migration
---

# goDiesel React Migration Requirements

## Summary

Migrate goDiesel from a static Python-generated prototype into a React, TypeScript, Tailwind, and shadcn/ui app with the Globe as the default home. The product should separate `Atlas` for completed route memories from `Finder` for planning future routes, while preserving the current Earth Replay direction.

---

## Problem Frame

The static prototype proved the route atlas concept, MapLibre/Google/Cesium capabilities, Earth Replay, route heatmaps, Lottie avatars, and route curation. It also concentrated too much product, state, layout, and rendering logic inside `build.py`, making foundational UI work harder with each iteration.

The product direction is now clearer. goDiesel should not be only a historical map of completed Strava routes. It should become a personal route atlas that remembers completed routes and helps plan future routes that can later be uploaded back into the globe.

---

## Key Decisions

- **Globe is the default app home:** The first app screen should be a globe-based route surface, not the card gallery.
- **Atlas and Finder are separate modes:** `Atlas` answers "where have I been?" and `Finder` answers "where should I run next?"
- **Use a real component app:** The next foundation should be React, TypeScript, Tailwind, and shadcn/ui rather than more custom generated HTML inside `build.py`.
- **Preserve Earth Replay behavior:** The React migration should port the existing Earth Replay experience before attempting new replay product ideas.
- **Keep the static app as the fallback until parity:** The current generated site remains runnable while the React app reaches functional parity.

---

## Actors

- A1. **Runner owner:** Lauren, using the app to remember completed runs and rides, replay them, plan new routes, and import future completions.
- A2. **Future user:** A runner who wants a low-friction way to discover route ideas, save plans, complete them, and build a personal route atlas.
- A3. **Route data source:** Current local route exports, generated quest metadata, future Strava imports, and future route planning sources.

---

## Requirements

**Application Shell**

- R1. The app opens to the Globe by default.
- R2. The app has persistent primary navigation for `Atlas`, `Finder`, `Routes`, `Replay`, and `Admin`.
- R3. The navigation model supports direct links to route detail pages without requiring URL hand-editing.
- R4. The app keeps a clear path back to all routes from any route detail or replay screen.

**Atlas Mode**

- R5. `Atlas` shows completed routes as route heat/traces on the globe, not as oversized dots.
- R6. `Atlas` search finds completed routes, route regions, replay-worthy memories, and route patterns.
- R7. Selecting a completed route opens the existing route detail and Earth Replay flow.
- R8. Completed route state remains visually distinct from planned or discovered route state.

**Finder Mode**

- R9. `Finder` is a top-level mode focused on planning future routes.
- R10. `Finder` search supports place, distance, terrain, route similarity, and trip-style queries.
- R11. Finder results distinguish suggested routes from saved planned routes.
- R12. A suggested route can be saved as a planned route without marking it completed.

**Route Lifecycle**

- R13. The product supports the route lifecycle `Discovered -> Planned -> Completed -> Replay`.
- R14. Completed routes remain grounded in real activity data.
- R15. Planned and discovered routes must not visually imply completion.
- R16. Future imports from Strava or GPX can promote planned routes into completed Atlas routes.

**Migration and Design System**

- R17. The migration establishes a configured shadcn/ui project rather than manually copying registry blocks into the static prototype.
- R18. The app uses TypeScript types for route data, route lifecycle state, replay mode, and region grouping.
- R19. The new app should initially consume the existing generated route data before introducing a backend.
- R20. The current Earth Replay behavior remains available during migration.

---

## Key Flows

- F1. Atlas memory search
  - **Trigger:** The user opens the app.
  - **Actors:** A1.
  - **Steps:** The app shows the Globe in `Atlas`; the user searches completed route history; matching regions and routes highlight; the user opens a completed route.
  - **Outcome:** The user reaches route detail or Earth Replay for a completed route.
  - **Covered by:** R1, R5, R6, R7.

- F2. Finder route planning
  - **Trigger:** The user switches to `Finder`.
  - **Actors:** A1, A2.
  - **Steps:** The user searches for a future route by place, distance, terrain, or similarity; the app shows candidate routes; the user saves one.
  - **Outcome:** The candidate becomes a planned route, not a completed Atlas memory.
  - **Covered by:** R9, R10, R11, R12, R15.

- F3. Planned route completion
  - **Trigger:** The user completes a planned route and imports activity data.
  - **Actors:** A1, A3.
  - **Steps:** The app matches imported route data to a planned route; the route moves into completed state; the route appears in `Atlas`.
  - **Outcome:** The completed route can be replayed and contributes to globe heat.
  - **Covered by:** R13, R14, R16.

---

## Acceptance Examples

- AE1. Atlas default
  - **Covers R1, R2, R5.**
  - **Given** the user opens the app root
  - **When** no route deep link is present
  - **Then** the Globe opens in `Atlas` mode with completed route traces visible.

- AE2. Finder does not mutate history
  - **Covers R9, R11, R12, R15.**
  - **Given** the user searches for a new route in `Finder`
  - **When** the user saves a result
  - **Then** the route is marked planned and does not appear as completed route heat.

- AE3. Route replay parity
  - **Covers R3, R7, R20.**
  - **Given** the user opens a completed route from `Atlas`
  - **When** the route detail loads
  - **Then** the existing Earth Replay behavior remains available.

---

## Success Criteria

- The app has a clear mental model: `Atlas` is past, `Finder` is future.
- The Globe feels like the primary product surface rather than a background behind panels.
- The React migration reduces the amount of product UI that must be edited in `build.py`.
- Earth Replay still works after route detail is migrated.
- The shadcn setup can add registry components through normal CLI flows.

---

## Scope Boundaries

Deferred for later:

- Live Strava OAuth import.
- Real route recommendation APIs.
- Multi-user social quests.
- Backend persistence beyond local/static data.
- Paid travel booking, hotels, or logistics integrations.

Outside this product's identity:

- Fake AI-generated routes presented as real completed activity.
- A generic mapping product unrelated to running, riding, and route memories.
- A route planner that hides whether a route is completed, planned, or discovered.

---

## Dependencies / Assumptions

- The current route data in `quests.json` remains the initial source of truth.
- The current Earth Replay work remains the route replay reference during migration.
- shadcn/ui is adopted after the new React app is configured with `components.json`, Tailwind, and TypeScript.
- The first migration milestone can coexist with the current static app.

---

## Sources / Research

- `README.md` documents the current Python/static build, deployable `dist/` folder, local route curation, and Google Maps key requirements.
- `docs/plans/2026-06-13-001-feat-earth-replay-lab-plan.md` defines the current Earth Replay behavior and fallback expectations to preserve.
- `test_static_ui.py` captures many current UI contracts, including Earth Replay, route heat traces, Lottie avatars, and Globe navigation.
