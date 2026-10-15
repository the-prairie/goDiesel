# goDiesel Experience Audit

Date: 2026-08-11

Lens: reduction, emotional truth, continuity, and removing anything that weakens the core experience.

This is not an imitation of Rick Rubin.
It applies a similar creative discipline: identify the essential feeling, protect it, and subtract the rest.

## Executive Read

The product has discovered its real idea in the Daydream prototype: a route is a memory attached to a place, and replay is the final expression of that memory.

The current production application communicates a different idea: a route is a record to filter, inspect, and operate.

Both ideas can coexist, but they should not have equal visual authority.
The personal atlas should be the product.
Finder, the library, and admin should support it quietly.

The largest experience problem is the abrupt change of product identity between the Daydream story flight and the live Google 3D replay.
The user moves from an authored, intimate, cinematic memory into a dense operational dashboard with a persistent sidebar, crowded telemetry, and different typography, color, spacing, and control philosophy.

## Walkthrough

### 1. Daydream regional atlas

Health: Strong.

The zoomed regional globe is a more distinctive starting point than a generic global globe.
It answers the emotional question, "where have I lived something?"
The route lens is legible, and the region rail makes geography navigable without turning the experience into a database.

The featured route card and the region rail compete for the same next action.
The card should be the authored recommendation, while the rail should remain a quiet destination switcher.
The labels "Regional globe" and "Open region" are functional but generic.
The language should describe the experience being entered, such as "Enter Crete" or "Explore eight routes."

Evidence: [01-daydream-start.png](01-daydream-start.png), [17-mobile-daydream.png](17-mobile-daydream.png)

### 2. Terrain lens

Health: Promising.

Terrain becomes useful when it tells a story rather than merely changing the map style.
"Most vertical," "Highest trace," and "Softest line" are excellent because they turn measurements into reasons to explore.

The selected route line changes too subtly relative to the large reading panel.
Choosing a terrain story should create an unmistakable spatial response: isolate the route, tilt or reframe the terrain, and let the selected statistic travel along the line.
The panel should feel like a guided observation, not a metrics menu.

Evidence: [02-daydream-terrain.png](02-daydream-terrain.png)

### 3. Regional route collection

Health: Good structure, passive geography.

The right-side collection is clear and the route cards have personality.
The user can scan title, difficulty, distance, climb, and chapter count without opening every route.

The map becomes almost inert at the moment route comparison should become spatial.
Hovering, focusing, or selecting a card should isolate its line, fit its bounds, and reveal one distinguishing terrain fact.
This would let the map answer, "how is this route different?" while the card answers, "why might I care?"

On mobile, the single-row story shelf is elegant, but its tiny scrollbar feels like desktop residue.
Use a partial next card, snap behavior, and a simple count instead.

Evidence: [03-daydream-route-collection.png](03-daydream-route-collection.png), [18-mobile-route-collection.png](18-mobile-route-collection.png)

### 4. Route dossier

Health: Strong information design.

This is the best bridge between browsing and story.
The hero image, personal title, field note, core facts, terrain profile, and chapter thumbnails create enough confidence to enter.

The dossier should be a modal layer over the geography rather than a permanent sidebar state.
Opening a route should visually bind the photo, the selected line, and its chapters.
"Read the route story" is correctly primary.
"Open live replay" should stay secondary until the live replay shares the same visual language.

Evidence: [04-daydream-route-dossier.png](04-daydream-route-dossier.png)

### 5. Editorial route story

Health: Excellent direction.

This is the clearest expression of the product's emotional value.
The personal title, imperfect field note, scale, restrained metadata, and large landscape give the route dignity without making it feel like marketing.

The prose becomes generic when it describes any route rather than this route.
The strongest raw material is already present in the user's title, notes, photos, timing, elevation, and repairs.
Each chapter should surface one specific remembered fact and one spatial moment.

The mobile composition is especially strong.
The full-bleed image, readable hierarchy, and visible next section create the most production-ready screen in the app.

Evidence: [05-daydream-editorial-story.png](05-daydream-editorial-story.png), [19-mobile-editorial-story.png](19-mobile-editorial-story.png)

### 6. Cinematic story flight

Health: Visually strong, interaction meaning is incomplete.

The chapter timeline is the right control model.
It gives replay an authored rhythm and makes the route legible as five remembered moments instead of an undifferentiated recording.

The image, route trace, chapter title, telemetry, and timeline all compete as the focal point.
Choose one dominant layer per phase.
At rest, the chapter and place should dominate.
During playback, chrome should fade and the moving route should dominate.
On interaction, the timeline should return.

The mobile chapter controls have no accessible names in the rendered accessibility tree.
They need stable labels even when visible text is removed.

Evidence: [06-daydream-cinematic-replay.png](06-daydream-cinematic-replay.png), [20-mobile-cinematic-replay.png](20-mobile-cinematic-replay.png)

