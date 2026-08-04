# React Production Cutover

## Decision

The canonical `https://godiesel.pages.dev/` deployment now serves the React Weathered Atlas application built from commit `a1cea75`.
The previous static application remains recoverable from the annotated tag `static-fallback-2026-07-14`.

## Deployment

- Cloudflare Pages project: `godiesel`
- Production branch: `production`
- Production deployment: `c1d431fa-6bed-4e24-9899-c45ad361d8ca`
- Immutable deployment URL: `https://c1d431fa.godiesel.pages.dev`
- Canonical production URL: `https://godiesel.pages.dev/`
- Build command: `./make-dist.sh`
- Build output: `dist/`
- Artifact: 19 MB across 512 files

## Release Gate

- TypeScript type checking passed.
- 82 Vitest unit tests passed.
- Production build and bundle budget passed.
- 135 Playwright journeys passed.
- Three opt-in live Google tile tests were skipped by the standard release gate.
- 34 Python generation and publication tests passed.

## Production Smoke Test

- The root URL canonicalized to `#/atlas` and rendered the interactive globe with 66 route records.
- A canonical route URL rendered the source map, route thread, elevation profile, and Replay action.
- Earth Replay rendered Google photorealistic 3D tiles and the route thread on the production origin.
- The deployed Admin rendered in explicit read-only mode.
- A direct legacy `#quest/<id>` URL canonicalized to `#/routes/<id>` without losing the selected route.
- The inspected production journeys produced no page errors or failed HTTP responses.
- The deployed Admin intentionally resolved to read-only mode after its loopback writer probe was refused by the browser.

## Rollback

Build the annotated static fallback in a separate worktree, then deploy its generated `dist/` to the same Pages production branch.

```bash
git worktree add /tmp/godiesel-static-fallback static-fallback-2026-07-14
cd /tmp/godiesel-static-fallback
./rebuild.sh
./make-dist.sh
npx wrangler pages deploy dist --project-name=godiesel --branch=production
```
