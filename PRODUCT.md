# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lauren is the owner and only user.
She uses goDiesel to revisit recorded running and cycling experiences, understand what happened on a route, and choose where to go next.

## Product Purpose

goDiesel is a personal, immersive atlas for running and cycling experiences.
It turns recorded activity history into an explorable atlas, source-honest route stories, future plans, and immersive route replays.
Success means a route feels like a remembered place while remaining faithful to the recorded evidence.

## Positioning

goDiesel joins one person's recorded route geometry, factual activity evidence, owner curation, and cinematic replay into a continuous personal atlas.
The route page is where story and geography become one experience rather than separate map and article views.

## Operating Context

The core loop is to plan an experience, complete the route, curate and preserve it, relive it through immersive replay, and use that memory to choose the next adventure.
The five canonical surfaces are Atlas, Finder, Routes, Replay, and Admin.
The route detail page is a field story for one completed or discovered route and is the deliberate entry point into Replay.

## Capabilities and Constraints

- Recorded activity files are the source of truth for geometry, distance, elevation, time, and activity metadata.
- Completed routes are memories; discovered routes are real imported geometry without owner experience; planned routes are future intent and are never presented as completed.
- User-visible evidence is labelled as recorded, derived, measured, or hypothesis.
- Geometry that is missing or invalid is not replaced with plausible invented geography.
- Route pages must preserve canonical URLs and the transition into Replay.
- Prototypes may change composition, hierarchy, interaction, color, typography, and motion, but must not invent route facts or editorial claims.

## Brand Commitments

The product name is goDiesel.
Its voice is personal, observational, concise, and willing to preserve the owner's original route titles.
Terrain is the primary canvas, route data is annotation, and interface chrome behaves like an editorial field guide.

## Evidence on Hand

- Canonical product and provenance rules live in `CONTEXT.md`.
- The visual system lives in `app/DESIGN.md` and `app/src/index.css`.
- Real route summaries and recorded geometry are generated from the private Strava export and source GPX/FIT files.
- Existing satellite and terrain providers may be used when available, but invented route imagery must not be presented as recorded evidence.

## Product Principles

1. Recorded data is truth; interpretation is visibly labelled.
2. Story and geography should feel inseparable on a route page.
3. The route page should invite immersion without obscuring factual evidence.
4. Replay is the natural continuation of a route story, not a disconnected tool.
5. Production craft includes responsive behavior, reduced motion, accessibility, and perceived performance.

## Accessibility & Inclusion

Interactive controls require visible keyboard focus and usable touch targets.
Body text and controls meet WCAG AA contrast.
Reduced-motion preferences disable decorative motion without hiding state changes or content.
