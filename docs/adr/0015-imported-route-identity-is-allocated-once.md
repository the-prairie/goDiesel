---
status: accepted
date: 2026-08-30
deciders: owner
---

# ADR-0015: Imported route identity is allocated once

## Context

Strava-backed route slugs are stable because the source system supplies an activity id.
Imported GPX routes do not have that source identifier.
Deriving an imported slug from a title, region, filename, share name, or checksum would make a canonical URL change when editorial metadata or a corrected source file changes.

## Decision

Keep the Strava activity id for every Strava-backed route.
Allocate one opaque `gpx-<32 hex>` identifier when a new GPX proposal is created.
Store that identifier in `quests.json` and reuse it for every retry of the approved proposal.
Reject an explicit or generated identity collision instead of selecting a different identity silently.
Keep the public share name independent from route identity.

## Consequences

- Correcting a durable GPX changes its checksum health but does not silently change the route URL.
- Renaming or moving a route does not change its route URL.
- Reapplying one approved proposal is idempotent.
- A new proposal for the same uncreated source may allocate a new identity, so the approved proposal is the durable plan.

## Evidence

- `route_create.py`
- `route_create.schema.json`
- `test_route_create.py`
