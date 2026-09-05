# App Walk

A walk is contact with the product, not a claim that every aspect of it is good.
The runner uses the real visible interface, records its path, captures screenshots,
and preserves failures. It never heals selectors, skips failed checks, edits
curation, publishes a route, or deploys an application.

## First increment: recorded walks

From the repository root:

```sh
node app/walks/run.mjs --profile controlled --target http://127.0.0.1:8792/ --mission planning
node app/walks/run.mjs --profile live --target https://godiesel.pages.dev/ --mission memory --headed
```

Start the target separately. The walk deliberately does not inherit the ordinary
Playwright configuration or start a provider-disabled server for a live target.
Use the app's existing locked Playwright installation (`npm ci --prefix app`).

`memory` explores Atlas, reaches a route story through visible Routes navigation,
observes Replay, and returns to that same story. Atlas currently sends its own
“Open route” action directly to Replay; the report records this rather than
pretending that action opens a story.

`planning` uses the established Kyoto planning example as a stable landmark,
saves into a **new disposable browser context**, reloads, reopens the plan through
Routes, tries an empty search, and recovers through Edit search. Stable landmarks
are intentionally not described as autonomous exploration.

A successful mission does not override a blocked provider/motion check. Exit codes
are 0 passed, 1 failed, and 2 blocked. Browser/runtime setup failures are blocked;
observed journey assertion failures are failed. No retries are silently applied.

Each invocation creates a unique `.godiesel/walks/<run>/` directory containing
`index.html`, `report.json`, screenshots, and accessibility snapshots. Raw traces
and videos require `--capture-raw`; they are private and are never automatically
uploaded. Even ordinary screenshots may contain personal route information.
The target's script bytes are fingerprinted independently of the runner checkout;
they do not magically establish the deployed commit.

The read-only network guard only continues approved GET/HEAD/OPTIONS requests or
aborts them. It never fulfills a live response. It blocks local owner-writer
ports, remote mutations, arbitrary origins, popups, downloads and WebSockets.
Provider requests suppressed by this boundary are recorded, not called successful.

## Verification

```sh
node --test app/walks/core.test.mjs
GODIESEL_WALK_BROWSER_PATH=/path/to/chromium node --test app/walks/browser.test.mjs
```

Omit `GODIESEL_WALK_BROWSER_PATH` with Playwright's installed browser. The browser
tests use a deliberately independent fixture labeled **NOT goDiesel**. They prove
the harness, including a deliberately broken return path; they are not product or
provider proof. The actual-app run is separate and names its exact target.

## Review the experience

Open the generated HTML privately. Judge continuity, clarity, visual hierarchy,
and movement against `app/DESIGN.md`. Separate reproduced defects from product
opportunities and personal aesthetic preferences. A viewport is not a physical
phone. An HTTP 200 is not evidence that terrain looks correct. A passed guided
journey leaves `experience_review.status = not_run` until someone actually reviews
its images and motion.

For restricted local analysis only, `GODIESEL_WALK_DOM_FIXTURE=1` runs the browser
harness tests against a rendered in-memory document. Its adapter changes only
fixture navigation and fixture storage, observes **zero network traffic**, and
cannot prove HTTP, provider, or real-app behavior. CI and product runs do not use
that adapter. Administrative network blocks are reported as blocked, not defects.

## Operator integration

```sh
./scripts/godiesel inspect app-walk --json
./scripts/godiesel verify app-walk --profile controlled --target http://127.0.0.1:8792/ --mission planning --json
./scripts/godiesel verify app-walk --profile live --target https://godiesel.pages.dev/ --mission memory --headed --json
python -m pytest -q test_godiesel_app_walk.py
```

The existing `scripts/godiesel` entrypoint dispatches this capability to its own
adapter; all other invocations retain the original control parser and exit status.
`inspect system` discovers it through the same capability manifest. This adds
`inspect` and `verify` only, not an `apply` or `release` permission.

Verification rejects stale run identities, wrong targets, inconsistent exit codes,
contradictory check results, missing visual artifacts, symlinks and changed covered
inputs. A receipt uses the existing `godiesel_evidence` writer. The outer result
schema retains its established `passed`/`blocked` vocabulary; the domain result,
exit code and general evidence receipt preserve `failed` versus `blocked`.
`--reuse` is deliberately rejected without executing anything. No earlier result
establishes how an external application behaves now.

Adapter tests use a fake child result to attack this protocol; they are not browser
or product evidence. The existing control tests still validate all original
capabilities and their invariants, with App Walk added to their exact inventory.
