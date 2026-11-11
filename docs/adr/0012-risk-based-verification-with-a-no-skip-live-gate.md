---
status: accepted
date: 2026-07-21
deciders: owner
---

# ADR-0012: Risk-based verification with a no-skip live gate

## Context

The full release suite is slow, and much of it is irrelevant to any given change.
Running everything after every ticket trains people to stop reading results.

The opposite failure was also real and specific to this product: a suite that
mocks providers can pass while the actual thing being promised — a photorealistic
route replay against live imagery, from a real Strava export — is broken. A test
that silently skips when a credential is missing is worse than no test, because
it reports green.

## Decision

Verify by risk, in four tiers, with the matrix in `docs/agents/testing.md`:

- **Focused** — affected unit tests and focused browser scenarios, during
  implementation.
- **Ticket** — `npm run verify:ticket` once before merge, plus each affected spec
  named explicitly.
- **Live provider** — only for provider, terrain, imagery, or camera changes.
- **Release** — `npm run verify` only for production cutover or changes to shared
  application infrastructure.

A successful gate stays valid unless later edits touch behaviour it covered.

Make the deterministic suite structurally provider-free: the default Playwright
web server sets `GODIESEL_DISABLE_LIVE_PROVIDERS=1`, which blanks the Google key
at build time so those tests cannot accidentally depend on a live provider.

Separate the live proof completely, and forbid it from skipping.
`verify:live-pipeline` exits non-zero when a credential, share name, virtual
environment, billing account, quota, hardware renderer, source export, or
deployed response is unavailable. `live-pipeline.spec.ts` contains no
`test.skip`. It classifies every network response into provider categories,
asserts all required categories were exercised with no status at or above 400,
records hashes and field inventories instead of raw personal values, and covers a
matrix spanning Run and Ride, Earth and Atlas, recorded and imported, completed
and discovered, reviewed and draft.

## Consequences

- Evidence is specific: pull requests name the tier, the exact commands, and
  whether live providers were required. The PR template encodes this.
- The claim "the pipeline works end to end" is falsifiable on demand, from the
  103-column export through a real Cloudflare branch deployment.
- The bundle budget is a semantic gate, not just a size check: one entry chunk
  under 500 KiB that must not contain `CesiumWidget` or the Google
  photorealistic tileset, and exactly one lazy chunk each for Replay and route
  detail.
- Cost: the live gate mutates the world. It consumes Earth Engine quota and
  creates a real Pages branch deployment, so it is not a routine command.
- Cost: everything is manual. `.github/` contains only a pull request template —
  there is **no CI**, so every gate depends on a person running it and recording
  the result.
- Weakness: `verify:ticket` selects browser coverage with four `--grep`'d test
  titles, which will silently match nothing if a title is renamed.
- Weakness: the policy is duplicated in `AGENTS.md`, `README.md`, and
  `docs/agents/testing.md`, and the copies have already drifted.

## Evidence

- `docs/agents/testing.md`, `.github/pull_request_template.md`
- `scripts/verify-live-pipeline.sh`, `app/e2e/live-pipeline.spec.ts`
- `app/playwright.config.ts`, `app/playwright.live.config.ts`,
  `app/playwright.pipeline.config.ts`, `app/scripts/check-bundle-budget.mjs`
- `c7c1e3c2`, `9bc514a7`
