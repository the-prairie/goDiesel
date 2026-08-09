---
last_updated: 2026-08-08
status: canonical
---

# goDiesel Context

This is the canonical domain document for goDiesel, referenced by `AGENTS.md` and
`docs/agents/domain.md`. It defines the vocabulary and invariants of the system.

Use these terms exactly as defined here. Do not introduce synonyms for an
established term. When required language is missing, record it as a
domain-modeling gap in this file rather than inventing a local word.

Architecture decisions live under `docs/adr/`. Product direction lives in
`STRATEGY.md`. This file is the shared language between them.

## 1. Product frame

goDiesel is a personal, immersive atlas for running and cycling experiences.

> Relive where you have been. Discover where to go next.

It turns one person's recorded activity history into an explorable atlas, honest
route guides, and immersive route replays. The owner and only user is Lauren.

The product loop is: plan an experience, complete the route, curate and preserve
it, relive it through immersive replay, and use that memory to choose the next
adventure.

goDiesel is a single bounded context. There is one shared model of a route
spanning generation, curation, presentation, and replay. There are no
sub-contexts and no translation layers between them.

## 2. Core entities

### Route

The central entity. A **route** is a real, specific path through the world,
grounded in recorded activity data and enriched with owner curation.

A route is identified by a **slug**, which is currently always its Strava
**activity id** (for example `17665674778`). The slug is the stable public
identifier and appears in every canonical URL.

A route is **not** a segment, a plan, a workout, or a performance. Metrics exist
to describe the experience, not to score it.

### Activity record

A row in the private Strava export (`../DieselDiaries/activities.csv`, 103
columns). It supplies recorded fact: name, type, date, distance, elevation, and
the pointer to its original **source file**.

### Source file

The original recorded geometry: a GPX or FIT file under `route_sources/`. Source
files are the ground truth for geometry, elevation, and time. Nothing downstream
may contradict them.

### Source kind

`source_kind` names where a route's geometry and metadata come from.

| Value | Meaning |
| --- | --- |
| `strava-export` | The activity row in the Strava export supplies the metadata. |
| `imported-gpx` | The route has a `source_gpx` file. `quests.json` supplies the metadata. |

The value is **derived, never stored**, so it cannot drift away from the data it
describes. `route_imports.route_source_kind()` is the single definition, and
`route_imports.route_metadata()` is the single adapter. Both `build.py` and
`admin.py` use them, so the generator and the curation surface cannot disagree
about a route again.

Current data: 66 `strava-export`, 1 `imported-gpx`.

### Master routes list

`quests.json` at the repository root. The owner-curated record of every known
activity and its editorial state. It currently holds 2,237 activity records, of
which 67 are `approved`.

Only `approved` routes with `visibility != "hidden"` are generated into the
product.

## 3. Lifecycle

`lifecycle` describes a route's relationship to the owner, not its data quality.

| Value | Meaning |
| --- | --- |
| `completed` | The owner recorded this route by doing it. It is a memory. |
| `discovered` | The route's geometry is real and imported, but the owner has not recorded doing it. |
| `planned` | An intention. It has no recorded geometry and is never replay-eligible. |

Current data: 66 `completed`, 1 `discovered`, 0 `planned` generated.

`completed` and `discovered` routes belong to Atlas. `planned` routes belong to
Finder and are deliberately kept distinct from memories. A planned route must
never be presented as something the owner has done.

## 4. Provenance and the honesty rule

**Provenance** is the system's record of how much it actually knows. It is a
first-class part of the route model, not diagnostics.

This is the central design commitment of goDiesel:

> Recorded data is truth. Everything else must be labelled as what it is.
> Never let editorial language or a rendering convenience silently become
> source truth.

### Evidence labels

Every value the product presents is one of:

| Label | Meaning |
| --- | --- |
| `recorded` | Read directly from a source file or activity record. |
| `derived` | Computed deterministically from recorded values. |
| `measured` | Observed from an external provider (for example Earth observation). |
| `hypothesis` | Interpretation. Editorial, and must be visibly marked as such. |

### Temporal provenance

`provenance.temporal.status` is exactly `recorded` or `unavailable`. There is no
guessed timestamp and no third state. When time is unavailable, the product says
so rather than estimating.

