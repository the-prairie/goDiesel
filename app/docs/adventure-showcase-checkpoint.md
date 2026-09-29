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
| No regressions in D and journal checks | D 22, resilience 31, manipulation 6, journal Replay (with live providers off) |

## Not verified

- A physical phone. Mobile results are Chromium device emulation at 390×844.
- A live Google stage run through Playwright; the live observation was manual,
  in the preview browser, at 1280×800, and is not a repeatable gate yet.
- Safari. The media server sends byte ranges, which Safari requires, but Safari was not run.
- Sketchfab availability, which is third-party. The stall fallback is exercised
  only when Sketchfab refuses the browser.

## Deferred or blocked

- **Arnica reuse proof: blocked on owner decisions.** No canonical Arnica route
  exists. Creating one needs (1) an activity type for a hike (the contract
  allows only `Run` and `Ride`), (2) the GPX's origin, which the pack does not
  record, and (3) explicit creation approval under `docs/agents/route-share.md`.
  Reuse without route-specific code is shown instead on the adventure's other
  recording and by synthetic fixtures.
- **Publication.** Adventures are local-only. Publishing needs an audience
  decision per adventure and a scoped publisher that copies only its media
  (ADR-0011). The workspace records a publication plan; it publishes nothing.
- **Soundtrack.** The Arnica pack's music is a commercial recording; not imported.
- **Experiential Finder comparisons.** Only 2 of 68 routes have reviewed
  curation. See `docs/research/2026-09-28-finder-evidence-assessment.md`.
- **The film route beat's p95** is still 17.4 ms, with one long frame per run.
- `verify-journal-replay.mjs` assumes the keyless Replay fallback. With a Google
  key it lands on the Google stage and fails its HUD checks; pin its renderer.

## Release steps (each needs explicit owner authority)

1. Review the six commits on `feat/adventure-showcase` and accept or amend ADR-0017.
2. Decide Arnica: hike activity type, GPX provenance, then the route-share
   plan → approval → `apply --authorize canonical-local`, then
   `npm run import:adventure -- <arnica pack> --legs <slug>`.
3. Push the branch and open a PR (not done).
4. Per adventure, choose an audience before any deployment; the current Sites
   and their audiences are unchanged.
