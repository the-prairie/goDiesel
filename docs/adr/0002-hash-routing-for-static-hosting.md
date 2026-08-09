---
status: accepted
date: 2026-07-12
deciders: owner
---

# ADR-0002: Hash routing for static hosting

## Context

The application is deployed to Cloudflare Pages as static output. There is no
server able to rewrite unknown paths to `index.html`. The product nevertheless
depends on deep links: a route guide, a replay, and an Atlas region selection all
need to be shareable and reloadable.

## Decision

Use `createHashRouter`. All canonical URLs are hash paths: `#/atlas`,
`#/routes/<slug>`, `#/replay/<slug>`, `#/lab/*`, `#/admin`.

Carry cross-surface return context in a validated `?from=` query parameter rather
than in router history state, so that returning from Replay to a specific Atlas
region survives a reload or a shared link.

Canonicalize the prototype's legacy `#quest/<slug>` hash to `#/routes/<slug>`.

## Consequences

- Direct Atlas, route, and Replay links work on static hosting with no
  server configuration, including on microsite branch deployments.
- Canonical URLs are part of the stable contract. `CONTEXT.md` invariant 9 and
  the field-guide plan's work boundaries both forbid changing them during
  redesign work.
- `atlasReturnPath` must whitelist `/atlas` prefixes, because `?from=` is
  attacker-controllable in a shared link. It does.
- Legacy hash canonicalization runs as a module side effect at import time and
  registers a permanent `hashchange` listener. It works, but it is load-order
  dependent and hostile to tests.

## Evidence

- `app/src/router.tsx`, `app/src/navigation.ts`
- `README.md`: "Hash routing keeps direct Atlas, route, and Replay links
  compatible with static hosting."
