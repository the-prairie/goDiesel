---
status: accepted
date: 2026-07-14
deciders: owner
---

# ADR-0010: Owner curation through a loopback-only writer

## Context

Curation is the editorial heart of the product, and it must write to
`quests.json` and trigger regeneration. But the application is a static bundle on
public hosting. Any deployed write path would be an authenticated,
internet-facing mutation surface for a single-user personal project — all the
risk, none of the benefit.

## Decision

Keep the writer local. `admin.py` is a small `ThreadingHTTPServer` bound to
`127.0.0.1:8766` that the Admin surface probes with a short timeout.

When the writer answers, Admin is a full editor. When it does not, Admin degrades
to `mode: "read-only"` and renders curation from the bundled data. `admin.sh`
starts the writer and the dev server together.

A save validates the closed curation contract, writes `quests.json` atomically,
then stages and individually replaces the route's detail plus manifest preview.
It restores any generated file already replaced, and restores the original
`quests.json`, if publication raises an error. An incomplete generated-file
rollback preserves its recovery copy and reports its path to the operator.
Cleanup after a completed publication is best-effort and does not change the
successful API result.
Source-derived route changes still use the complete generator described in
ADR-0003.

## Consequences

- There is no deployed write path and no authentication system to maintain. The
  security boundary is the loopback interface.
- The deployed Admin is honest about being read-only rather than presenting
  controls that cannot work.
- Curation validation lives in the writer, so `draft` may be partial while
  `reviewed` and `published` require all eight fields — enforced before anything
  is written, and again when the detail record is parsed in the browser.
- A single mutation lock returns 409 on contention, and the live pipeline gate
  security-tests the writer for cross-origin (403), oversize (413), and malformed
  (400) requests against an isolated real-data workspace.
- Cost: a save remains a synchronous local write, but touches only the two
  generated tiers that carry owner-authored curation (ADR-0003).
- Known gap: the two generated-tier replacements are individually atomic but not
  transactional as a pair; a process crash between them requires curation to be
  republished for the affected route or a full rebuild to restore agreement.
- Known gap: routes absent from `activities.csv` are dropped from the Admin
  summary, so an imported-GPX route cannot be curated in the UI.
- Known gap: the origin check admits a literal `Origin: None`.

## Evidence

- `admin.py`, `admin_curation.py`, `admin.sh`
- `app/src/data/admin-repository.ts`, `app/src/surfaces/admin/admin-page.tsx`
- `app/e2e/live-pipeline.spec.ts` (writer security assertions)
- `README.md`: "The deployed Admin is read-only because the loopback writer is
  not available there."
