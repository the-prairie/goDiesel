# Testing Policy

Use risk-based verification.

Do not run the complete release suite after every change or ticket.

Run focused tests while implementing.

Run the ticket gate once before merge.

Run live-provider tests only for provider, terrain, imagery, or camera changes.

Run the complete release gate only for production cutover or changes to shared application infrastructure.

A successful gate remains valid unless subsequent edits touch behavior covered by that gate.

## Verification Matrix

| Tier | When | Required verification |
| --- | --- | --- |
| Focused | During implementation | Run affected unit tests and focused Playwright scenarios for the behavior being changed. Add a targeted visual or interaction check for user-facing work. |
| Ticket | Once before merging a ticket | Run `npm run verify:ticket`, then run every affected Playwright spec separately. Add a targeted smoke and visual check. Run live-provider tests only when the ticket changes providers, terrain, imagery, or camera behavior. |
| Release | Before production cutover, or after shared application infrastructure changes | Run `npm run verify`, the applicable live-provider suites, the required viewport and visual evidence matrix, and any release-specific performance or accessibility gates. |

## Commands

Run commands from `app/`.

The ticket gate is:

```sh
npm run verify:ticket
```

It covers typechecking, a production build, all unit tests, and core navigation smoke tests.

Affected browser scenarios remain explicit so ticket evidence names the behavior that was exercised:

```sh
npx playwright test e2e/<affected-spec>.spec.ts
```

The complete release gate is:

```sh
npm run verify
```

The real-data, no-interception pipeline acceptance gate is:

```sh
GODIESEL_EARTH_ENGINE_PROJECT=playground-406023 \
GODIESEL_PIPELINE_SHARE_NAME=pipeline-proof \
npm run verify:live-pipeline
```

Run it only when proving a production cutover or the complete provider pipeline.
It reads the complete private Strava export, sends selected real route geometry to the configured providers, and creates a real Cloudflare Pages branch deployment.
It must fail when credentials, billing, quota, browser acceleration, raw source data, or any provider are unavailable.

Each run writes `status.json` in its evidence directory. Read the newest run from the repository root:

```sh
./scripts/live-gate-status.sh latest
```

It exits 0 only when that run passed. Missing, running, failed, or interrupted evidence is blocked, never skipped.
It never substitutes network responses, route records, renderers, or writer APIs.

The generated evidence under `app/artifacts/live-pipeline/` is intentionally ignored because it contains source and response hashes derived from private inputs.
Do not commit it.

Live Atlas provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live
```

The live configuration uses full Chromium (`npx playwright install chromium`)
and the Metal backend on macOS. The default headless shell uses SwiftShader on
this Mac, so it does not represent hardware-backed Atlas frame rates. The FPS
test records its GPU renderer and rejects software rendering while retaining
the 30 FPS threshold. Run performance checks without concurrent browser suites.

Before production, the Atlas camera change needs `e2e/atlas-region-live.spec.ts` and `e2e/design-review-live.spec.ts` under `playwright.live.config.ts`.
`e2e/atlas-attribution-live.spec.ts` and `e2e/atlas-globe-quality-live.spec.ts` are advisable.
The Atlas specs need `GODIESEL_ATLAS_PREVIEW_URL`, and the design review needs `GODIESEL_DESIGN_REVIEW_LIVE=1`.
Each spec skips without its variable. A skip is not a pass.

Live Earth Replay provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:earth
```

The default Playwright configuration serves the app on fixed port 8791 and never reuses an existing server.
Only one run can exist at a time. Do not start a second Playwright run while one is active.

## Continuous Integration

`.github/workflows/verify.yml` runs on every pull request and on every push to `main`.
Its only permission is `contents: read`. It uses no secrets and deploys nothing.
A newer push to a pull request cancels that pull request's running check. On `main`, every commit keeps its verdict.

It has three jobs, each on `ubuntu-24.04`:

