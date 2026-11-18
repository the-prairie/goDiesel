# CLAUDE.md

@AGENTS.md

## Commands (run in `app/`)

- `npm run typecheck` - types, plus the admin and lifecycle registry checks
- `npm run test:unit` - unit tests
- `npm run test:e2e -- --trace off <spec>` - browser tests; fixed port 8791, so one run at a time on the machine
- `npm run test:e2e:list` - checks every browser spec loads without running it
- `npm run test:bundle` - bundle budgets (sketch budgets: `scripts/sketch-budgets.mjs`)

## Gotchas

- Never print `.env` or a process environment (`pgrep -fl`, `ps e`): keys live there.
- `build.py` needs the private activity export. Without it, route data cannot be regenerated.
- Owner corrections to places and routes go in `app/src/labs/sketch/sketch-places.ts`, never in generated data.
- `app/public/moments/` is private and gitignored. Only entries flagged `public` ship (`scripts/moments-dist.mjs`).
- Google's 3D map: never move, cover or restyle its credit, and store nothing derived from its tiles.
- The sketch's opening bundle budget is nearly full. New work loads later or replaces something.
- A scene drawn without a graphics card is slow in headless tests. Raise that file's timeout; do not retry.
- MapLibre marker elements must not set `position: relative`.
- Headless Chromium is not Safari, and a simulator is not a phone. Say which was used.

## Public repository

- Friends appear by nickname only; no lines from private messages.
- Every push needs the owner's yes.
