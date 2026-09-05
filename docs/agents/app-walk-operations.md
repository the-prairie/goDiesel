# Making close attention a habit

The `App Walk observations` workflow offers a daily schedule, a successful
main/production deployment trigger, and a manual existing-target invocation.
It is checked in, not active on an unmerged feature branch. It never deploys,
creates route shares, changes owner curation, or posts an issue.

## Execution and authority

The workflow checks out **main**, not event-supplied code. It has only repository
read permission, no stored Git credentials and no model secrets. Incoming events
must belong to this repository. Deployment events must describe a successful
main/production deployment with a concrete commit. Targets must be existing
allowlisted HTTPS goDiesel Pages origins, without credentials, queries or paths.
The actual served assets remain independently observed; the deployment event does
not make the runner checkout the deployed build.

Every batch runs the memory mission and one rotating planning/library/read-only
Admin mission. Selection considers recent visits and relevant changed paths when
that deployment commit is available locally. Missing Git history is unknown,
not a fabricated diff. Every run is fresh; no proof reuse is permitted.

The non-private coverage cache contains only dates and mission names, never route
identities, screenshots, requests, raw notes or credentials. The fixed daily seed
also rotates selection when the cache is unavailable. No more than 120 visits are
retained in the cache. Concurrent batches are serialized rather than cancelling
and hiding a partially completed observation.

## Live rendering and a trusted runner

The hosted Linux fallback can execute the runner but may not provide the hardware
acceleration needed to establish live 3D evidence. That is an explicit blocked
check, **not** a skipped green check. The other selected journey still runs.
Set the repository variable `GODIESEL_WALK_RUNNER` to a trusted Linux GPU runner
label only when that runner and browser environment have been reviewed. The
runner needs Node 22, Python 3.12-compatible execution, Playwright Chromium and
network access to the existing target/providers. The workflow installs the
application's locked dependencies. It does not provision a GPU or provider key.

The recurring runner is guided. Optional model-driven exploration is invoked
separately with the explicitly authorized model settings described in
[exploration](app-walk-exploration.md). It is never silently enabled by a schedule.

## Private field notes; public operational summaries

Full reports, screenshots, accessibility snapshots, traces, videos, issue drafts
and review records stay under ignored `.godiesel/walks/` on the runner. The sole
uploaded artifact is `public-summary.json`, assembled from a finite vocabulary
and bounded counts. It has no raw route names, URLs, coordinates, action text,
free-form errors, screenshots or model notes. Artifact retention is seven days.

On an ephemeral hosted runner the raw evidence disappears with that runner. The
public summary is not a substitute for visual review. Use a trusted private
runner with controlled retention, or rerun the identified mission privately, to
inspect the actual field notes. On a persistent runner the owner must archive
reviewed evidence and enforce access/retention appropriate for personal routes.
The reader refuses more than 1,000 runs rather than silently deleting evidence.

The workflow requires its summary artifact; missing setup/browser/evidence cannot
be advertised as a successful batch. Explicit `passed`, `failed`, and `blocked`
statuses survive into its final exit status.

## Deduplicated issue drafts

```sh
node app/walks/operations.mjs drafts
```

This creates an immutable, content-addressed JSON snapshot of private issue drafts.
The same defect in the same mission/target/viewport is grouped with its original
observations. Different contexts remain separate. Repeat sightings are labeled
`repeated-observation`, not independently reproduced. A later unrelated pass does
not resolve a previous finding. Opportunities remain review judgments.

A draft includes the original run identities, evidence fingerprints and action
positions. An investigator should reproduce the problem, inspect the relevant
implementation, and choose a narrow regression test before requesting a fix.
Posting an external issue and changing code remain explicit separate actions.
There is no automatic issue spam or autonomous fix/merge/deploy loop.

## Record an independent visual judgment

First inspect the immutable report and its image references:

```sh
node app/walks/operations.mjs inspect-review --run <run-id>
```

Review the cited images against `app/DESIGN.md`, then write a local JSON file:

```json
{
  "report_sha256": "<the exact value returned by inspect-review>",
  "reviewer": "Your name or explicitly identified reviewing agent",
  "kind": "human",
  "judgment": "needs-attention",
  "frames": ["frame-001.png"],
  "notes": "Describe what the cited image actually shows and why it matters."
}
```

```sh
node app/walks/operations.mjs review --run <run-id> --input /path/to/review.json
```

Only `human`/`visual-agent` and `coherent`/`needs-attention`/`unverified` are accepted.
A stale report digest, unknown image, changed screenshot, missing reviewer or
extra authority field is rejected. The new record is an attributed judgment,
not authentication of the stated reviewer's identity. It attests only the cited
still images, not unseen motion, live providers or a physical phone.

The review is an immutable sidecar. It does not rewrite the observation, turn a
failed machine check green, assert a defect is fixed, or approve release. For a
fixed defect, rerun its original journey and add the appropriate focused test;
retain the original failure so the improvement remains reviewable.

## Verification and remaining scope

```sh
node --test app/walks/operations.test.mjs
node --test app/walks/*.test.mjs
```

The first command attacks event authorization, target spoofing, privacy, stale
reviews, changed images, duplicate grouping and batch status handling. The second
also needs the real HTTP-capable browser environment. The local DOM fixture
adapter is explicitly not accepted for HTTP recovery proof.

Dedicated CI additionally runs four compiled-app journeys and a controlled
memory round trip. A memory report may correctly stay blocked for disabled
imagery while the CI acceptance verifies that navigation and named degradation
worked. Neither the report nor the live gate is turned green by this distinction.