### Discontinuity

A **discontinuity** is a gap in what was recorded. It is classified only from
recorded evidence, never inferred from point spacing. Each kind names the source
that proves it:

| `kind` | `source` |
| --- | --- |
| `segment_boundary` | `recorded_track_segment` |
| `recording_gap` | `recorded_timestamps` |
| `missing_position_records` | `recorded_position_absence` |

`kind` and `source` must always agree. This pairing is enforced at parse time.

### Repair

A **repair** is the presentation of a discontinuity on a route: an honest,
visible mark showing where the recording broke. A repair states evidence. It
never bridges, smooths, or invents geometry across the gap.

### Geometry status

`replay.geometryStatus` is `ready`, `missing`, or `invalid`. Geometry that is not
`ready` gates rendering: the product declines to draw rather than drawing
something plausible.

## 5. Curation

**Curation** is the owner's experiential guide to a route: what it feels like and
what kind of day it suits. It is the editorial layer that turns activity data
into a route guide.

The curation contract has exactly eight content fields:
`vibe`, `ideal_use`, `terrain`, `difficulty`, `highlights`, `caveats`,
`seasonality`, `editorial_note`.

The schema is closed. Unknown fields are rejected rather than ignored.

**Review status** is the curation state machine:

| Value | Meaning |
| --- | --- |
| `draft` | Partial curation is allowed. Presented as not yet reviewed. |
| `reviewed` | The owner has approved it. All eight fields are required. |
| `published` | Same completeness requirement as `reviewed`. |

Current data: 66 `draft`, 1 `reviewed`.

An unreviewed route shows the neutral label "Guide not yet reviewed". It must
never be given invented claims to fill the space.

## 6. Surfaces

The five product surfaces. These names are canonical and appear in navigation,
routing, and tests.

| Surface | Path | Question it answers |
| --- | --- | --- |
| **Atlas** | `#/atlas` | Where have I been, and what was it like? |
| **Finder** | `#/finder` | Where should I go next, and which route fits? |
| **Routes** | `#/routes` | The route library, the index to the atlas. |
| **Replay** | `#/replay/<slug>` | What did it feel like to move through it? |
| **Admin** | `#/admin` | Owner curation. |

The root redirects to Atlas. Atlas is the home of the product; the card gallery
is not.

### Related surface terms

- **Leaf** — a single route's detail page, the field-guide page for one route.
  Used in code (`RouteLeaf`, `RouteLeafMap`) and in tests.
- **Region** — a group of routes sharing a free-text region label
  (for example `Tokyo, Japan`). Regions are the Atlas's intermediate camera
  scale between the globe and a route. Region labels are data, not a taxonomy.
- **Lab** — an experiment under `#/lab/*`. A lab is explicitly not production
  and carries no production commitment. See ADR-0008.
- **Microsite** — a route-scoped public share containing exactly one route's
  data. See ADR-0011.

## 7. Replay

**Replay** is immersive playback of a recorded route through real-world imagery.

**Replay mode** describes the intended visual world for a route:

| Value | Meaning |
| --- | --- |
| `earth` | Best experienced in photorealistic 3D. |
| `atlas` | Best experienced on the 2D map. |

Current data: 60 `atlas`, 7 `earth`.

**`bestInEarth`** marks a route the owner considers a showcase for
photorealistic replay. A `bestInEarth` route must use `earth` mode.

**Replay eligibility** is derived, never asserted directly:

```
replayEligible = lifecycle !== "planned"
              && geometryStatus === "ready"
              && replay_eligible
```

**Grounding** is the reconciliation of recorded elevation against provider mesh
height. Recorded elevation is the truth; provider height supplies only a bounded
corrective offset. Grounding reports its own `source` and `reason` so the
interface can state which it used.

**Degradation** is the named, visible reduction of replay fidelity when a
provider fails. Replay status is exactly one of `loading`, `ready`, `partial`,
or `unavailable`. `partial` means the replay continues with known gaps. The
product never presents a degraded scene as a complete one.

## 8. Naming rules

### Route, not quest

The product noun is **route**. "Quest" is legacy vocabulary from the original
prototype and survives only in:

