# goDiesel Quest Atlas

Static quest atlas built from Lauren's Strava export, curated route IDs, and geotagged travel photos.

The repo intentionally separates source files from private local data:

- Source/admin: `build.py`, `quest_meta.py`, `admin.py`, `admin.html`, `quests.json`
- Generated public site: `index.html`, `cards/`, `photos/`, `dist/`
- Private local inputs: `../DieselDiaries`, `../Travel`

`dist/` is the deployable Cloudflare Pages upload folder. It is generated from `index.html`, `cards/`, and `photos/` by `make-dist.sh`.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

MapLibre works without a key for the main atlas. Google-powered previews need a browser-restricted Google API key in `.env`:

```bash
GOOGLE_MAPS_API_KEY=your-browser-key
```

Enable the Google Maps JavaScript API for the Street View route cam. Enable the Google Map Tiles API for the experimental Earth Replay Lab at `?lab=earth#quest/13935098460`.

For local dogfooding, allow `http://localhost:8787/*` in Google Cloud. For deploys, also allow the production Cloudflare Pages domain. The same browser key restriction must cover both Maps JavaScript API requests and Map Tiles API 3D tile requests.

## Build

```bash
./rebuild.sh
./make-dist.sh
```

Open the local build:

```bash
python3 -m http.server 8787 --directory dist
```

Then visit `http://localhost:8787/`.

## Curate Routes

```bash
./admin.sh
```

The admin reads Strava export activity files from `../DieselDiaries`, lets you approve or reject routes, and writes the curated IDs to `quests.json`.

## Test

```bash
python3 -m unittest test_quest_meta.py
```

## Deploy

After rebuilding:

```bash
./make-dist.sh
```

Upload `dist/` to Cloudflare Pages, or use Wrangler:

```bash
npx wrangler pages deploy dist --project-name=godiesel
```
