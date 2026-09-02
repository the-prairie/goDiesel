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
| Ticket | Once before merging a ticket | Run `npm run verify:ticket`, then run every affected Playwright spec separately. Add a targeted visual check for user-facing work. Run live-provider tests only for provider, terrain, imagery, or camera changes. |
| Release | Before production cutover, or after shared application infrastructure changes | Run `npm run verify`, the applicable live-provider suites, the required viewport and visual evidence matrix, and any release-specific performance or accessibility gates. |

## Proof contract

Before running a gate, state what changed, which interfaces and invariants are affected, and why the selected tier is sufficient.

After running it, report:

- exact command;
- normalized result: `passed`, `failed`, `blocked`, or `not_run`;
- observable behavior or invariant covered;
- commit and relevant dirty state;
- provider target or test adapter used;
- artifact, screenshot, deployment id, or URL when applicable;
- remaining unproven claims.

Never report a missing live dependency as skipped success.
Use `blocked` and name the missing credential, acceleration, quota, source, or provider without exposing its value.

Route-share verification records this contract under `.godiesel/evidence/`.
Until every capability uses the general receipt, record the same proof contract in the pull request or final task report for uncovered capabilities.

## Impact selection

Classify the change before choosing commands:

| Change | Minimum impact inspection |
| --- | --- |
| Pure domain or writer | Owning module interface, invariants, unit tests, and affected generated contract |
| One product surface | Surface behavior, shared UI/domain dependencies, focused Playwright, and viewport evidence |
| Provider, renderer, terrain, imagery, or camera | Deterministic interface tests plus the applicable live-provider proof |
| Build, routing, data tier, shared shell, or test infrastructure | Cross-application consumers and release-tier escalation |
| Documentation only | Local links, indexes, command references, terminology, and `git diff --check` |

An affected path that cannot be assigned to an owning module or invariant is an architecture gap.
Do not silently choose a small gate for an unclassified change.

Inspect the manifest-owned impact decision without running a gate:

```sh
./scripts/godiesel verify --explain --json
```

Pass one or more `--changed-path <repository-relative-path>` values for a bounded explanation.
Without explicit paths, the command compares the worktree with the merge base of `origin/main`.

Reuse a route-share proof without executing its gate only when every covered input remains valid:

```sh
./scripts/godiesel verify route-share <slug> --reuse --json
```

The reuse result names invalidated input categories and blocks when no valid proof remains.
Route release performs the same reuse validation before any external effect.

## Commands

Run commands from `app/`.

The ticket gate is:

```sh
npm run verify:ticket
```

It covers a production build, which includes typechecking, and all unit tests.
There is no unrelated fixed browser subset; the affected browser spec is the ticket's browser proof.

Affected browser scenarios remain explicit so ticket evidence names the behavior that was exercised:

```sh
npx playwright test e2e/<affected-spec>.spec.ts
```

The complete release gate is:

```sh
npm run verify
```

It runs the production-critical browser journeys rather than every diagnostic,
lab, gallery, and breakpoint scenario in the repository.
Run `npm run test:e2e:extended` only when a change crosses those secondary
surfaces or when diagnosing a broader regression.

The real-data, no-interception pipeline acceptance gate is:

```sh
GODIESEL_EARTH_ENGINE_PROJECT=playground-406023 \
GODIESEL_PIPELINE_SHARE_NAME=pipeline-proof \
npm run verify:live-pipeline
```

Run it only when proving a production cutover or the complete provider pipeline.
It reads the complete private Strava export, sends selected real route geometry to the configured providers, and creates a real Cloudflare Pages branch deployment.
It must fail when credentials, billing, quota, browser acceleration, raw source data, or any provider are unavailable.
It never substitutes network responses, route records, renderers, or writer APIs.

The generated evidence under `app/artifacts/live-pipeline/` is intentionally ignored because it contains source and response hashes derived from private inputs.
Do not commit it.

Live Atlas provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live
```

Live Earth Replay provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:earth
```

Local Google 3D cinematic verification is:

```sh
npm run test:e2e:google-live
```

Every explicit live-provider command fails when its required configuration or
provider is unavailable. Missing evidence must never appear as a skipped green run.

Local native Google 3D verification must use `http://localhost:8787` rather
than `http://127.0.0.1:8787`. The configured browser key authorizes the
`localhost` origin, and Google treats the loopback IP as a different referrer.

## Gate Validity

Record the exact commands and results in the pull request.

Do not rerun a successful gate after documentation, evidence packaging, or other edits that cannot affect the covered behavior.

Rerun the smallest affected tier when a subsequent edit touches behavior covered by an earlier result.

Escalate to the release tier when a defect indicates a cross-application regression or when shared routing, build, test, rendering, or application-shell infrastructure changes.

A proof's covered inputs include implementation, contracts, schemas, fixtures, test code, build and runtime configuration, canonical data fingerprints when applicable, and the external provider or deployment target for live proof.
The manifest-owned fingerprint aggregates every matching file per impact pattern, records absent patterns, records configuration presence without secret values, and digests non-sensitive provider targets.
Each observed file also contributes its file type, executable mode, and symlink target when applicable.
Changing any covered input invalidates that proof.

Each impact rule names the capability invariants that justify its selected gates.
Focused route-share evidence records the exact manifest-declared route check that ran; its fingerprint covers the route-only application source, browser journey, build and scoping scripts, dependency and test configuration, route data, and public route media consumed by that check.
Live proof requires an explicit provider or deployment target even when no additional credential is required.

Documentation, evidence packaging, or unrelated edits do not invalidate a proof unless they change an executable command, contract, or claimed behavior.

## Resource discipline

Run inexpensive, local, and deterministic checks before expensive or external checks.
Load route summaries before details, compare hashes before reparsing full geometry, and reuse valid proof rather than rerunning it for ceremony.

Do not save resources by weakening source honesty, live-provider requirements, viewport coverage, or release proof.
