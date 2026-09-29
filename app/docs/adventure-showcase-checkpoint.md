# Adventure showcase checkpoint (2026-09-28)

A dated handoff for the atlas-to-adventure work. Current source and current
verification supersede anything here.

## Where it is

- Worktree: `/Users/laurenzary/Desktop/goDiesel/.claude/worktrees/fable-opus-migration-70932f`
- Branch: `feat/adventure-showcase`, from `clanker/feat/direction-d-continuation` at `6ced90fb`
  (0 behind `origin/main` when fetched on 2026-09-28). Local commits only; nothing pushed.
- Decision record: proposed ADR-0017; domain terms in `CONTEXT.md` section 7 ("Adventure").

## Baseline and why

`direction-d-continuation` carried the production notebook relief engine and
the D descent; `feat/sovereign-adventure-worlds` (World Packs, lab-only, far
behind main) and draft PR #130 (Google-only cinematic, failing live) were
inspected and left intact. BVP exists in goDiesel only as untimed plans, which
are never replay-eligible, so the first showcase is **the final boss**, whose
pack is two canonical recordings (`14130772463`, `14130782031`).

## Local setup

```sh
cd app
npm run import:adventure -- /Users/laurenzary/Desktop/p1mp/get-out-adventure-player/public/adventures/final-boss
npm run dev -- --port 8789 --strictPort
```

The pack is imported into the ignored `.adventures/` store at the repository
root. Builds contain no adventure content.

## The journey

1. `#/lab/design-seeds/d/atlas?region=Crete%2C%20Greece&route=14130782031`: region.
2. Enter the day: the leaf lists the adventure's chapters; choosing one holds the thread there.
3. "Enter at 6.8 km": descent into Replay at that chapter.
4. Replay (`?landscape=notebook`, or the Google stage by default when a key is
   present): chapter card, marks, footage, captured scene, film; interrupt,
   inspect, resume.
5. The visible link returns to the day with the thread where it was, then to the region.

Owner flow: `#/admin` → Adventures (dev server only for saving).
Shot plan: `#/lab/cinematic-director/14130782031?plan=1`.

## Completed and verified

| Behaviour | Evidence |
| --- | --- |
| Contract, strict parser, projection, placement, edit rules | unit tests (380 across the suite) |
| Import places all six anchors within 6.1 m | `.adventures/final-boss/import-report.json` |
| Replay layer on notebook: marks, card, inspect/resume, footage, scene, film, return, keyboard, reduced motion, no layer on unrelated routes | `scripts/verify-adventure-replay.mjs`, 51 checks at 1440×900 and 390×844 |
| Full journey region → day → chapter → Replay → footage → day → region, and the other leg | `scripts/verify-adventure-journey.mjs`, 26 checks |
| Owner workspace: move, save, digests, publication plan, restore | `scripts/verify-adventure-admin.mjs` |
| Live Sketchfab scene reached "ready" and ran its tour | full Chrome for Testing (the headless shell is refused by Sketchfab) |
| Google 3D stage with owner chapters, footage hold, film route beat, exact return | observed live in the preview browser with the owner's key |
| Finder no longer presents a code tag as a measured surface | `e2e/finder-planning.spec.ts` |
| Runtime: layer adds no measurable cost; camera optimisation | `scripts/measure-adventure-runtime.mjs`; numbers in the perf commit |
| Repository gates | typecheck, unit, build, bundle budget (initial shell 235.3 KiB), core e2e 105/105 |
| No regressions in D and journal checks | D 22, resilience 31, manipulation 6 |
| Journal Replay, renderer explicit (`EXPECT_RENDERER`) | atlas: 32 checks, `maplibre-atlas` (live providers off); google: 30 checks, `google-3d-maps`; a mismatch fails and says why |

## Not verified

- A physical phone. Mobile results are Chromium device emulation at 390×844.
- A live Google stage run through Playwright; the live observation was manual,
  in the preview browser, at 1280×800, and is not a repeatable gate yet.
- Safari. The media server sends byte ranges, which Safari requires, but Safari was not run.
- Sketchfab availability, which is third-party. The stall fallback is exercised
  only when Sketchfab refuses the browser.

## What is production and what is lab

- **Production entry paths (verified on live Google 3D, localhost:8787,
  1440x900 and 390x844):** Atlas region -> Open route -> Replay with the
  adventure layer -> Back to Atlas; and the route story's Adventure section ->
  Replay from here at a chapter -> back to the story.
- **Production surfaces carrying the adventure:** Replay (both stages), the
  route story, Admin (owner workspace; saving on the dev server only).
- **Lab only:** Direction D's day leaf and descent (`#/lab/design-seeds/d/*`).
- **Content:** absent from builds unless one approved adventure is staged by
  `make-dist.sh` (see ADR-0017). No deploy target is chosen.

## Isolated from this release (preserved, local branches)

- `feat/hike-activity-type`: the Hike activity type. Needs a scoring review
  and Atlas/Finder/planning support.
- `feat/manifest-gap-enrichment`: build.py emitting summary discontinuities.
  Optional; needs a regeneration with the owner's private export. Today's gaps
  are handled at runtime from canonical route details.

## Observed, not resolved

- A reviewer saw "Landscape unavailable" with entry disabled on the first
  leg's D story after a successful render. Eight later cold loads all reached
  ready (3.1-4.8 s). Not reproduced; still open. The label is shown for
  `partial` as well as `unavailable`, so a single DEM tile failure is enough to
  produce it.

## Deferred or blocked

- **Arnica:** prepared, waiting on owner decisions
  (`app/docs/arnica-intake-proposal.md`). Its geometry is an AllTrails export
  and stays out of the public repository unless its redistribution basis is
  resolved.
- **Private-export tests:** `test_pipeline_verification` (3) and the curation
  parity tests (2) need `/Users/laurenzary/Desktop/DieselDiaries/activities.csv`,
  which is absent here. Blocked on that real source; not synthesised.
- **Soundtrack:** optional by design; not imported.
- **Experiential Finder comparisons:** see the Finder research note.
- **Not verified:** physical devices, Safari.

## Release steps (each needs explicit owner authority)

1. Owner decision: the audience and target for the Final Boss adventure (keep
   it on its restricted Site, or publish it on public goDiesel).
2. Reviews of the final head; CI green on it; then merge PR
   the-prairie/goDiesel#131.
3. Only for public goDiesel:
   `GODIESEL_PUBLISH_ADVENTURE=final-boss GODIESEL_ADVENTURE_PUBLICATION_APPROVED=final-boss ./make-dist.sh`,
   review `.godiesel/evidence/adventure-publication-final-boss.json`, then the
   existing deploy command printed by make-dist, and a public smoke check.
   Otherwise deploy without an adventure (the default).
