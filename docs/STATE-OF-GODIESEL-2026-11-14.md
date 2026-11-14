# State of goDiesel, 2026-11-14

Written by the session that built the sketch world (rounds 8 to 16), from what that session knows.
Nothing here was re-read from the code while writing. Anything marked **unsure** is a gap in this
session's knowledge, not a finding. Check a named file, branch or number before relying on it.

This file is written to be safe in a public repository: no keys, no friends' names, no private
captions, no addresses.

## 1. What goDiesel is and who it is for

goDiesel is Lauren's personal running and cycling atlas. It is a React app (Atlas, Finder, Routes,
Replay, Courses, Admin) over a Python route pipeline (`build.py`, `quests.json`), deployed to
Cloudflare Pages (`godiesel.pages.dev`, branch `production`).

In her words it is "the app for myself that people like me might want". She finds places by scanning
a map for where to run, and wants curated routes that are not the obvious ones, honest ground truth
before you go, and her own voice throughout: her Strava titles appear exactly as she wrote them.

Most people will open it on a phone. The phone is the primary target for design and testing.

On 2026-11-11 she handed the repository to Claude to own: product and architecture decisions do not
need sign-off one by one. Deploys, publication, pushes and destructive actions still need her yes.

## 2. Directions in play

### 2.1 Trunk reconcile (draft PR 174, `reconcile/trunk` → `main`)

- **What it is:** makes the former release line (`codex/release-2026-10-15`) the trunk, with about
  37 merges on top: lifecycle reducers and a checked registry (`docs/architecture/lifecycles.json`,
  `scripts/check-lifecycles.mjs`), a responsive, touch and slow-network fix pass, a Google key
  preflight and deploy check, and the first CI workflow (`.github/workflows/verify.yml`).
- **Where:** worktree `.claude/worktrees/reconcile-trunk`. Old unmerged branches are tagged
  `archive/2026-11-11/*`.
- **State:** draft, not merged. Until it merges, `main` is still the stale September line.
  State last checked 2026-11-11; **unsure** whether anything has moved since.
- **Does not work:** the GM LEGENDS route from old `main` is not on the trunk. Five tests are marked
  `requires_private_export` and cannot run here (see 6.1).

### 2.2 Overland (draft PR 175, `feat/overland` → `reconcile/trunk`)

- **What it is:** the pixel game-world lab: generated 3D pixel towns, a pixel world map, the jump
  into a route, and a route story, with a cast of friend creatures.
- **Where:** branch `feat/overland`, worktree `.claude/worktrees/overland` (the same worktree now
  sits on `feat/sketch-world`, which is stacked on top of it).
- **State:** **shelved on 2026-11-13** by Lauren, kept as assets and learnings, not deleted.
- **What works:** the town browser tests (`app/e2e/overland-town.spec.ts`): 30 of 30 passed after
  the per-file timeout was raised to 90 s (see 6.4).
- **Unsure:** the detailed state of the jump and the route story. This session worked on the sketch
  world and only touched Overland to fix the town test.
- **Privacy:** the repository is public. Friends appear by nickname only, and lines quoted from
  private messages must not be pushed until Lauren decides (make the repo private, or keep the
  lines out).

### 2.3 Sketch world (draft PR 176, `feat/sketch-world` → `feat/overland`)

The live direction. Lauren's brief: the whole world drawn as a black-and-white sketch; realistic as
you get into the city; where she has run comes into colour; "Jump in" shows the real 3D city with a
replay of the run.

- **Where:** lab pages `#/lab/sketch` (add `?review=1` for the review controls), `#/lab/moments`
  (catalog), `#/lab/sketch-real`. Code under `app/src/labs/sketch/`. Plan and decision log:
  `docs/plans/2026-11-13-sketch-world.md` (decisions through S36).
- **Pushed:** `origin/feat/sketch-world` is at `476f362c`.
- **Not pushed (waiting on Lauren):** `0a085aa1` (the two routes titled only "Japan" are Kyoto and
  Tokyo) and `2bb044db` (her grouping decisions for Bali, Crete, Greece, the Canaries, Veneto and
  Rome). Both are in the private vault.

What works:

