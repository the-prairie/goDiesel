# Live pipeline proof — 2026-08-09

The first successful run of `npm run verify:live-pipeline`. Recorded here because
`docs/agents/testing.md` requires the exact commands and results, and the
generated evidence under `app/artifacts/live-pipeline/` is gitignored: it
contains hashes derived from private inputs and is not committed.

## Command

```bash
GODIESEL_EARTH_ENGINE_PROJECT=playground-406023 \
GODIESEL_PIPELINE_SHARE_NAME=pipeline-proof \
npm --prefix app run verify:live-pipeline
```

Run from `main` at `30e60425`. Exit code 0.

## Result

| Stage | Outcome |
| --- | --- |
| 1 Census and rebuild every approved route | 67 routes, 103 source columns, 72 output field paths |
| 2 Deterministic release gate | passed |
| 3 Real route matrix, provider network, isolated writer | passed, all provider categories observed |
| 4 Live Earth Engine regeneration | both Route Intelligence cases regenerated |
| 5 Credentialed preview | started |
| 6 Hardware-backed live journeys | **23 passed, 0 failed** |
| 7 Deploy and smoke a route-only artifact | published and smoke-tested |
| 8 Complete | evidence written |

Published: `https://share-pipeline-proof.godiesel.pages.dev/`

## What it took to get here

The gate had never completed before. PR #104 recorded it as pending
authorization, so no stage beyond 4 had ever run. Four attempts were needed, and
every failure was a real defect that no other gate could see.

**A rotated API key not authorised for Maps Static API.** Satellite thumbnails
failed silently in the browser: Google returned a `403` as `text/plain`, and
Chrome's Opaque Response Blocking reported only `net::ERR_BLOCKED_BY_ORB`, so the
real cause never reached the page. The deterministic suite runs with no key at
all and therefore cannot detect a key misconfiguration.

**A hand-kept file list in two places.** `app/e2e/live-pipeline.spec.ts` and
`pipeline_verification.py` each copied a fixed set of modules into an isolated
workspace. `admin.py` had grown imports the lists did not know about, so the
isolated admin died with `ModuleNotFoundError`. Both now enumerate every
top-level module.

**Three live specs stale since ADR-0009.** `earth-replay-live.spec.ts` asserted
Cesium's measured camera attributes while navigating without `?renderer=cesium`.
Every other Cesium spec was updated when the renderer changed on 2026-08-01;
this one was missed and had been dead since. Two cinematic specs expected three
filament polylines where the code renders four, and ran on the 30-second
deterministic default while a live photorealistic scene needs minutes.

**No terrain-clearance guarantee on the primary renderer.** See ADR-0009. Fixed
by deriving clearance from recorded elevation in the scene contract.

## What this run does not prove

- The route scorecard ADR-0009 owes still does not exist. Twenty-three passing
  journeys show the renderer works on the routes tested, not that the experience
  is good across the atlas.
- The gate consumes Google billing and Earth Engine quota, and creates a public
  Cloudflare Pages branch. Run it for a production cutover, not routinely.
- Two evidence directories were produced. They are ignored on purpose.
