---
status: accepted
date: 2026-07-12
deciders: owner
---

# ADR-0003: The Python generator is the only writer of route data

## Context

Route data derives from private inputs that must not enter this repository or the
browser: a Strava export at `../DieselDiaries` and original GPX/FIT source files.
Deriving that data requires parsing, geocoding, timezone resolution, and
provenance analysis. Doing any of it at runtime would put private inputs and
provider credentials in the client and would make the product's output
non-reproducible.

An earlier failure mode also had to be addressed: a generation run interrupted
partway through left the application reading a mixture of old and new route
records.

## Decision

`build.py` is the single writer of generated route data. The application reads
that data and never writes it.

Publish route data atomically:

1. Write all detail records into a staging directory on the same filesystem.
2. Copy the current route directory and metadata files into
   `.route-generation-backup/`, then `touch` a `ready` marker to commit the
   backup.
3. Swap the staging directory into place with `Path.replace()` and write each
   metadata file via a write-temp-then-replace helper.
4. On any exception, restore from the backup and re-raise.

Run `recover_interrupted_route_publication()` before anything else on every
invocation: no backup is a no-op, a backup without `ready` is discarded, and a
backup with `ready` is fully restored.

## Consequences

- A failed or interrupted generation leaves the previous complete data set in
  place. There is no partially published state.
- Generated data is reproducible by construction, and
  `pipeline_verification.py --rebuild` proves it by regenerating into a temporary
  workspace and byte-comparing every artifact.
- The owner writer (`admin.py`) reuses this path rather than editing generated
  output directly, and restores `quests.json` if a rebuild fails.
- Cost: there is no incremental build. A one-field curation edit pays a full
  re-parse, re-render, and full backup copy synchronously inside an HTTP request.
- `build.py` is a module-level script with no `main()`; importing it executes the
  entire pipeline. This makes it awkward to test or reuse, and is why the
  testable logic was extracted into `route_provenance.py`, `route_imports.py`,
  `route_timezones.py`, and `quest_meta.py`.

## Evidence

- `build.py` (`recover_interrupted_route_publication`, `write_text_atomic`,
  the staging block), `admin.py` (`save_curation_and_rebuild`)
- `pipeline_verification.py`, `test_pipeline_verification.py`
- `6b071504`, `9bc514a7`
