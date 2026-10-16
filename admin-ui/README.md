# Standalone Admin modules

`admin.html` remains the imperative browser adapter for the Python owner server.
Its module script imports pure TypeScript modules from this directory through
checked-in JavaScript under `generated/`. Running `python admin.py` needs no Node
process or build step. The React Admin remains a separate surface.

## Change a module

1. Edit the TypeScript source beside this file.
2. Add colocated `*.test.ts` behavior tests.
3. From `app/`, run `npm run admin:build`.
4. Commit both source and emitted JavaScript.
5. For a new browser import, add its exact URL to `ADMIN_ASSETS` in `admin.py`.
6. Run `npm run admin:check` and the affected unit and browser tests.

`admin:check` compiles into a temporary directory and compares every output with
the checked-in files. Typechecking and production builds run this check. A stale,
missing, or extra generated file fails verification without changing the checkout.
The compiler has no DOM library or ambient package types. Keep browser APIs,
fetch, timers, and mutable resource ownership in `admin.html`.

Reducers follow [ADR-0016](../docs/adr/0016-explicit-state-transitions-at-lifecycle-boundaries.md).
Use `<flow>-state.ts`, tagged states, explicit events, pure initialization and
transition functions, and matching operation IDs for asynchronous outcomes.
Use relative `.js` import specifiers between TypeScript modules so emitted imports
work directly in the browser. Do not import React, Vite aliases, or npm packages.
Generated JavaScript is a delivery artifact, never a second source of truth.

## Verify the standalone page

The Playwright spec `app/e2e/standalone-admin.spec.ts` serves the real HTML and
module assets with synthetic routes and in-memory API writes. It covers desktop
and mobile edits, saved values after refresh, rebuild guards, classifier reconnect,
and two-second polling. It never writes owner records or starts real classification.

Run `python -m unittest test_admin_assets test_admin_curation` from the repository
root with the project's Python dependencies installed. Asset tests start the real
Python handler against temporary empty route data. They verify JavaScript content
types, caching, and rejection of unlisted files and traversal paths.

A module delivery change requires release-tier verification under the repository
[testing policy](../docs/agents/testing.md). Later reducer extractions use the ticket
tier unless they change the build or serving boundary again.