### 7. Live Google 3D replay

Health: Functionally rich, emotionally disconnected.

The 3D terrain and actual route are the most valuable production capabilities in the application.
The surrounding interface hides that strength.
The permanent product sidebar, dense top bar, hard black telemetry dock, tiny camera icons, and operational terminology make the experience feel like a monitoring console.

The live replay should inherit the story flight shell.
Keep the real 3D renderer, route progress, camera modes, repair markers, and speed controls.
Replace the product chrome with chapter-based progressive disclosure and a quiet exit back to the route story.

On mobile, telemetry labels overlap, the route title truncates, and the bottom control density exceeds the available width.
This is the highest-priority responsive defect.

Evidence: [07-live-replay.png](07-live-replay.png), [24-mobile-live-replay.png](24-mobile-live-replay.png)

### 8. Production Atlas

Health: Capable but emotionally flat.

The globe is technically impressive and the route-region dock works.
The global view is generic, while the regional view is much more useful.
The Daydream regional model should become the primary Atlas experience, with the globe retained as an overview or escape hatch.

The production regional dock contains good route data but reads like a carousel of inventory.
It should borrow the Daydream cards and reveal one route at a time as a memory with a clear spatial highlight.

Evidence: [08-production-atlas.png](08-production-atlas.png), [09-production-atlas-region.png](09-production-atlas-region.png)

### 9. Finder

Health: Clear task, weak promise.

Finder asks sensible questions, but its first view spends valuable space explaining what it does not do.
The core promise should be positive: "Find a recorded route that fits the day you want."
Provenance can remain available as supporting trust information.

The desktop form does not fit the available width at this viewport and clips the heading and first field after a search.
The map also stays at a global framing when the search fails, which makes the failure feel inert.
A no-match state should preserve the user's intent and offer nearby recorded alternatives or one-click relaxation of the strictest constraint.

Mobile form ergonomics are solid, but the map arrives below a full screen of controls.
Collapse the filters after submission and move the resulting route shelf into a draggable bottom surface over the map.

Evidence: [10-finder.png](10-finder.png), [11-finder-results.png](11-finder-results.png), [25-mobile-finder.png](25-mobile-finder.png)

### 10. Route library

Health: Useful archive, wrong default emphasis.

The library is optimized for filtering records, not rediscovering memories.
Six filters, lifecycle terminology, draft-guide states, and table columns belong to curation more than personal recall.

Make place, personal title, date, and one memorable image or trace the primary browsing model.
Keep lifecycle and review status in Admin.
The desktop table overflows horizontally at the audited viewport, while the mobile card transformation is much stronger.

Hash-route navigation also preserved the previous page's scroll position during the mobile walkthrough.
Reloading reset the library to the top, so route transitions need explicit scroll restoration.

Evidence: [13-routes-library.png](13-routes-library.png), [21-mobile-routes.png](21-mobile-routes.png), [23-mobile-routes-reload.png](23-mobile-routes-reload.png)

### 11. Route detail

Health: Clear and usable, under-authored.

The map-and-margin split is an excellent production structure.
The route is spatially legible, the facts are easy to scan, and replay is obvious.

When a route lacks a reviewed guide, the page becomes nearly all telemetry.
The title also collapses to the region name, creating "Tokyo, Japan" as both eyebrow and heading.
Use the user's activity title as the primary name and treat guide status as metadata, not the center of the experience.

Evidence: [14-route-detail.png](14-route-detail.png)

### 12. Admin

Health: Appropriate operational surface.

Admin is the one place where the current dense, restrained system is correct.
Readiness, review status, provenance, and route metadata belong here.

It should be visually and navigationally separated from the personal atlas.
Keeping Admin in the same primary navigation gives an internal workflow equal weight to the user's emotional product.

Evidence: [16-admin.png](16-admin.png)

## Ruthless Priorities

1. Make the Daydream story flight the shell for the real Google 3D replay.
2. Make the zoomed regional Atlas the default discovery model and keep the global globe as an overview.
3. Make every route-card interaction produce an immediate, meaningful change on the map.
4. Reframe Routes as a memory library and move lifecycle and review language into Admin.
5. Repair mobile replay density, accessible chapter labels, desktop Finder overflow, desktop library overflow, and route-transition scroll restoration.

## Accessibility And Resilience

The inspected routes generally expose strong semantic regions, headings, named form controls, pressed states, and descriptive route links.

The mobile cinematic timeline exposes unnamed chapter buttons and needs accessible labels.
The interface should preserve visible focus indicators, 44-pixel touch targets, reduced-motion behavior, and full keyboard control of chapter selection and replay seeking.

No browser console warnings or errors were observed during the final health check.

## Final Principle

The app should not feel like a route database that sometimes becomes poetic.

It should feel like a personal atlas that quietly possesses excellent data.
