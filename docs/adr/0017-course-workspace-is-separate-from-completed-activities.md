---
status: proposed
date: 2026-10-21
supersedes: none
---

# Course workspace is separate from completed activities

The static collection represents completed or curated activities. Its data remains owned by the Python build pipeline. User uploads and agent-generated navigation courses need interactive persistence without rewriting those records or implying that someone completed a generated route.

`Course` owns segmented geometry, activity, source, and derived metrics. GPX import preserves missing elevation and time as missing. Generated courses carry their routing request and provider profile. Distance excludes gaps between segments. A course has a preview and export workflow rather than inheriting recorded activity replay and telemetry.

The shared HTTP boundary accepts generate, import, and save commands. Generate and import return previews. Save is explicit and content-addressed so retries do not create duplicates. Generated previews include a receipt signed with a server-only key. Save rejects missing or altered receipts, preventing client-supplied geometry from claiming verified provider provenance. The browser and agent CLI use the same parser and store. A pure workspace reducer rejects stale responses and retains a preview after a failed save.

Local development uses private files outside Git. Hosted writes require a configured owner bearer token and durable store. An unconfigured production deployment fails closed. This is a personal owner workspace, not a multi-user account or sharing system.

We rejected browser-only storage because an independent agent cannot upload into another process's localStorage. We rejected rebuilding the canonical catalog for every upload because it cannot support an interactive preview and save workflow.

The hosting adapter does not provision storage or a routing service. Those are release configuration steps. Public BRouter use is a local evaluation fallback, not an implicit production service commitment. Direct Suunto synchronization is also separate. This feature exports GPX for import through the Suunto app.