- `quests.json` (the master routes list)
- the `QuestRoute` TypeScript type
- `quests.generated.json`
- the legacy `#quest/<slug>` hash, which is canonicalized to `#/routes/<slug>`

Do not add new "quest" naming. Do not rename existing occurrences opportunistically
either; they are a data and type contract, and renaming them is its own ticket.

### Case boundary

Generated JSON is `snake_case`. The TypeScript domain layer is `camelCase`. The
parsing functions in `app/src/domain/route/` are the only sanctioned boundary
between the two conventions. That directory splits along the two tiers of
ADR-0004: `summary-parse.ts` is lenient and `detail-parse.ts` is strict. Import
the contract as `@/domain/route`.

### Non-canonical words

These appear in the repository but are **not** domain vocabulary. Do not build on
them without first establishing them here:

- *kintsugi* — appears only as the filename `app/e2e/kintsugi-repairs.spec.ts`.
  The domain term for the concept is **repair** (section 4).
- *Retrace* — appears only in one test title. The domain term is **Replay**.
- *weathered*, *field guide*, *recorded light*, *Route Genome* — design and
  research vocabulary from `docs/plans/` and `docs/spikes/`. They describe visual
  treatment and experiments, not the route model. `recorded light` and
  `Route Genome` do exist in code and are legitimate names for those specific
  modules; they are simply not part of the core route contract.

## 9. Invariants

These hold across the whole system. Breaking one is a defect, not a tradeoff.

1. Generated route data is produced only by `build.py`. The application reads it
   and never writes it. See ADR-0003.
2. Route detail records are published atomically. A failed generation leaves the
   previous complete data set in place. See ADR-0003.
3. `kind` and `source` agree on every discontinuity.
4. `bestInEarth` implies `earth` replay mode.
5. A `planned` route is never replay-eligible.
6. `reviewed` and `published` curation is complete in all eight fields.
7. Distance (`d`) and elapsed time along a route are monotonically
   non-decreasing.
8. No geometry is ever interpolated across a discontinuity.
9. The route data model and canonical URLs are stable. Redesign work does not
   change them.
10. A microsite bundle contains exactly one route's data.
11. Production code never imports from `labs/`. `app/router.tsx` is the single
    exception, because it is the composition root that builds the route table.
12. `domain/` imports no upward layer, and no surface imports another surface.
    Shared components live in `ui/`.

Invariants 11 and 12 are enforced by `app/src/structure.test.ts`.

## 10. Where things live

| Concern | Location |
| --- | --- |
| Master routes list | `quests.json` |
| Recorded source files | `route_sources/` |
| Generator | `build.py` and the extracted `route_*.py` / `quest_meta.py` modules |
| Owner writer | `admin.py` (loopback only) |
| Route summaries (bundled) | `app/src/data/generated/routes.manifest.json` |
| Route details (lazy) | `app/public/data/routes/<slug>.json` |
| Application shell, routing | `app/src/app/` |
| Domain model (pure) | `app/src/domain/`, with the contract in `app/src/domain/route/` |
| Data access | `app/src/data/` |
| Shared provider plumbing | `app/src/providers/` |
| The five surfaces | `app/src/surfaces/<surface>/` |
| Labs (no production commitment) | `app/src/labs/` |
| Design system and shared components | `app/src/ui/` |
| Private inputs | `../DieselDiaries`, `../Travel` (outside this repository) |

## 11. Domain-modeling gaps

Recorded per `docs/agents/domain.md`. These are known missing pieces of language,
not tasks with owners.

1. **Region has no taxonomy.** `region` is a free-text label produced by
   geocoding, and three separate region mappings exist in the Python layer
   (bounding boxes in `build.py`, `REGIONS` in `admin.py`, and
   `REGION_TIME_ZONES`). They can disagree, which silently drops a route's
   timezone. The domain has no single definition of a region.
2. ~~**`source_kind` is not modelled.**~~ **Closed 2026-08-08.** See section 2.
3. **`bestInEarth` is editorial data stored in code.** It is a hardcoded set of
   activity ids in `build.py` rather than curation held in `quests.json`.
4. **"Difficulty" is overloaded.** It exists both as a generated quest attribute
   and as a curated prose field, with no stated relationship between them.
