# Finder discovery planning — implementation and browser verification

2026-10-14. Local app at http://127.0.0.1:8787. Nothing deployed.

## Implemented

1. External discoveries can be saved as plans on this device, reopened under
   Routes → Planned, previewed, removed, and exported as mapped GPX. Source links
   and original geometry are retained. These plans never enter completed totals,
   canonical activity records, or Replay. Storage-full/blocked failures are
   displayed without claiming a successful save. Saved data is versioned and
   validated when read.
2. External results now rank using keywords and browser-local semantic
   embeddings of actual source names, descriptions, and documented surfaces.
   Place/distance words are removed from the semantic query because those
   constraints are enforced separately. Name-only records receive reduced
   semantic weight. Model failure leaves keyword ranking available.
3. Map geometry is classified as a loop, an open path, branching paths, or
   disconnected sections. Exact shared vertices establish connectivity; gaps
   are never snapped together. Source-versus-mapped distance conflicts are shown,
   and conflicting lengths cannot silently pass an explicit distance limit.
   Overpass way tags add surface coverage, including mixed and partially tagged
   surfaces. Existing source ascent is labelled; missing climb remains unknown.

No DEM-derived elevation profile, verified access, turn-by-turn itinerary, or
canonical recorded-route import is claimed. Saving a plan and exporting its
mapped paths complete the planning flow without inventing an activity.

## Used the actual app

In the in-app browser, searched “a woodland run near Banff under 10 km,” chose
Banff, Alberta, and waited for real semantic inference. Stoney Lookout ranked
first based on its woodland source description. I visually checked that its map
matched its card, saved it, opened Planned routes, reloaded, and reopened the
persisted preview. I resized to 390 × 844, used the map fit control, expanded
surface details, and downloaded GPX through the actual UI. The downloaded file
contained 266 points in one segment, the OSM relation link, and no invented
elevations or timestamps. The temporary test plan was removed through the UI;
the browser viewport was restored.

The exported verification file is
`/Users/larry/Downloads/osm-13623938-mapped-paths.gpx`.

Live source evidence highlighted a real discrepancy: Stoney Lookout's relation
reports 2.1 km while its mapped path measures about 4.1 km. Both are displayed.
Several other Banff relations have disconnected sections or partial surface
coverage; those are explicitly identified. A name alone does not establish a
woodland experience or current access.

## Issues caught and fixed during verification

- Geography and distance terms initially diluted semantic preference ranking.
- Fully tagged mixed surfaces were initially labelled as partial coverage.
- Re-ranking during tile loading could update the card while leaving the old
  route on the map. The map now updates its existing route source even while
  tiles load.
- Embedded saved-plan previews needed explicit height to remain visible.
- Shared map/evidence components were moved to the UI layer to pass the
  repository's surface-boundary architecture checks.

## Verification

- Ticket gate passed: TypeScript, production build, all standard unit tests,
  and four primary navigation browser checks.
- All unit tests with real embedding evaluations: **282 passed, 47 files**.
- Affected browser suite: **32 passed**, covering discovery saving/export,
  storage failures, Finder collection search/planning, and Routes filters.
- Live discovery suite: **2 passed**, 390 px and 1280 px. Actual Photon,
  Overpass, map tiles and embedding model; no mocked provider responses.
- Final storage-validation browser rerun: **3 passed**, including desktop and
  mobile persistence/export/removal and blocked-storage messaging.
- Bundle check passed: **286.2 KiB** initial shell.
- Cloudflare Pages Function compiled successfully; not published.
- `git diff --check` passed.

The focused fixture tests additionally verify two disconnected segments remain
two GPX segments, plans remain excluded from completed routes, unknown climb
cannot pass a climb filter, and corrupted saved metadata is rejected.

## Screenshots

- [Desktop discovery](../../app/artifacts/finder-search/discovery-1280.png)
- [Mobile discovery](../../app/artifacts/finder-search/discovery-390.png)
- [Saved plan, desktop](../../app/artifacts/finder-search/saved-plan-1280.png)
- [Saved plan, mobile](../../app/artifacts/finder-search/saved-plan-390.png)

## Commands

From `app/`:

```sh
npm run verify:ticket
GODIESEL_SEARCH_EVAL=1 npm run test:unit
npx playwright test e2e/discovery-planning.spec.ts e2e/finder-search.spec.ts e2e/finder-planning.spec.ts e2e/routes-library.spec.ts
GODIESEL_FINDER_LIVE=1 npx playwright test --config playwright.live.config.ts e2e/finder-discovery-live.spec.ts
npm run test:bundle
```

Source and domain decisions: [ADR 0015](../adr/0015-finder-hybrid-search-and-sourced-discovery.md).