- **The drawn world.** MapLibre with OpenFreeMap vector tiles (OpenStreetMap data) and a custom
  WebGL edge and building layer fed by a worker. Buildings follow regional rules (Japan,
  Mediterranean, Aegean, northern Europe, North America, tropical, other), with forms such as house,
  low block, mansion, block, tower, shed, institution and retail, and landmarks (temple, shrine,
  church, torii). Colour appears only inside the corridor she has run.
- **The atlas.** World → 8 countries → 37 places → route cards → Jump in, 66 routes. The breadcrumb
  scrolls sideways. The index is the existing bundled route manifest (96-point summaries); the full
  track loads per place and replaces the summary line.
- **Her grouping decisions** live in one table in `app/src/labs/sketch/sketch-places.ts`
  (`OWNER_PLACES`, `OWNER_HIDDEN`, `OWNER_RUNS`). Route data is not edited.
- **Jump in and replay.** Google's photorealistic 3D city, unaltered, with the "ridge line" replay
  control on its own paper strip below the map: the run's elevation profile coloured by effort,
  hold to zoom, the clock in the route's own time zone, rings for stops of four minutes or more, a
  flag at the high point. The marker is the play and pause control.
- **Moments.** Her own clips planted in the map. A catalog plus placements, private by default in
  the gitignored `app/public/moments/`, with a per-entry `public` flag; the build ships only public
  entries (`app/scripts/moments-dist.mjs`, run by `make-dist.sh`). The first kind is a TV
  storefront. The marker is a beacon from far away that resolves into a hologram TV up close. She
  can place, swap and remove moments in review mode through the owner writer (`admin.py`, loopback
  only).
- **Checks at `2bb044db`:** unit tests 1,788 ran, 1,783 passed, 5 skipped. Sketch browser tests 43
  of 43 passed (run by the implementing agent). Type check clean; the lifecycle registry has 65
  entries.

What does not work, or was never exercised:

- Never tried on a real iPhone. Checked only in the iOS Simulator and in desktop Chromium.
- Safari is not in the automated tests (WebKit is not installed for Playwright).
- The full browser suite (729 tests) was last run at `476f362c`: 657 passed, 2 failed, 70 skipped.
  It has not been rerun since the regrouping.
