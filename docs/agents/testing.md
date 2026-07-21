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

Live Atlas provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:atlas-live
```

Live Earth Replay provider verification is:

```sh
GODIESEL_ATLAS_PREVIEW_URL=<preview-url> npm run test:e2e:earth
```

## Gate Validity

Record the exact commands and results in the pull request.

Do not rerun a successful gate after documentation, evidence packaging, or other edits that cannot affect the covered behavior.

Rerun the smallest affected tier when a subsequent edit touches behavior covered by an earlier result.

Escalate to the release tier when a defect indicates a cross-application regression or when shared routing, build, test, rendering, or application-shell infrastructure changes.
