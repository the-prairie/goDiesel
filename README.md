# goDiesel Quest Atlas

goDiesel turns recorded runs and rides into an explorable atlas, honest route guides, and immersive route replays.
The React application is the canonical product and opens directly into the Atlas.

Route source data comes from Lauren's Strava export and the owner-curated records in `quests.json`.
Generated route summaries live in `app/src/data/generated`, while full route records are loaded lazily from `app/public/data/routes`.
Private Strava and travel inputs remain outside this repository under `../DieselDiaries` and `../Travel`.

## Prerequisites

- Node.js 22 or newer.
- Python 3.12 or newer.
- A Google Maps browser key with Map Tiles API access for photorealistic Replay and Maps Static API access for regional route thumbnails.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
npm --prefix app install
```

Create `.env` at the repository root:

```bash
GOOGLE_MAPS_API_KEY=your-browser-key
```

Restrict the browser key to the origins that run the app.
For local work, allow both `http://localhost:8787/*` and `http://127.0.0.1:8787/*`.
For production, also allow the Cloudflare Pages domain.
Enable Google Maps JavaScript API, Map Tiles API, and Maps Static API with billing on the same project.

## Run

Start the React app:

```bash
npm --prefix app run dev
```

Open [http://localhost:8787/](http://localhost:8787/).
The root redirects to `#/atlas`, and the sidebar links to Finder, Routes, Replay, and Admin.

The Playable Earth route experience is available at `#/lab/playable-earth/<route-id>` as the immersive reference for production Replay.

## Agent workflow

Start with `AGENTS.md`, root `CONTEXT.md`, and the [architecture map](docs/architecture/README.md).

Inspect the atlas or one route without changing state:

```bash
./scripts/godiesel inspect system --json
./scripts/godiesel doctor --json
./scripts/godiesel inspect route-share --json
./scripts/godiesel inspect route-share <slug> --json
./scripts/godiesel inspect route-generation --json
./scripts/godiesel inspect owner-curation --json
./scripts/godiesel inspect planned-route-persistence --json
./scripts/godiesel inspect provider-readiness --json
./scripts/godiesel verify --explain --json
./scripts/godiesel verify route-share <slug> --reuse --json
```

The system inspection reports Git state, the capability inventory, authority classes, blockers, and available transitions.
The doctor additionally checks runtimes, configuration presence, owning writers, command and documentation references, and generated route inventory without invoking a writer or provider.

The route-share capability composes proposal, creation, preview, verification, and publication behind the five `scripts/godiesel` verbs.
Machine-readable results retain the existing domain payload and point to ignored digest-linked receipts under `.route-share/`.
Route verification also writes a privacy-safe proof receipt under `.godiesel/evidence/`.
`scripts/route.sh` remains available as the compatibility path.
See `docs/agents/route-share.md` before using a write or publication command.

The verification explanation classifies changed paths against the manifest, names the affected capabilities and exact gates, preserves live-provider requirements, and blocks unclassified paths without executing a gate.

Proof reuse succeeds only when the latest schema-valid passed receipt has the same manifest-selected gates and complete covered-input fingerprint.
It blocks without executing a gate when implementation, contracts, fixtures, configuration, data, or provider targets changed.

The manifest, doctor, route-share workflow, canonical generation and curation adapters, runtime-boundary inspection, proof receipts, impact explanation, and guarded proof reuse implement Phases 1 through 4 in `docs/architecture/agent-operating-system.md`.
Release adapters and later consolidation remain sequenced in `docs/plans/2026-08-31-agent-operating-system-plan.md`.
See `docs/agents/local-capabilities.md` for the local capability commands and authority boundaries.

## Generate Route Data

Regenerate route summaries and full route records after changing `quests.json` or refreshing the Strava export:

```bash
./scripts/godiesel apply route-generation --authorize canonical-local --json
```

The generator stages React route artifacts and publishes them atomically.
Completed routes feed Atlas and Replay, while planned routes remain separate.

## Curate Routes

Launch the React app and local owner writer together:

```bash
./admin.sh
```

Admin edits the complete experiential guide contract, validates draft and reviewed states, and regenerates application route data on save.
The deployed Admin is read-only because the loopback writer is not available there.
Agents use the fingerprinted curation plan and apply flow in `docs/agents/local-capabilities.md`; both paths call the same local owner writer.

## Test

Run the complete release gate:

```bash
npm --prefix app run verify
.venv/bin/python -m pytest -q
```

The JavaScript gate includes type checking, unit tests, production build, bundle budgets, and Playwright journeys.
The Python gate covers generation, curation validation, atomic publication, and rollback behavior.

### Complete live pipeline proof

The ordinary release gate includes deterministic fault-injection scenarios and does not claim that third-party providers are live.
For an explicit real-data, no-interception proof from the complete Strava export through deployment, configure Earth Engine and a stable Cloudflare branch name, then run:

```bash
GODIESEL_EARTH_ENGINE_PROJECT=playground-406023 \
GODIESEL_PIPELINE_SHARE_NAME=pipeline-proof \
GODIESEL_PIPELINE_TARGET_AUTHORITY=pipeline-proof \
GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY=pipeline-proof \
GODIESEL_PIPELINE_REPLACE_EXISTING=1 \
npm --prefix app run verify:live-pipeline
```

Set `GODIESEL_PIPELINE_REPLACE_EXISTING=1` only after the owner explicitly approves replacing the existing stable proof alias.

This gate checks all 103 columns and every approved activity row in the real Strava export, parses every original GPX/FIT source, rebuilds all generated route records in isolation, and compares every route detail, manifest record, geometry point, provenance record, and statistic.
It then exercises real Run/Ride, Earth/Atlas, recorded/imported, completed/discovered, and reviewed/draft cases through the browser.
The browser must receive successful responses from Google Maps JavaScript, Google Photorealistic 3D Tiles, Google Maps Static, OpenFreeMap, the isolated local owner writer, Nominatim, Earth Engine, and the deployed Cloudflare Pages artifact.

The command intentionally fails instead of skipping when a credential, provider, billing account, quota, hardware renderer, source export, or deployed response is unavailable.
Evidence is written under ignored `app/artifacts/live-pipeline/` using hashes and field inventories rather than raw personal values.

## Build

Build the React application and prepare the root Cloudflare output directory:

```bash
./make-dist.sh
```

The deployable output is `dist/` and is generated from `app/dist/`.
Generated deploy files are not committed.

## Production deployment

Production publication is intentionally unavailable until the Phase 5 release capability is implemented.
Building `dist/` creates a verifiable artifact; it does not grant authority to publish the canonical site.

## Publish a single-route microsite

Prepare a route-only public share without publishing it:

```bash
./scripts/publish-route-microsite.sh 3519505225411091950 appian-way --dry-run
```

The dry run validates the route and replay data, builds a bundle containing only that route, and runs the focused microsite browser journey.
The route-only bundle removes all unrelated public data and sends a site-wide `X-Robots-Tag: noindex` header in addition to `robots.txt`.

Publish the validated bundle to its stable Cloudflare Pages branch URL:

```bash
./scripts/route.sh publish 3519505225411091950 appian-way \
  --authorize-target appian-way \
  --authorize-replacement appian-way
```

This produces `https://share-appian-way.godiesel.pages.dev/` and smoke-tests the public guide and replay shell.
Choose a durable share name because it defines the stable URL.
Both authority values must exactly match that stable share name, including for a new alias.
Live Google 3D imagery must still be reviewed in a hardware-accelerated browser.

Cloudflare Pages should use `./make-dist.sh` as the build command and `dist` as the output directory.
Hash routing keeps direct Atlas, route, and Replay links compatible with static hosting.

## Static Fallback

The previous static application remains available as repository history at the annotated Git tag `static-fallback-2026-07-14`; it is no longer generated or deployed from the current branch.
To rebuild that exact fallback without changing the current branch:

```bash
git worktree add /tmp/godiesel-static-fallback static-fallback-2026-07-14
cd /tmp/godiesel-static-fallback
./rebuild.sh
./make-dist.sh
```

The fallback tag includes its original packaging instructions and static UI tests.