- The two failures are `atlas.spec.ts:105` ("Atlas fills the available desktop/mobile workspace
  with live pixels"): the Cesium globe draws nothing in headless Chromium. They fail the same way on
  the tree before this work. Cause not confirmed.
- The street-level camera check was run over an earlier list of places, not the 37.
- The world view on a tall phone cannot show every place at once.
- Placing a moment in Safari with the writer running was never exercised.
- The live-pipeline security spec was not run (its port was held by another project).

### 2.4 Brand directions

- **What it is:** rounds of concept prototypes for a possible rebrand.
- **Where:** worktree `proto-brand-directions`, folder `prototypes/brand/`, round three brief
  `BRIEF-ROUND3.md`. **Unsure** of the branch name and of how far round three got.
- **State:** open, Lauren's to decide. Agreed: no rebrand inside PR 174.
- **What she rejected:** see section 4.

### 2.5 Adventure showcase

**Unsure.** This session did not work on it and holds no reliable knowledge of it. Ask the session
or the vault snapshot that has it.

### 2.6 Mobile Atlas prototypes

**Unsure.** This session did not work on them. They may relate to the UX pass of 2026-11-11 (section
5), but that is a guess.

## 3. Decisions and why

Product and design (Lauren's, mostly made in conversation):

1. **The drawn city is the world at every zoom and stays ink until explored.** Colour is the reward
   for having run there.
2. **Google's 3D city appears only on "Jump in", unaltered.** An earlier stage that drew ink over
   Google's tiles was dropped even though she reports Google approved the shader by email: the
   drawn OpenStreetMap city reads better and keeps Google tile traffic low.
3. **Google's credit is never moved, hidden, restyled or animated.** She asked twice (move it;
   reveal it letter by letter). The answer both times was no, because Google's terms require it. The
   replay strip sits below the map so nothing covers the credit.
4. **The replay control is the ridge line with effort colours.** Chosen from several draggable
   prototypes. The colours have a reason: they show effort (grade), not decoration.
5. **Moments are a catalog she assigns to places**, not clips hard-wired to one location, so she can
   swap them. Private by default; she cleared the first clip as public.
6. **The first moment's caption is guessed from the scene**, never transcribed. Her rule.
7. **The moment marker is the combination**: beacon from afar, hologram TV up close.
8. **Characters and creatures are parked until last.**
9. **Grouping** (2026-11-14): the two "Japan" routes are Kyoto and Tokyo. Bali splits into Uluwatu,
   Canggu and Sidemen. Crete into Chania, Balos, Paleochora, Argyroupoli and Sfakia. Greece into
   Athens, Hydra and Delphi. The Canaries into Gran Canaria and Fuerteventura. Italy keeps Treviso
   and Verona and gains Valdobbiadene. Rome shows the full 28.5 km run (re-imported by her, so it
   has no timing) and hides the 18.3 km partial.
10. **Phone first.** "World-class mobile experience."
11. **Design bar:** "Apple design quality". Things that are their own object, not dressed up as
    something else. The one unserious thing is her own Strava titles.

Engineering (Claude's, as owner):

12. **Owner decisions are a table in sketch code, not edits to generated data.** Generated data
    (`app/src/data/generated/`, `app/public/data/routes/`) is never hand-edited. When the Strava
    export is back, fix the sources and delete the overrides (plan section "S36, continued").
13. **Bundle budgets are split by when a chunk loads** (opening, real-city view, moments, each
    moment scene, review mode, catalog page), so a feature that loads later cannot hide inside the
    opening budget. The opening budget for the sketch is the hard one (84 KiB, about 82 used).
14. **Lifecycles are discriminated unions with pure reducers, registered in
    `docs/architecture/lifecycles.json`.** The type check runs the registry check.
15. **The owner writer stays loopback-only** and now starts without the Strava export, so she can
    place moments on her laptop.
16. **Conductor mode for large work:** one session plans and verifies; an implementing agent writes
    the code test-first. Check the agent's claims against the code before repeating them.
17. **Draft PRs, stacked:** 176 → 175 → 174 → `main`.

## 4. Tried and abandoned (do not repeat)

- **The pixel "Pokémon" world as the main direction.** Shelved 2026-11-13 for the sketch world.
- **Ink drawn over Google's 3D tiles** as a hand-over stage. Dropped (decision 2). The old page
  survives behind `?real=1` only as a retired reference.
- **Moving, hiding or animating Google's credit.** Not allowed. `Map3DElement` also has no option to
  move it.
- **Other playback bars.** Several were prototyped; the ridge line won. A stick-figure runner was
  replaced by a puck marker in round 9.
- **Title letters that bounce out behind the runner.** She said the bounce and timing were wrong. It
  was rebuilt as letters that tumble a few times and burst into dust; her verdict is still pending.
- **Planet satellite imagery.** Its trial terms forbid public display and its licences do not fit a
  personal public app. The open alternative is Sentinel-2 (free, open licence).
- **Reading her clip from the Messages attachments folder.** The system blocks it. She moved the
  file to the Desktop instead.
- **Brand directions she rejected:** anything that dresses the app up as another object (airline,
  newspaper, candy or romance, prize ribbon), generic purple, cream editorial, interface jokes, pun
  names. She does not like "inked" and is not attached to "Diesel".
- **Money stakes for route challenges.** Advised against for now: pride stakes first, legal advice
  before any money.

## 5. The two Desktop folders outside the repo

Both are backed up in the private vault.

- **`~/Desktop/goDiesel-brand-prototypes/`** This session used it for before and after captures of
  each sketch round, named `sketch-r9-*` through `sketch-r16-*`. The `r16` captures are the latest
  visual reference for the atlas (western Crete, the Rome ridge, Italy with Valdobbiadene). **Unsure**
  what else it holds from the brand work.
- **`~/Desktop/goDiesel-ux-pass-2026-11-11/`** Evidence for the UX audit behind the fix pass in
  PR 174: before and after screenshots, findings, and the capture harness. It still matters as the
  record of why those fixes were made. **Unsure** which findings remain open.

Design prototypes from this session were published as private artifacts (playback bar studies, TV
storefront study, moment marker studies, an idea shortlist). Their HTML sources were in a temporary
scratch folder that does not survive the session. **Unsure** whether the vault has them.

## 6. Learned the hard way

### 6.1 Data and pipeline

- The private Strava export (`DieselDiaries/activities.csv`) is not on the machine, so `build.py`
  cannot run and no route data can be regenerated.
- Route cards drawn from the 96-point summaries look like straight strokes on long routes. The full
  track must replace the summary once it loads.

### 6.2 Keys and Google Maps

- The Google Maps key lives in `.env` at the repo root (copied into the overland worktree). Never
  print, log, commit or screenshot it.
- The key was replaced on 2026-11-11. At that time its Cloud project had only the Map Tiles API
  enabled (Maps JavaScript and Maps Static were still needed) and no referrer restriction.
  Production still serves the old, invalid key until a redeploy. **Unsure** whether any of this has
  been fixed since.
- Do not list processes in a way that prints their environment (for example `pgrep -fl` on a test
  runner). It printed a secret from the shell environment into a tool log once. See section 7.
- Before every push: search the outgoing diff for key patterns, friends' nicknames, media files,
  base64 video, caption text, and anything tracked under `app/public/moments/`.
- Nothing derived from Google tiles is stored. Keep Google tile traffic low in tests.

### 6.3 GitHub

- Pushing needs the `the-prairie` account. `gh` has two logins and the other one is active; use
  `gh auth token --user the-prairie` as a one-off credential for the push.
- The repository is public. Every push is Lauren's call.

### 6.4 Tests

- Playwright uses fixed port 8791 and a lock directory, so only one browser run can exist on the
  machine at a time. Use the bundled Chromium only, with tracing off.
- The Overland town is drawn by the CPU in the test browser and takes 13 to 25 s to open. With the
  default 30 s limit, tests failed at random under load. The file now sets 90 s.
- Report results as "X of Y ran, Z passed" and name what was not exercised.

### 6.5 Preview and simulator

- Phone preview: launch config `overland-phone` (port 8790) in `~/Desktop/.claude/launch.json`. It
  stops without warning; check it before sending her a link.
- A screen stuck on "Opening the lab…" during a check is usually the dev server reloading after an
  edit, not a crash.
- Two agents must not drive the same iOS Simulator at once.
- An implementing agent can hand back with dev servers still running. Check and stop them.

### 6.6 Performance and layout limits

- The sketch's opening budget has about 2 KiB of room. New work must load later or replace
  something.
- A map marker element must not set `position: relative`; MapLibre positions markers absolutely, and
  every marker after the first shifts.
- World controls must be hidden while a moment is open, or route cards show through the scene.

## 7. Open questions waiting on Lauren

1. Push the two local commits on `feat/sketch-world` (`0a085aa1`, `2bb044db`)?
2. Push this notes branch to the public repository? (It is in the vault.)
3. Prototype "what it looked like the week you ran" with Sentinel-2, and on which route? It sends
   one run's location and date to an outside imagery service.
4. Her verdict on the letter tumble, and which "pushed further" ridge pieces to build into the app.
5. Her reaction to the idea shortlist (top three: how much of a city is hers, a night version of the
   paper, an honest route check).
6. Rotate the API key that was printed into a tool log (6.2)? Recommended; no answer yet.
7. Rewrite the PR 176 description? It is public, so it needs her yes.
8. Which model she meant by "Jev (typesafe)" for judging what is said in a clip.
9. One route ("lil mud on the tires"): she was not sure which place it belongs to.
10. Repository privacy: make it private, or keep friends' lines out for good.
11. The rebrand.
12. When the Strava export comes back to the machine.

## 8. First five things on resume, in order

1. **Ask for the push** of `0a085aa1` and `2bb044db`, run the pre-push search (6.2), and push.
2. **Rerun the full browser suite and the street-level check on all 37 places** at the new tip, and
   report it as ran, passed, skipped, with the two known Atlas globe failures named.
3. **Try it on her real iPhone in Safari.** Restart the `overland-phone` preview first. The review
   page has a readout she can read numbers from.
4. **Collect her answers to section 7, items 3 to 5**, and build the next piece she picks. Prototype
   first, as a small draggable page, with a stated reason for each colour and motion choice.
5. **Settle the stack:** confirm PR 174's state, then decide the merge order for 174, 175 and 176,
   and find the cause of the Atlas globe test failures rather than carrying them forward.
