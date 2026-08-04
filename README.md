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

## Generate Route Data

Regenerate route summaries and full route records after changing `quests.json` or refreshing the Strava export:

```bash
./rebuild.sh
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

## Test

Run the complete release gate:

```bash
npm --prefix app run verify
.venv/bin/python -m pytest -q
```

The JavaScript gate includes type checking, unit tests, production build, bundle budgets, and Playwright journeys.
The Python gate covers generation, curation validation, atomic publication, and rollback behavior.

## Build

Build the React application and prepare the root Cloudflare output directory:

```bash
./make-dist.sh
```

The deployable output is `dist/` and is generated from `app/dist/`.
Generated deploy files are not committed.

## Deploy

Deploy the generated React output with Wrangler:

```bash
npx wrangler pages deploy dist --project-name=godiesel --branch=production
```

Cloudflare Pages should use `./make-dist.sh` as the build command and `dist` as the output directory.
The `godiesel` Pages project uses `production` as its production branch, so the branch flag is required for the canonical `https://godiesel.pages.dev/` deployment.
Hash routing keeps direct Atlas, route, and Replay links compatible with static hosting.

## Static Fallback

The previous static application is retained for one release at the annotated Git tag `static-fallback-2026-07-14`.
To rebuild that exact fallback without changing the current branch:

```bash
git worktree add /tmp/godiesel-static-fallback static-fallback-2026-07-14
cd /tmp/godiesel-static-fallback
./rebuild.sh
./make-dist.sh
```

The fallback tag includes its original packaging instructions and static UI tests.
