# Release Acceptance Audit

Date: 2026-08-16

Target: `http://localhost:8788`

This audit exercised the production-facing application at desktop and phone widths through its interactive local renderers.
It covered direct navigation, primary actions, responsive states, URL continuity, empty states, manual camera ownership, and browser console health.
The rendered map views were visual QA only and are not claimed as the documented live-provider gate, which requires the authorized `localhost:8787` origin and its explicit command.

## Journey Results

1. Replay: opened a recorded route, started and paused playback, waited for progressive chrome hiding, dragged the map into free-camera mode, recentered, opened settings, changed routes, and followed the route-story return path.
   Health: functional, with one responsive settings overflow and one desktop chapter-label clarity problem found and fixed.
2. Route story: opened the editorial route story, began the story, sought through chapters, checked the chapter rail on desktop and phone, and entered Cinematic Replay.
   Health: functional, with one unnecessarily truncated guide-status value found and fixed.
3. Route collection: searched for Crete, cleared search, opened filters, changed filter state, and confirmed URL-backed query continuity and progressive results.
   Health: no blocking defects found.
4. Atlas: opened a regional lens, changed from Tokyo to Crete, used the route and terrain lenses, selected route context, and checked the regional layout at desktop and phone widths.
   Health: no blocking defects found.
5. Finder: opened planning controls, exercised a Crete no-match recovery, changed to Kyoto, selected the returned spatial candidate, and opened responsive mobile filtering.
   Health: no blocking defects found.
6. Admin: inspected the phone ledger, status language, and read-only operational state, then entered Replay from a route.
   Health: no blocking defects found.
7. Replay route picker: opened the route picker, searched for `holy balos`, selected the matching route, and confirmed navigation to the requested Replay.
   Health: functional; the browser capture surface did not composite the dialog into its screenshot, but the dialog DOM, search result, and navigation were verified directly.

## Findings And Fixes

### P1 - Replay settings overflow

The settings panel allowed fixed-width segmented controls to exceed the panel at both desktop and phone widths.
The panel now uses a bounded responsive width and height, shrinkable grid tracks, full-width segmented groups, and an intentionally stacked phone layout.
Focused tests verify every control remains inside both the panel and viewport at 1440x960 and 390x844.

Before: [desktop](./02-replay-settings-desktop.png) and [phone](./03-replay-settings-mobile.png).

After: [desktop](./25-replay-settings-fixed-desktop.png) and [phone](./26-replay-settings-fixed-mobile.png).

### P2 - Unexplained desktop chapter markers

Inactive Replay chapter names were hidden until hover or focus, leaving several visually unexplained markers.
Chapter names are now persistent at desktop widths, retain stronger active and hover states, and use a collision-aware second lane when adjacent chapters occur at nearly the same route position.
Focused tests verify all names are visible and their rendered bounds do not overlap.

Evidence: [fixed desktop Replay](./25-replay-settings-fixed-desktop.png).

### P3 - Truncated route-story status

The route-story metric forced `Guide not yet reviewed` into an ellipsis despite space being available.
The value now wraps naturally with a compact line height.

Evidence: [fixed route story](./27-route-story-status-fixed.png).

## Performance And Runtime Notes

No browser console warnings or errors appeared across the audited journeys.
Playback, map interaction, panel transitions, regional changes, filtering, and candidate selection showed no visible stalls during the walkthrough.
This is interaction and runtime evidence, not a synthetic frame-time benchmark or a live-provider production cutover certification.
