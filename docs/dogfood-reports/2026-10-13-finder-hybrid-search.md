# Finder hybrid search and sourced discovery — verification

Date: 2026-10-13. Local application at `http://127.0.0.1:8787/#/finder`.
No production deployment or paid provider account was created.

## Stage 1: Search the recorded collection

Finder now searches all 67 published routes with BM25 keyword scoring plus
384-dimensional MiniLM guide embeddings. Natural-language queries can extract
activity, place, distance ranges and climbing limits; visible filters remain
editable. Numeric constraints filter routes before ranking. Similar-route
queries use a real reference route. Results explain matches with recorded
metrics and attributed guide text.

The query model runs in a browser worker and loads only when needed. First use
requires downloading model/runtime assets; keyword search continues if that
fails. Collection text and queries are not sent to a remote inference service.
The derived index has a source-fingerprint check and does not change route data.

Verified real-model retrieval includes Westminster/Kensington, Prospect Park in
Brooklyn, Ocean Beach/Golden Gate Park, and the Victoria waterfront. Browser
checks exercise full worker initialization, map rendering, hard climb limits,
editable distance ranges, URL restoration and saving a durable planned route.

## Stage 2: Discover routes outside the collection

A separate scope uses Photon place lookup and Overpass named route relations.
Ambiguous places require a choice. External results show their OSM source,
activity and whether distance is source-provided or measured from mapped paths.
Unknown climb/surface cannot pass explicit filters. Relation sections stay
separate; incomplete geometry is rejected rather than joined by invented lines.

Live, unmocked Banff checks at 390 and 1280 pixels passed place selection,
route switching, map zoom/recenter, source links and overflow checks. The
under-10-km search returned seven mapped walking/running routes, including
Stoney Lookout (2.1 km source distance, 190 m climb) and Tunnel Mountain Summit
Trail (2.2 km mapped paths). A longer Cascade Fire Road result was excluded.
The application was also exercised directly in the in-app browser.

External discovery is geographic and constraint-filtered; collection guide
search has semantic ranking. External results are not completed memories or
replayable activities. They can be inspected at source, with canonical imports
remaining in the existing import workflow. Coverage depends on named OSM route
relations and does not establish current access or a continuous runnable loop.

## Verification and regression repair

- TypeScript and production build passed.
- Final unit run, including real embedding evaluations: **266 passed, 44 files**.
- Bundle check passed: initial shell **286.2 KiB**; model assets remain lazy.
- Production dependency audit: **0 vulnerabilities**.
- Cloudflare Pages Function compiled successfully with Wrangler; not deployed.
- Single-route build search cache contained only route `14486170630`.
- Live discovery browser tests: **2 passed**, desktop and mobile, no API mocking.
- The broad regression run initially had **210 passed, 39 skipped, 5 failed**.
  Failures identified old UI expectations: the region browser now switches
  regions without clearing selection; Finder's main input/button changed;
  Atlas cards no longer contain long editorial summaries; and Routes snapshots
  still used the superseded serif body font. These checks were corrected after
  inspection. No application behavior was weakened to satisfy them.
- Final affected-browser regression rerun: **85 passed**, covering Finder search
  and planning, Atlas, navigation and visual snapshots, Routes, and the
  Atlas-to-Replay return journey. All five failures from the broad run passed
  after the documented expectation repairs. The entire broad suite was not
  rerun; unchanged passing checks remain valid under the repository policy.
- `git diff --check` passed.

The responsive snapshot baseline was visually inspected before refresh: current
sans-serif body typography, selected navigation background, and lifecycle chips
match the existing app design. Both desktop and mobile snapshots are covered by
the final rerun. Existing unrelated working-tree changes were preserved.

## Visual evidence

- [Collection, desktop](../../app/artifacts/finder-search/collection-1280.png)
- [Collection, mobile](../../app/artifacts/finder-search/collection-390.png)
- [Live discovery, desktop](../../app/artifacts/finder-search/discovery-1280.png)
- [Live discovery, mobile](../../app/artifacts/finder-search/discovery-390.png)
- [Discovery cards, mobile](../../app/artifacts/finder-search/discovery-cards-390.png)

## Reproduce

From `app/`:

```sh
npm run search:check
GODIESEL_SEARCH_EVAL=1 npm run test:unit
npx playwright test e2e/finder-search.spec.ts e2e/finder-planning.spec.ts e2e/atlas.spec.ts e2e/navigation.spec.ts e2e/routes-library.spec.ts e2e/weathered-route-journey.spec.ts
GODIESEL_FINDER_LIVE=1 npx playwright test --config playwright.live.config.ts e2e/finder-discovery-live.spec.ts
npm run test:bundle
npm audit --omit=dev --audit-level=moderate
```

Before public-scale deployment, provide hosted geocoding/Overpass capacity and
durable global rate limiting. Current request bounds/cache/throttling suit the
personal local application, not an unbounded public search service.

Architecture and research references: [ADR 0015](../adr/0015-finder-hybrid-search-and-sourced-discovery.md).
