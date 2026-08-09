---
status: accepted
date: 2026-08-03
deciders: owner
---

# ADR-0011: Single-route microsites are scoped at build time

## Context

Sharing one route publicly should not publish the owner's entire personal atlas.
A runtime filter is not sufficient: the data for every other route would still be
present in the deployed bundle and fetchable by anyone who guessed a URL.

## Decision

Scope the share at build time. `VITE_SINGLE_ROUTE_SLUG` activates a Vite
`resolveId` plugin that replaces the generated manifest with a virtual module
containing exactly one route, and **throws** unless that slug is found exactly
once. `make-dist.sh` prunes all unrelated public route data from the output.

The router swaps in a microsite route table where every path is guarded and any
other slug is redirected to the shared route's guide. Navigation chrome is
suppressed. The bundle sends `Disallow: /` and a site-wide
`X-Robots-Tag: noindex`.

Publishing is a single script that validates the slug and a DNS-safe share name,
builds the scoped bundle, runs a focused Playwright journey, deploys to a stable
`share-<name>.godiesel.pages.dev` branch URL, and smoke-tests the result.
`--dry-run` performs everything except the deploy.

## Consequences

- A microsite bundle **physically cannot** contain another route's data. The
  build fails rather than shipping a leak.
- Defence is layered: the build-time virtual manifest, a runtime filter in
  `data/routes.ts`, and the `SingleRouteGuard` redirect.
- The share name defines a durable public URL, so it is validated and must be
  chosen deliberately.
- Live Google 3D imagery still has to be reviewed manually in a
  hardware-accelerated browser; the automated smoke test covers the guide and the
  replay shell, not the photorealistic frame.

## Evidence

- `app/src/config/single-route-microsite.ts`, `app/vite.config.ts`,
  `app/src/router.tsx`
- `scripts/publish-route-microsite.sh`, `scripts/validate-route-microsite.mjs`,
  `make-dist.sh`
- `e450a04b`, `39695e60`, `c54d5c33`
