# goDiesel Quest Atlas

Static quest atlas built from Lauren's Strava export, curated route IDs, and geotagged travel photos.

The repo intentionally separates source files from private local data:

- Source/admin: `build.py`, `quest_meta.py`, `admin.py`, `admin.html`, `quests.json`
- Generated public site: `index.html`, `cards/`, `photos/`, `dist/`
- Private local inputs: `../DieselDiaries`, `../Travel`, `.env`

`dist/` is the deployable Cloudflare Pages upload folder. It is generated from `index.html`, `cards/`, and `photos/` by `make-dist.sh`.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `GOOGLE_MAPS_API_KEY` in `.env`. For local preview, the Google Maps browser key must allow `http://localhost:*` or `http://127.0.0.1:*` as HTTP referrers. If it only allows the production domain, the app will render but the map panels will show Google's "Oops! Something went wrong" error locally.

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
