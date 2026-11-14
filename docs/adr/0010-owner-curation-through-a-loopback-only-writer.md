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
runs the generator synchronously, and restores the original `quests.json` if the
rebuild fails.

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
- Cost: a save blocks on a full rebuild inside the HTTP request (ADR-0003).
- Known gap: routes absent from `activities.csv` are dropped from the Admin
  summary, so an imported-GPX route cannot be curated in the UI.
- Known gap: the origin check admits a literal `Origin: None`.

## Evidence

- `admin.py`, `admin_curation.py`, `admin.sh`
- `app/src/data/admin-repository.ts`, `app/src/pages/admin-page.tsx`
- `app/e2e/live-pipeline.spec.ts` (writer security assertions)
- `README.md`: "The deployed Admin is read-only because the loopback writer is
  not available there."

## Amendment (2026-11-14): her planted moments

The writer's scope widens from curation to one more kind of owner content: the
sketch world's planted moments. These are her catalog (what she has made, each
a scene kind and a clip) and her placements (where each stands on a building).

Why here rather than a new write path:
- It is owner content, and it is private by default. Titles and captions may
  be private jokes, and entries name clips of other people. So it cannot be
  committed or built from `quests.json`.
- It lives outside the generated projections: in the gitignored
  `app/public/moments/moments.json`, next to her clips. `make-dist.sh` ships
  only the entries she flags public, with their placements and clips
  (`app/scripts/moments-dist.mjs`).
- It needs the same protections curation has: one owner, one machine, and no
  deployed mutation surface.

What the writer does for it:
- `GET /api/admin/moments` returns her file, or `null` when there is none.
- `PUT /api/admin/moments` replaces it.
- Both sit behind the same origin check. The PUT also takes the same size cap
  and the same non-blocking owner mutation lock (409 when busy).
- `admin_moments.py` validates the whole document against a closed contract:
  - entries with known kinds;
  - clips only in `/moments/`;
  - placements naming existing entries or none;
  - coordinates, facing and front width in range;
  - no unknown fields.
- It writes the file atomically: a temporary file in the same folder, then
  `os.replace`. A refused or failed save leaves the file as it was.
- There is no rebuild: the file is read by the app at runtime.

Consequences:
- Still loopback-only. Her phone on the LAN can view the sketch world but
  cannot place moments; the review mode says "Placing moments works on the
  laptop" instead of failing silently.
- The live pipeline gate asserts the same refusals for the moments endpoint
  (403 cross-origin, 413 oversize, 400 malformed or inconsistent) and a valid
  write and read-back in its isolated workspace.

Evidence: `admin.py`, `admin_moments.py`, `test_admin_moments.py`,
`app/e2e/live-pipeline.spec.ts`.