| Job | Commands |
| --- | --- |
| Python tests | Installs Python 3.12, Node 22, ffmpeg, and `requirements.txt`, then runs `python -m pytest -q --ignore=tmp -p no:cacheprovider -rs -m "not requires_private_export"`. |
| Typecheck, unit tests, build | `npm --prefix app ci`, `npm --prefix app run test:e2e:list`, `npm --prefix app run typecheck`, `npm --prefix app run test:unit`, `npm --prefix app run build` (no Google key exists there, so the build blanks it), and `npm --prefix app run test:bundle`. |
| Playwright journeys | `npm --prefix app ci`, `npx playwright install --with-deps chromium` in `app/`, then `npm run test:e2e -- --trace off --reporter=list,html` in `app/`. On failure it uploads `app/playwright-report` and `app/test-results`. |

`npm run test:e2e:list` lists the specs of `playwright.config.ts` and `playwright.courses.config.ts` without a browser.
It fails when any spec cannot load or a configuration lists no tests, because one spec that throws on import makes Playwright collect nothing, and a run filtered to named files never shows it.
`npm run verify` and `npm run verify:ticket` run it before the build.

A green run does not prove two things, and CI says so with a warning and a step summary on every run:

- Python tests marked `requires_private_export` are deselected. They need the private Strava export (`DieselDiaries/activities.csv`), which is not in the repository. Their status is blocked, not passed. With the export present, run them from the repository root:

  ```sh
  .venv/bin/python -m pytest -q --ignore=tmp -p no:cacheprovider -m requires_private_export
  ```

- Screenshot comparisons are not checked. The only reviewed baselines are macOS (`-darwin.png`), so `app/playwright.config.ts` sets `ignoreSnapshots` when `CI` is set. Compare them on macOS with `CI` unset. The tests' other assertions still run.

## Google Maps key checks

Two checks answer whether Google rejects the configured Google Maps key. Both ask the Map Tiles API's 3D Tiles root, because on the 3D Maps path Google never tells the page that it rejected a key.

- The runtime preflight, `app/src/providers/google-key-preflight.ts`, runs once per browser session beside the Maps script load. Only an explicit invalid-key answer is reported to Replay.
- The deploy-time check, `scripts/check-provider-key.mjs`, runs inside `make-dist.sh`. It fails the build when Google answers that the key is invalid.

Neither check contacts Google in tests. `google-key-preflight.test.ts` injects a fake `fetch`, and `test_deployment_command.py` replaces `fetch` inside the checker with a `node --import` preload.

The deploy-time check reads two variables:

- `GODIESEL_REQUIRE_PROVIDER_KEY=1` is for a public deployment. A missing key fails, and a key that cannot be verified (a network failure, a timeout, or another error) fails as "could not verify" instead of warning.
- `GODIESEL_SKIP_PROVIDER_KEY_VERIFY=1` skips the request to Google, for an offline build. The check prints a warning and still passes. It still checks that the built assets carry the key.

Its output names the key only by its last four characters.

## Responsive, touch, and slow-network pass

This pass is a manual gate. Run it before a release that changes layout, navigation, or loading.

It checks ten viewport widths, touch emulation, slow 3G with CPU throttling, offline, reduced motion, and simulated safe-area insets.

Two specs now pin part of it:

- `e2e/safe-area.spec.ts` simulates phone insets in portrait and landscape by overriding the shell's `--safe-area-*` tokens. It checks that edge bars clear the insets and that the Earth and Atlas Replay dock fits its stage.
- `e2e/ui-primitives.spec.ts` checks keyboard focus rings, 16 px text fields on touch, and 44 by 44 px Finder icon buttons.

These real-device checks are not automated:

- iOS Safari zooming in on a focused field.
- Safe-area insets in landscape, and in a home-screen app.
- How a sheet feels to drag.
- Pinching during playback.

## Gate Validity

Record the exact commands and results in the pull request.

Do not rerun a successful gate after documentation, evidence packaging, or other edits that cannot affect the covered behavior.

Rerun the smallest affected tier when a subsequent edit touches behavior covered by an earlier result.

Escalate to the release tier when a defect indicates a cross-application regression or when shared routing, build, test, rendering, or application-shell infrastructure changes.
