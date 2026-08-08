---
status: proposed
date: 2026-08-08
scope: app/src only
---

# Proposed Code File Reorganization Plan

This plan proposes a new folder structure for `app/src`. **Nothing has been
changed.** Every recommendation below is reviewable and independently
executable.

Read `CONTEXT.md` for vocabulary and `docs/adr/README.md` for the decisions this
plan is built to respect.

## Contents

1. [How this was analysed](#1-how-this-was-analysed)
2. [What is wrong today](#2-what-is-wrong-today)
3. [Design principles](#3-design-principles)
4. [The proposed structure](#4-the-proposed-structure)
5. [Why this structure, and alternatives rejected](#5-why-this-structure-and-alternatives-rejected)
6. [Complete move table](#6-complete-move-table)
7. [Proposed merges](#7-proposed-merges)
8. [Proposed splits](#8-proposed-splits)
9. [Proposed deletions](#9-proposed-deletions)
10. [Calling-code and configuration impact](#10-calling-code-and-configuration-impact)
11. [Execution plan](#11-execution-plan)
12. [Risk register](#12-risk-register)
13. [What this plan deliberately does not do](#13-what-this-plan-deliberately-does-not-do)
14. [Appendix: measurements](#14-appendix-measurements)

---

## 1. How this was analysed

Every file in `app/src` was read, and the dependency graph was computed
mechanically rather than by eye.

- **147 files**, 143 of them `.ts`/`.tsx`, **25,375 lines**.
- **106 production modules**, 37 co-located test files.
- **401 internal import edges** resolved and verified: only 2 were unresolvable,
  and both point out of `src` at `app/scripts/*.mjs` test subjects.
- Fan-in and fan-out computed per file; cross-folder edges tabulated; cycles and
  layering violations detected programmatically.
- Duplicate function definitions detected by name across all production files.

Four parallel audits then read every file in detail — `replay/`+`atlas/`,
`components/`, `domain/`+`data/`+root, and `pages/` — to establish each file's
single responsibility, its natural cohesion group, and whether it should merge or
split. Their per-file findings back the tables below.

### Two measurements that shape the whole plan

**Finding A — imports are absolute, so moves are mechanical.**
399 of 401 internal imports use the `@/` alias. Only 2 are relative. This has a
decisive consequence:

> Moving a file **never breaks that file's own imports**. It only breaks the
> import specifiers in the files that reference it.

So the full change set is a bounded, enumerable list of specifier rewrites — not
a cascade.

**Finding B — TypeScript can verify the entire rewrite.**
There are no `import.meta.glob` calls, no template-literal imports, and no
`require()`. All 13 dynamic imports use static string literals, including the 12
`lazy(() => import("@/pages/..."))` calls in `router.tsx`. Every one is resolved
by `tsc` through the `paths` mapping in `tsconfig.json`.

> `npm run typecheck` is a **complete** verifier for the mechanical part of this
> refactor. A missed import path cannot reach a commit.

That is why this plan is safe to execute, and Section 10 lists the small number
of couplings that `tsc` **cannot** see, which are the only real hazards.

---

## 2. What is wrong today

Current top-level shape of `app/src`:

| Folder | Files | Lines |
| --- | --- | --- |
| `components/` | 45 | 8,893 |
| `replay/` | 35 | 7,405 |
| `domain/` | 25 | 3,574 |
| `pages/` | 12 | 2,774 |
| `data/` | 11 | 863 |
| *(root)* | 6 | 295 |
| `atlas/` | 4 | 928 |
| `config/` | 2 | 36 |
| `hooks/` | 2 | 38 |
| `lib/` | 1 | 6 |

### 2.1 One feature is split across two top-level folders, and they import each other

The Atlas world is in **both** `atlas/` and `components/globe/`:

- `components/globe/atlas-world.ts` holds the `AtlasWorldEngine` **port** — an
  interface with samplers and no JSX at all.
- `atlas/cesium-atlas-world-engine.ts` (730 lines) is its **implementation**.

They import each other across the top-level boundary:

```
atlas/cesium-atlas-world-engine.ts        ->  components/globe/atlas-world.ts
components/globe/cesium-atlas-globe.tsx   ->  atlas/cesium-atlas-world-engine.ts
components/globe/atlas-regional-fallback.tsx -> atlas/atlas-region-camera.ts
```

An implementation reaching up into `components/` for the interface it implements
is a layering violation, and the folder name `globe` no longer matches the
domain noun (**Atlas**) that `CONTEXT.md` §6 defines.

### 2.2 `replay/` has two competing organising axes and an 8-file residue

`cesium/`, `google/`, `atlas/` are a **provider** axis. `cinematic/`, `scene/`,
`camera/` are a **concern** axis. The eight modules at `replay/` root are
whatever was never assigned to either. Three of them directly contradict any
rule you could infer:

| File | L | Contradiction |
| --- | --- | --- |
| `playable-earth-viewer.ts` | 409 | a Cesium renderer sitting outside `cesium/` |
| `cinematic-route-trailer-controller.ts` | 189 | a cinematic module outside `cinematic/` |
| `google-route-navigator-controller.ts` | 239 | provider-neutral (zero `google.maps` references) yet named `google` and outside `google/` |

Worse, **`replay/atlas/` collides by name with top-level `atlas/`** while meaning
something entirely different: `replay/atlas/` is the MapLibre engine for replay
*mode* `atlas`; `atlas/` is the **Atlas surface** of ADR-0006. Two different
domain nouns, one folder name, two levels apart.

Three of those subfolders hold a single production module each
(`replay/atlas/`, `replay/camera/`, `replay/scene/`) and `replay/google/` holds
two. They add depth without adding information. The same is true elsewhere in the
tree: `components/search/`, `config/` and `lib/` each hold exactly one production
module.

### 2.3 `components/` is four unrelated tiers in one folder

The folder name does no routing work — everything with a `.tsx` extension landed
there regardless of role:

- **Design-system primitives** — `ui/` (7 files, vendored shadcn).
- **Application chrome** — `app-shell.tsx`, `atlas-spine.tsx`,
  `atlas-immersive-navigation.tsx`, `page-title.tsx`, `metric.tsx`.
- **Feature UI** — `admin/`, `finder/`, `globe/`, `replay/`, `routes/`,
  `search/`.
- **Not components at all** — `globe/atlas-world.ts` (a port) and
  `globe/atlas-label-layout.ts` (pure collision maths).

### 2.4 `domain/` is a flat bag of four different natures

| Nature | Modules |
| --- | --- |
| Core contract | `routes.ts` (664 L, fan-in 66), `route-lifecycle.ts` |
| Derived geometry / presentation | `geographic-bounds`, `route-visualization`, `route-repairs`, `recorded-light`, `route-thread-style` |
| Feature logic for exactly one surface | `route-filters` (Routes), `planning` (Finder), `admin-curation` (Admin), `atlas-selection` (Atlas) |
| Lab / experiment | `route-genome` (299 L), `route-film` (632 L) |

`CONTEXT.md` §8 explicitly lists "Route Genome" as research vocabulary that is
*not* part of the core route contract — yet it sits in `domain/`, the folder
`CONTEXT.md` §10 designates for the domain model.

### 2.5 Working on one surface means touching up to five top-level folders

To change the Atlas today you open `atlas/`, `components/globe/`,
`components/search/`, `components/atlas-spine.tsx`, `domain/atlas-selection.ts`,
`data/route-regions.ts`, and `pages/atlas-page.tsx`. Nothing in the tree tells
you those belong together.

### 2.6 Labs are interleaved with production

ADR-0008 makes "lab" a first-class concept with **no production commitment**, and
`router.tsx` plus `app-shell.tsx` already branch on `/lab/`. But the six lab
pages sit in `pages/` beside the six product pages, and the Playable Earth lab's
viewer and controller sit in `replay/` beside production engines. The structure
gives no hint which code carries a production promise.

Two consequences are already visible in the code: the production
`google-route-navigator-stage.tsx` defaults `backPath` to
`/lab/route-intelligence`, and the production Cesium replay engine imports its
grounding algorithm from the Playable Earth **lab** controller.

### 2.7 Real defects the flat structure has been hiding

Detected mechanically, not by opinion:

- **2 import cycles.** `replay-engine.ts` (the port) imports its own
  implementations for its factory, while they import its types:
  `replay-engine.ts <-> cesium-replay-engine.ts` and
  `replay-engine.ts <-> maplibre-atlas-replay-engine.ts`.
- **2 layering violations.** `domain/atlas-selection.ts` imports
  `data/route-regions.ts` (pure domain depending on the data layer), and
  `atlas/cesium-atlas-world-engine.ts` imports `@/replay/replay-health` — the
  **Atlas surface depending on the Replay folder** for its own degradation logic.
- **16 duplicated function names** across production files, including `clamp`
  8x, `webglAvailable` 4x, `interpolate`/`interpolateHeading` 3x each,
  `canvasLooksBlank` 2x, `pointAtDistance` 2x, `numberValue`/`stringValue` 2x,
  and a `Metric` component reimplemented 3x.
- **`REPLAY_DURATION_SECONDS` is declared privately three times** as 180, 180,
  and **210** — a silent behavioural divergence on the ADR-0009 primary path.
- **~850 lines of dead files** plus further dead exports (Section 9).

---

## 3. Design principles

The target structure is derived from five rules, in priority order.

**P1 — The tree mirrors the documented product model.**
`CONTEXT.md` §6 defines exactly five surfaces (Atlas, Finder, Routes, Replay,
Admin) and separately defines **Lab**. A newcomer who has read `CONTEXT.md`
should be able to predict the folder layout, and vice versa. This is the single
strongest source of intuitiveness available, and it costs nothing to adopt.

**P2 — Locality of change beats taxonomic purity.**
Files that change together should sit together. A ticket scoped to one surface
should open one folder.

**P3 — Purity is a directory boundary, not a convention.**
`domain/` stays free of React and IO so it remains trivially testable. The
dependency direction is already acyclic and layered; the structure should make
that visible and make violations obvious on sight.

**P4 — Depth is capped.**
No path deeper than `src/<area>/<group>/<file>` for shared code, or
`src/surfaces/<surface>/<group>/<file>` for surface code. That is a maximum of
four segments below `src`, and most files sit at three.

**P5 — A folder must earn its existence.**
A folder holding one file is noise. Collapse it, or name its contents with a
prefix instead.

---

## 4. The proposed structure

```text
app/src/
  index.css
  app/                       # how the app boots, routes, and frames itself
    main.tsx  App.tsx  router.tsx  app-shell.tsx
    route-paths.ts           # <- navigation.ts
    single-route-microsite.ts
    vite-env.d.ts
  domain/                    # pure: types, parsing, derivation. no React, no IO
    route/                   # the route contract (ADR-0004 two-tier parsing)
      contract.ts  parse-shared.ts  summary-parse.ts  detail-parse.ts
      lifecycle.ts  index.ts
    geometry/                # pure derivation over recorded traces
      route-path.ts  geographic-bounds.ts  route-visualization.ts
      route-repairs.ts  recorded-light.ts  route-thread-style.ts
      numeric.ts             # NEW: the single clamp/mix/interpolate/heading module
  data/                      # data access and bindings
    routes.ts  route-repository.ts  use-route-detail.ts  route-regions.ts
    admin-repository.ts  discovery-provider.ts  planned-route-store.ts
    route-library-return.ts
    generated/               # committed generated data (path unchanged; see 10.2)
  providers/                 # renderer plumbing shared by more than one surface
    render-health.ts         # <- replay/replay-health.ts (+ canvas/webgl probes)
    webgl.ts  canvas-blankness.ts
    cesium-render-quality.ts  cesium-viewer-options.ts
    google-maps-loader.ts
    maplibre/                # NEW: the one OpenFreeMap map implementation
      openfreemap-style.ts  use-maplibre-map.ts  route-thread-layers.ts
  surfaces/                  # one folder per product surface (CONTEXT.md 6)
    atlas/
      atlas-page.tsx  atlas-world.ts  cesium-atlas-world-engine.ts
      atlas-region-camera.ts  atlas-label-layout.ts  atlas-selection.ts
      components/
    routes/
      routes-page.tsx  route-detail-page.tsx  route-filters.ts
      components/
    replay/
      replay-page.tsx  renderer-port.ts
      playback/  scene/  renderers/  cinematic/  components/
    finder/
      finder-page.tsx  planning.ts  components/
    admin/
      admin-page.tsx  admin-curation.ts  components/
  labs/                      # experiments. no production commitment (ADR-0008)
    playable-earth/  route-intelligence/  cinematic/
    google-route-navigator/  design-system/  route-film/
  ui/                        # design system primitives and shared chrome
    button.tsx  input.tsx  sheet.tsx  separator.tsx  skeleton.tsx  tooltip.tsx
    page-title.tsx  metric.tsx  utils.ts  use-mobile.ts  use-reduced-motion.ts
```

Seven top-level folders, each with a one-sentence charter:

| Folder | Charter | Files |
| --- | --- | --- |
| `app/` | How the application boots, routes, and frames itself. | 9 |
| `domain/` | The route model and pure derivation. No React, no IO. | 15 |
| `data/` | Reading route data and holding client state. | 11 |
| `providers/` | Third-party renderer plumbing shared by more than one surface. | 6+ |
| `surfaces/` | The five product surfaces of `CONTEXT.md` §6. | 77 |
| `labs/` | Experiments with no production commitment (ADR-0008). | 14 |
| `ui/` | Design system primitives and shared chrome. | 10 |


---

## 5. Why this structure, and alternatives rejected

### 5.1 Why `surfaces/` rather than `features/`

`CONTEXT.md` §6 is titled **Surfaces** and names the five. `docs/agents/domain.md`
instructs: *"Do not replace established terms with new synonyms."* `features/` is
the more common React convention, but it would introduce a synonym for a term this
repository has already established and documented. Adopting `surfaces/` makes the
tree and the domain document reinforce each other.

### 5.2 Why a `surfaces/` parent instead of five top-level surface folders

Five surface folders at the top level would put `atlas/`, `replay/`, `routes/`,
`finder/`, `admin/` beside `domain/`, `data/`, `ui/`, `app/`, `providers/` and
`labs/` — eleven top-level entries with no signal about which are product
surfaces and which are infrastructure. The `surfaces/` parent answers "what kind
of thing is this folder?" at a glance and costs exactly one path segment.

### 5.3 Why labs are separated by folder, not by a naming convention

ADR-0008 is an accepted decision that a lab carries **no production commitment**,
and it was reached by declining to ship something that demoed well. A naming
convention (`*-lab-page.tsx`) is invisible when you are three files deep in an
import chain. A folder boundary makes "am I about to make production depend on a
lab?" a structural question. It would have caught both existing erosions: the
production stage defaulting `backPath` into `/lab/route-intelligence`, and the
production Cesium engine importing grounding from the lab controller.

The grounding algorithm is genuinely production logic that happens to live in a
lab file. Section 8.3 extracts it rather than letting the folder boundary force a
bad move.

### 5.4 Why `providers/` and not `world/`, `render/`, or `shared/`

The code here is exactly the plumbing for the third parties that ADR-0007 names:
Cesium options, the Google Maps loader, the OpenFreeMap style, and the probes that
detect provider failure. "Provider" is the word `CONTEXT.md` §7 and ADR-0007
already use ("when a provider fails", "provider mesh height"). `world/` would
collide with the Atlas **world** engine, and `shared/` is a name that attracts
anything.

### 5.5 Why not organise strictly by layer (the status quo, tidied)

Keeping `domain/`, `data/`, `components/`, `pages/` and merely sorting within them
was considered, and rejected for one reason: it preserves problem 2.5. Locality of
change is the property this codebase most lacks, and a layer-first tree
structurally cannot provide it.

The hybrid chosen here keeps layer boundaries where they carry real constraints
(`domain/` is pure, `data/` owns IO, `ui/` is generic) and switches to surfaces
where the layers were only sorting React components by extension.

### 5.6 Why not a vertical slice per surface, including its own `domain/`

Fully vertical slices (`surfaces/atlas/domain/`, `surfaces/replay/domain/`, ...)
would fragment the route contract, which has fan-in 66 and is the one thing every
surface shares. `CONTEXT.md` states goDiesel is a **single bounded context** with
"one shared model of a route... no sub-contexts and no translation layers". A
per-surface domain folder would contradict that directly.

Feature logic that genuinely belongs to exactly one surface **does** move into
that surface (`route-filters`, `planning`, `admin-curation`, `atlas-selection`) —
because each has exactly one consumer and no claim to be shared.

### 5.7 Why co-located tests stay co-located

`vitest.config.ts` includes `src/**/*.test.ts(x)`, which is structure-independent.
Co-location means a move never separates a module from its test, and the 37 test
files move as luggage with their subjects. No test path is configured anywhere, so
there is nothing to update.

---

## 6. Complete move table

**130 files move, 2 are deleted, 349 import specifiers are rewritten across 122
files.** Sorted by destination. `L` is current line count; the last column is the
number of import specifiers that must be updated because of that one move.


### `app/` — bootstrap, routing, shell

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `App.tsx` | `app/App.tsx` | 5 | 1 |
| 2 | `components/app-shell.tsx` | `app/app-shell.tsx` | 89 | 1 |
| 3 | `main.tsx` | `app/main.tsx` | 11 | 0 |
| 4 | `navigation.test.ts` | `app/route-paths.test.ts` | 21 | 0 |
| 5 | `navigation.ts` | `app/route-paths.ts` | 108 | 19 |
| 6 | `router.tsx` | `app/router.tsx` | 141 | 1 |
| 7 | `config/single-route-microsite.test.ts` | `app/single-route-microsite.test.ts` | 18 | 0 |
| 8 | `config/single-route-microsite.ts` | `app/single-route-microsite.ts` | 18 | 6 |
| 9 | `vite-env.d.ts` | `app/vite-env.d.ts` | 9 | 0 |

### `domain/` — pure route model and geometry

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `domain/geographic-bounds.test.ts` | `domain/geometry/geographic-bounds.test.ts` | 106 | 0 |
| 2 | `domain/geographic-bounds.ts` | `domain/geometry/geographic-bounds.ts` | 100 | 3 |
| 3 | `domain/recorded-light.test.ts` | `domain/geometry/recorded-light.test.ts` | 50 | 0 |
| 4 | `domain/recorded-light.ts` | `domain/geometry/recorded-light.ts` | 88 | 4 |
| 5 | `replay/route-path.ts` | `domain/geometry/route-path.ts` | 63 | 11 |
| 6 | `domain/route-repairs.test.ts` | `domain/geometry/route-repairs.test.ts` | 46 | 0 |
| 7 | `domain/route-repairs.ts` | `domain/geometry/route-repairs.ts` | 92 | 4 |
| 8 | `domain/route-thread-style.test.ts` | `domain/geometry/route-thread-style.test.ts` | 14 | 0 |
| 9 | `domain/route-thread-style.ts` | `domain/geometry/route-thread-style.ts` | 5 | 5 |
| 10 | `domain/route-visualization.test.ts` | `domain/geometry/route-visualization.test.ts` | 53 | 0 |
| 11 | `domain/route-visualization.ts` | `domain/geometry/route-visualization.ts` | 77 | 4 |
| 12 | `domain/routes.test.ts` | `domain/route/contract.test.ts` | 439 | 0 |
| 13 | `domain/routes.ts` | `domain/route/contract.ts` | 664 | 66 |
| 14 | `domain/route-lifecycle.ts` | `domain/route/route-lifecycle.ts` | 10 | 3 |

### `data/` — data access

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |

### `providers/` — shared renderer plumbing

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `replay/cesium/cesium-render-quality.test.ts` | `providers/cesium-render-quality.test.ts` | 21 | 0 |
| 2 | `replay/cesium/cesium-render-quality.ts` | `providers/cesium-render-quality.ts` | 10 | 5 |
| 3 | `replay/google/google-maps-loader.test.ts` | `providers/google-maps-loader.test.ts` | 67 | 0 |
| 4 | `replay/google/google-maps-loader.ts` | `providers/google-maps-loader.ts` | 87 | 2 |
| 5 | `replay/replay-health.test.ts` | `providers/render-health.test.ts` | 33 | 0 |
| 6 | `replay/replay-health.ts` | `providers/render-health.ts` | 26 | 3 |

### `surfaces/atlas/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `components/globe/atlas-label-layout.ts` | `surfaces/atlas/atlas-label-layout.ts` | 53 | 2 |
| 2 | `pages/atlas-page.tsx` | `surfaces/atlas/atlas-page.tsx` | 195 | 1 |
| 3 | `atlas/atlas-region-camera.test.ts` | `surfaces/atlas/atlas-region-camera.test.ts` | 45 | 0 |
| 4 | `atlas/atlas-region-camera.ts` | `surfaces/atlas/atlas-region-camera.ts` | 66 | 3 |
| 5 | `domain/atlas-selection.test.ts` | `surfaces/atlas/atlas-selection.test.ts` | 34 | 0 |
| 6 | `domain/atlas-selection.ts` | `surfaces/atlas/atlas-selection.ts` | 28 | 2 |
| 7 | `components/globe/atlas-world.test.ts` | `surfaces/atlas/atlas-world.test.ts` | 59 | 0 |
| 8 | `components/globe/atlas-world.ts` | `surfaces/atlas/atlas-world.ts` | 93 | 5 |
| 9 | `atlas/cesium-atlas-world-engine.test.ts` | `surfaces/atlas/cesium-atlas-world-engine.test.ts` | 87 | 0 |
| 10 | `atlas/cesium-atlas-world-engine.ts` | `surfaces/atlas/cesium-atlas-world-engine.ts` | 730 | 2 |
| 11 | `components/globe/atlas-controls.tsx` | `surfaces/atlas/components/atlas-controls.tsx` | 135 | 1 |
| 12 | `components/globe/atlas-globe.tsx` | `surfaces/atlas/components/atlas-globe.tsx` | 30 | 1 |
| 13 | `components/atlas-immersive-navigation.tsx` | `surfaces/atlas/components/atlas-immersive-navigation.tsx` | 125 | 1 |
| 14 | `components/globe/atlas-regional-fallback.test.tsx` | `surfaces/atlas/components/atlas-regional-fallback.test.tsx` | 155 | 0 |
| 15 | `components/globe/atlas-regional-fallback.tsx` | `surfaces/atlas/components/atlas-regional-fallback.tsx` | 440 | 2 |
| 16 | `components/search/atlas-search.tsx` | `surfaces/atlas/components/atlas-search.tsx` | 239 | 1 |
| 17 | `components/atlas-spine.tsx` | `surfaces/atlas/components/atlas-spine.tsx` | 132 | 1 |
| 18 | `components/globe/cesium-atlas-globe.tsx` | `surfaces/atlas/components/cesium-atlas-globe.tsx` | 224 | 1 |
| 19 | `components/globe/region-route-carousel.test.tsx` | `surfaces/atlas/components/region-route-carousel.test.tsx` | 54 | 0 |
| 20 | `components/globe/region-route-carousel.tsx` | `surfaces/atlas/components/region-route-carousel.tsx` | 455 | 2 |
| 21 | `components/globe/route-satellite-thumbnail.test.ts` | `surfaces/atlas/components/route-satellite-thumbnail.test.ts` | 67 | 0 |
| 22 | `components/globe/route-satellite-thumbnail.tsx` | `surfaces/atlas/components/route-satellite-thumbnail.tsx` | 136 | 2 |

### `surfaces/routes/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `components/routes/repair-evidence.tsx` | `surfaces/routes/components/repair-evidence.tsx` | 36 | 2 |
| 2 | `components/routes/route-briefing.tsx` | `surfaces/routes/components/route-briefing.tsx` | 212 | 1 |
| 3 | `components/routes/route-card.tsx` | `surfaces/routes/components/route-card.tsx` | 260 | 2 |
| 4 | `components/routes/route-guide.tsx` | `surfaces/routes/components/route-guide.tsx` | 151 | 1 |
| 5 | `components/routes/route-leaf-map.tsx` | `surfaces/routes/components/route-leaf-map.tsx` | 346 | 1 |
| 6 | `components/routes/route-not-found.tsx` | `surfaces/routes/components/route-not-found.tsx` | 20 | 6 |
| 7 | `pages/route-detail-page.tsx` | `surfaces/routes/route-detail-page.tsx` | 331 | 1 |
| 8 | `domain/route-filters.test.ts` | `surfaces/routes/route-filters.test.ts` | 167 | 0 |
| 9 | `domain/route-filters.ts` | `surfaces/routes/route-filters.ts` | 80 | 2 |
| 10 | `pages/routes-page.tsx` | `surfaces/routes/routes-page.tsx` | 410 | 1 |

### `surfaces/replay/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `replay/cinematic/cesium-cinematic-renderer.ts` | `surfaces/replay/cinematic/cesium-cinematic-renderer.ts` | 319 | 2 |
| 2 | `components/replay/cinematic-director-stage.tsx` | `surfaces/replay/cinematic/cinematic-director-stage.tsx` | 538 | 1 |
| 3 | `replay/cinematic/cinematic-route-filament.ts` | `surfaces/replay/cinematic/cinematic-route-filament.ts` | 128 | 3 |
| 4 | `components/replay/cinematic-route-trailer-stage.tsx` | `surfaces/replay/cinematic/cinematic-route-trailer-stage.tsx` | 308 | 1 |
| 5 | `replay/cinematic/cinematic-soundscape.test.ts` | `surfaces/replay/cinematic/cinematic-soundscape.test.ts` | 35 | 0 |
| 6 | `replay/cinematic/cinematic-soundscape.ts` | `surfaces/replay/cinematic/cinematic-soundscape.ts` | 221 | 2 |
| 7 | `replay/cinematic/native-cinematic-renderer.test.ts` | `surfaces/replay/cinematic/native-cinematic-renderer.test.ts` | 174 | 0 |
| 8 | `replay/cinematic/native-cinematic-renderer.ts` | `surfaces/replay/cinematic/native-cinematic-renderer.ts` | 122 | 2 |
| 9 | `replay/cinematic/route-cinematic-director.test.ts` | `surfaces/replay/cinematic/route-cinematic-director.test.ts` | 296 | 0 |
| 10 | `replay/cinematic/route-cinematic-director.ts` | `surfaces/replay/cinematic/route-cinematic-director.ts` | 1286 | 7 |
| 11 | `replay/cinematic/route-film-export.test.ts` | `surfaces/replay/cinematic/route-film-export.test.ts` | 355 | 0 |
| 12 | `replay/cinematic/route-film-review.test.ts` | `surfaces/replay/cinematic/route-film-review.test.ts` | 147 | 0 |
| 13 | `replay/cinematic-route-trailer-controller.test.ts` | `surfaces/replay/cinematic/route-trailer-controller.test.ts` | 46 | 0 |
| 14 | `replay/cinematic-route-trailer-controller.ts` | `surfaces/replay/cinematic/route-trailer-controller.ts` | 189 | 2 |
| 15 | `components/replay/earth-replay-stage.tsx` | `surfaces/replay/components/earth-replay-stage.tsx` | 546 | 1 |
| 16 | `components/replay/google-route-navigator-stage.tsx` | `surfaces/replay/components/google-route-navigator-stage.tsx` | 829 | 2 |
| 17 | `components/replay/recorded-light-layer.tsx` | `surfaces/replay/components/recorded-light-layer.tsx` | 50 | 2 |
| 18 | `components/replay/replay-elevation-scrubber.tsx` | `surfaces/replay/components/replay-elevation-scrubber.tsx` | 311 | 2 |
| 19 | `components/replay/replay-route-picker.tsx` | `surfaces/replay/components/replay-route-picker.tsx` | 192 | 2 |
| 20 | `components/replay/route-context-hud.tsx` | `surfaces/replay/components/route-context-hud.tsx` | 113 | 2 |
| 21 | `replay/replay-controller.test.ts` | `surfaces/replay/playback/replay-controller.test.ts` | 66 | 0 |
| 22 | `replay/replay-controller.ts` | `surfaces/replay/playback/replay-controller.ts` | 109 | 6 |
| 23 | `replay/google-route-navigator-controller.test.ts` | `surfaces/replay/playback/route-navigator-controller.test.ts` | 154 | 0 |
| 24 | `replay/google-route-navigator-controller.ts` | `surfaces/replay/playback/route-navigator-controller.ts` | 239 | 7 |
| 25 | `replay/replay-engine.ts` | `surfaces/replay/renderer-port.ts` | 39 | 3 |
| 26 | `replay/cesium/cesium-replay-engine.ts` | `surfaces/replay/renderers/cesium-replay-engine.ts` | 689 | 1 |
| 27 | `replay/google/google-route-navigator-engine.ts` | `surfaces/replay/renderers/google-route-navigator-engine.ts` | 390 | 3 |
| 28 | `replay/atlas/maplibre-atlas-replay-engine.ts` | `surfaces/replay/renderers/maplibre-replay-engine.ts` | 169 | 1 |
| 29 | `replay/cesium/replay-camera-clearance.test.ts` | `surfaces/replay/renderers/replay-camera-clearance.test.ts` | 82 | 0 |
| 30 | `replay/cesium/replay-camera-clearance.ts` | `surfaces/replay/renderers/replay-camera-clearance.ts` | 74 | 2 |
| 31 | `pages/replay-page.tsx` | `surfaces/replay/replay-page.tsx` | 89 | 1 |
| 32 | `replay/camera/route-camera-stabilizer.ts` | `surfaces/replay/scene/route-camera-stabilizer.ts` | 193 | 3 |
| 33 | `replay/scene/route-scene-contract.test.ts` | `surfaces/replay/scene/route-scene-contract.test.ts` | 233 | 0 |
| 34 | `replay/scene/route-scene-contract.ts` | `surfaces/replay/scene/route-scene-contract.ts` | 483 | 2 |

### `surfaces/finder/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `components/finder/candidate-route.tsx` | `surfaces/finder/components/candidate-route.tsx` | 141 | 1 |
| 2 | `components/finder/finder-form.tsx` | `surfaces/finder/components/finder-form.tsx` | 142 | 1 |
| 3 | `components/finder/finder-route-map.tsx` | `surfaces/finder/components/finder-route-map.tsx` | 166 | 1 |
| 4 | `pages/finder-page.tsx` | `surfaces/finder/finder-page.tsx` | 300 | 1 |
| 5 | `domain/planning.test.ts` | `surfaces/finder/planning.test.ts` | 43 | 0 |
| 6 | `domain/planning.ts` | `surfaces/finder/planning.ts` | 49 | 8 |

### `surfaces/admin/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `domain/admin-curation.test.ts` | `surfaces/admin/admin-curation.test.ts` | 57 | 0 |
| 2 | `domain/admin-curation.ts` | `surfaces/admin/admin-curation.ts` | 114 | 5 |
| 3 | `pages/admin-page.tsx` | `surfaces/admin/admin-page.tsx` | 299 | 1 |
| 4 | `components/admin/curation-status.tsx` | `surfaces/admin/components/curation-status.tsx` | 82 | 1 |
| 5 | `components/admin/route-editor.tsx` | `surfaces/admin/components/route-editor.tsx` | 233 | 1 |

### `labs/`

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `pages/cinematic-director-lab-page.tsx` | `labs/cinematic/cinematic-director-lab-page.tsx` | 50 | 1 |
| 2 | `pages/cinematic-route-trailer-lab-page.tsx` | `labs/cinematic/cinematic-route-trailer-lab-page.tsx` | 30 | 1 |
| 3 | `pages/design-system-foundation-page.tsx` | `labs/design-system/design-system-lab-page.tsx` | 260 | 1 |
| 4 | `pages/google-route-navigator-lab-page.tsx` | `labs/google-route-navigator/google-route-navigator-lab-page.tsx` | 30 | 1 |
| 5 | `replay/playable-earth-controller.test.ts` | `labs/playable-earth/playable-earth-controller.test.ts` | 191 | 0 |
| 6 | `replay/playable-earth-controller.ts` | `labs/playable-earth/playable-earth-controller.ts` | 260 | 4 |
| 7 | `pages/playable-earth-lab-page.tsx` | `labs/playable-earth/playable-earth-lab-page.tsx` | 79 | 1 |
| 8 | `components/replay/playable-earth-stage.tsx` | `labs/playable-earth/playable-earth-stage.tsx` | 658 | 1 |
| 9 | `replay/playable-earth-viewer.ts` | `labs/playable-earth/playable-earth-viewer.ts` | 409 | 1 |
| 10 | `domain/route-film.test.ts` | `labs/route-film/route-film.test.ts` | 251 | 0 |
| 11 | `domain/route-film.ts` | `labs/route-film/route-film.ts` | 632 | 1 |
| 12 | `domain/route-genome.test.ts` | `labs/route-intelligence/route-genome.test.ts` | 76 | 0 |
| 13 | `domain/route-genome.ts` | `labs/route-intelligence/route-genome.ts` | 299 | 2 |
| 14 | `pages/route-intelligence-lab-page.tsx` | `labs/route-intelligence/route-intelligence-lab-page.tsx` | 701 | 1 |

### `ui/` — design system and shared primitives

| # | current path | proposed path | L | importers to update |
| --- | --- | --- | --- | --- |
| 1 | `components/ui/button.tsx` | `ui/button.tsx` | 64 | 23 |
| 2 | `components/ui/input.tsx` | `ui/input.tsx` | 21 | 7 |
| 3 | `components/page-title.tsx` | `ui/page-title.tsx` | 17 | 2 |
| 4 | `components/ui/separator.tsx` | `ui/separator.tsx` | 26 | 2 |
| 5 | `components/ui/sheet.tsx` | `ui/sheet.tsx` | 143 | 4 |
| 6 | `components/ui/skeleton.tsx` | `ui/skeleton.tsx` | 13 | 2 |
| 7 | `components/ui/tooltip.tsx` | `ui/tooltip.tsx` | 55 | 2 |
| 8 | `hooks/use-mobile.ts` | `ui/use-mobile.ts` | 19 | 4 |
| 9 | `hooks/use-reduced-motion.ts` | `ui/use-reduced-motion.ts` | 19 | 1 |
| 10 | `lib/utils.ts` | `ui/utils.ts` | 6 | 25 |

### Files whose path does not change

`index.css`, and the eight `data/*.ts` modules (`routes.ts`,
`route-repository.ts`, `use-route-detail.ts`, `route-regions.ts`,
`admin-repository.ts`, `discovery-provider.ts`, `planned-route-store.ts`,
`route-library-return.ts`) plus their tests. `data/` is already correctly named
and correctly scoped; only its **generated data payload** is contentious, and
that is deferred to Section 10.2.

---

## 7. Proposed merges

Merges are proposed only where the same logic exists in more than one place
today. Each is justified by a measured duplication, not by a preference.

### 7.1 One numeric/easing module — replaces 8 copies of `clamp`

`clamp` is defined privately in **8** production files; `interpolate` and
`interpolateHeading` in 3 each; `mix` in 2; `lerp`-style helpers in 5; and a
shortest-path heading interpolation appears **10 times under 5 different names**.
A `111_320` metres-per-degree geodesy constant is re-derived in 5 places.

> **Create `domain/geometry/numeric.ts`** exporting `clamp`, `mix`,
> `interpolate`, `interpolateHeading`, `easeInOutQuint`, `easeOutCubic`, and
> `METRES_PER_DEGREE`. Delete the 8 local `clamp` definitions and the rest.

Why `domain/geometry/` and not `ui/utils.ts`: these are pure numeric helpers over
route geometry, used by controllers, engines and the cinematic director, none of
which may depend on the UI layer.

### 7.2 One renderer-health module — replaces 4 copies of `webglAvailable`

`webglAvailable` is defined 4x (`cesium-atlas-world-engine`,
`cesium-replay-engine`, `cesium-cinematic-renderer`, `playable-earth-viewer`);
`canvasLooksBlank` 2x; the Cesium `Viewer` option literal 4x; the Google 3D tiles
URL builder 3x; `cameraHeightAboveRouteM` verbatim 2x.

> **Merge into `providers/`**: `webgl.ts` (`webglAvailable`),
> `canvas-blankness.ts` (`canvasLooksBlank` + the existing
> `rgbaPixelsLookBlank`), `cesium-viewer-options.ts`, and
> `render-health.ts` (moved from `replay/replay-health.ts`).

This also removes layering violation 2.7: the Atlas surface currently imports
`@/replay/replay-health`. Afterwards both surfaces import
`@/providers/render-health` and neither owns the other's plumbing.

Note `rgbaPixelsLookBlank` exists only to make `canvasLooksBlank` testable, and
the two engines each reimplemented `canvasLooksBlank` around it — so the merge
makes the tested function the one that is actually used.

### 7.3 One MapLibre map — replaces 4 implementations (largest single win)

Four separate MapLibre implementations exist, three of them components:

| File | L | Style URL |
| --- | --- | --- |
| `components/globe/atlas-regional-fallback.tsx` | 440 | `styles/liberty` |
| `components/routes/route-leaf-map.tsx` | 346 | `styles/liberty` |
| `components/finder/finder-route-map.tsx` | 166 | `styles/liberty` |
| `replay/atlas/maplibre-atlas-replay-engine.ts` | 169 | `styles/fiord` **(disagrees)** |

All three components re-implement the identical ADR-0007 degradation protocol —
`errorCount >= 4`, an 8–10 second watchdog, a `ResizeObserver`, and a
`loading | ready | unavailable` state — and two of the three **ignore**
`domain/route-thread-style.ROUTE_THREAD_STYLE`, hardcoding `#315fb4`/`#f6f2e8`
instead.

> **Create `providers/maplibre/`** with `openfreemap-style.ts` (the one style URL
> per purpose), `use-maplibre-map.ts` (mount, degradation protocol, resize), and
> `route-thread-layers.ts` (halo + thread layers driven by
> `ROUTE_THREAD_STYLE`). Estimated **~450 lines removed**.

This is a behaviour-affecting change (it fixes two components to honour the
canonical thread colours), so it is sequenced after the pure moves and requires
the visual check in Section 11, Phase 6.

### 7.4 One replay tempo module — resolves the 180/210 divergence

`REPLAY_DURATION_SECONDS` is declared privately in three controllers as 180, 180
and **210**, along with duplicated speed and camera-range ladders.

> **Create `surfaces/replay/playback/replay-tempo.ts`** holding the single
> duration constant plus `REPLAY_SPEEDS` and `REPLAY_CAMERA_RANGES_M`.

**This one changes behaviour** and must not be folded into a move commit. The
210-second value on the ADR-0009 primary path is either deliberate and
undocumented or a bug. Resolve it as its own ticket with an owner decision, and
record the answer in `CONTEXT.md` §7 or an ADR.

### 7.5 One `Metric` component — replaces 4 reimplementations

`components/metric.tsx` (8 L) has zero importers, yet its exact shape is
reimplemented four times: `candidate-route.tsx:134`,
`google-route-navigator-stage.tsx:784`, `route-detail-page.tsx:279`
(`LeafMetric`), and `curation-status.tsx:56` (`StatusMetric`).

> **Promote one `ui/metric.tsx`** and delete the four local copies in the same
> commit. Deleting the dead file without promoting it would lose the intent.

### 7.6 Smaller consolidations

- `pointAtDistance` is defined in both `domain/route-repairs.ts` and
  `replay/route-path.ts`. Once `route-path.ts` moves to `domain/geometry/`,
  `route-repairs` can import it — a move that is currently blocked because a
  domain module may not import from `replay/`. **This is a concrete example of the
  reorganisation unlocking a merge.**
- `elapsedAtDistance` (2x) and `smoothRouteTarget` (2x) consolidate into
  `domain/geometry/route-path.ts` for the same reason.
- `numberValue` / `stringValue` (2x each, in `domain/routes.ts` and
  `data/admin-repository.ts`) become `domain/route/parse-shared.ts` exports.
- `formatDuration` (2x), `capitalize` (2x) and `routeFeature` (2x) consolidate
  into `domain/geometry/` or `providers/maplibre/route-thread-layers.ts` as
  appropriate.
- **The eight curation field names are enumerated in 4 places**
  (`domain/routes.ts:135`, `domain/admin-curation.ts:47`,
  `data/admin-repository.ts:127` and `:148`). Export one
  `CURATION_FIELDS` tuple from `domain/route/contract.ts`. This is an
  invariant from `CONTEXT.md` §5 that is currently maintained by hand in four
  places.
- `unwrapLongitude` exists twice (`domain/geographic-bounds.ts:48` as a loop with
  **0 production callers**, and `atlas-regional-fallback.tsx:29` as a modulo).
  Keep the modulo version in `domain/geometry/`, delete the dead loop.
- Five separate trace-validity predicates exist and only one uses
  `isValidCoordinate`; four separate "project trace into a viewBox"
  implementations exist and `route-card.tsx`'s is the only one not using
  `projectRouteGeometry`, so **it mishandles the antimeridian**. Fold all onto
  `domain/geometry/route-visualization.ts`. Treat the antimeridian fix as a bug
  ticket with its own test, not as part of a move.


---

## 8. Proposed splits

Only five files are proposed for splitting. Size alone is not a reason; each of
these mixes responsibilities that change for different reasons.

### 8.1 `domain/routes.ts` (664 L, fan-in 66) — split behind a barrel

The single most-depended-upon file in the codebase. Splitting it looks dangerous,
but the import shape makes it cheap:

- **62 of 66 importers import types only.** Only 4 files import a value:
  `data/route-repository.ts` (`parseRouteDetail`), `data/routes.ts`
  (`parseRouteSummary`), and two tests.
- Symbol demand is concentrated: `QuestRoute` 36x, `RouteSummary` 21x,
  `RoutePoint` 16x; everything else is 3x or fewer.

**The seam is ADR-0004**, not "types vs validation". Validation *is* the parse —
errors are thrown inline (`throw new Error("best_in_earth replay must use earth
mode")`), so a separate validator would have to re-walk the same JSON. The real
seam already documented in the architecture is the **lenient summary tier versus
the strict detail tier**:

| Proposed file | Source lines | Contents |
| --- | --- | --- |
| `domain/route/contract.ts` (~133 L) | 6–133 | All types: `RoutePoint`, `RouteProvenance`, `ReplayMetadata`, `RouteCuration`, `RouteSummary`, `QuestRoute`, `GeneratedQuestRoute`, plus `CURATION_FIELDS` |
| `domain/route/parse-shared.ts` (~110 L) | 147–312, 450–457 | `numberValue`, `stringValue`, `requiredSlug`, `parsedRoutePoints`, `validTimeZone`, curation field helpers |
| `domain/route/summary-parse.ts` (~90 L) | 214–252, 459–507, 622–641 | The **lenient** tier: `validatedGuidePreview`, `replayMetadata`, `commonRouteFields`, `parseRouteSummary` |
| `domain/route/detail-parse.ts` (~230 L) | 169–212, 314–448, 509–620, 643–664 | The **strict** tier: `validatedCuration`, `validatedProvenance`, `validatedReplayMetadata`, `validatedDetailFields`, `parseRouteDetail` |
| `domain/route/index.ts` | — | Barrel re-exporting all four |

Because the barrel is `domain/route/index.ts`, the specifier becomes
`@/domain/route` — a single find-and-replace across 66 files, with no change to
any imported symbol name.

Why this is worth doing: the two tiers currently interleave in one file, which is
exactly why the strict/lenient distinction is easy to violate by editing the
wrong helper. `commonRouteFields` uses `stringValue(x, fallback)` while
`validatedDetailFields` uses `requiredStringField(x, field, false)` and throws.
Those policies should not be adjacent.

**Obligation:** `CONTEXT.md` §8 currently names *the file*
`app/src/domain/routes.ts` as "the only sanctioned boundary" between `snake_case`
and `camelCase`. This split requires a one-line edit to name the directory
`app/src/domain/route/` instead. **Do not perform the split without that edit**,
or the domain document becomes false.

### 8.2 `replay/cinematic/route-cinematic-director.ts` (1,286 L) — split 6 ways

The largest file in `src`. It holds five unrelated things, with clean boundaries
already visible in the line ranges:

| Proposed file | Source lines | Contents |
| --- | --- | --- |
| `cinematic/cinematic-contract.ts` | 4–101 | `CinematicCut`, `CinematicShotKind`, `CinematicProfile`, `CinematicMoment`, `CinematicLook`, `CinematicFrame` |
| `cinematic/cinematic-copy.ts` | 103–142 | Authored chapter prose — **`hypothesis`-grade editorial text** per `CONTEXT.md` §4, which should be isolated so it is never mistaken for recorded data |
| `cinematic/cinematic-analysis.ts` | 247–452 | `coverageFraming`, `visualSignalAt`, `cinematicVisualMoments`, `cinematicMoments`, `cinematicProfile` |
| `cinematic/cinematic-shot-plan.ts` | 523–957 | The authored shot tables (cuts at 592/728/805/882) — the largest and least-frequently-changed part |
| `cinematic/cinematic-shot-director.ts` | 958–1047 | `buildShotPlan`, `directShotPlan`, `shotPlan` |
| `cinematic/cinematic-frame.ts` | 1048–1286 | `cinematicCameraRig`, `cinematicDuration`, `cinematicShotTimeline`, `cinematicFrame` |

Its private easing/math helpers (lines 150–246) are deleted in favour of
`domain/geometry/numeric.ts` (Section 7.1).

Splitting the *data* (shot tables, prose) from the *engine* (rig, frame sampler)
matters because they change for entirely different reasons — editorial taste
versus camera behaviour — and the 434-line shot table currently forces a reader
to scroll past it to reach the logic.

### 8.3 Extract grounding from the Playable Earth lab controller

`replay/playable-earth-controller.ts` (260 L) holds two responsibilities: the lab
control state (steering corridor, free look) **and** the general **grounding**
state machine (`advancePlayableEarthGrounding`, outlier rejection, EMA smoothing,
bounded slew) that reconciles recorded elevation against provider mesh height.

`cesium-replay-engine.ts` imports the grounding functions, so **production
depends on a lab module** — a soft breach of ADR-0008.

> **Split**: grounding moves to `surfaces/replay/scene/route-grounding.ts`; the
> lab control state stays in `labs/playable-earth/`.

Grounding is production logic described in `CONTEXT.md` §7 as a named domain
concept. This split is a precondition for moving the lab into `labs/` without
creating a production-to-lab import. Rename the exported symbols to drop the
`PlayableEarth` prefix as part of the same commit.

### 8.4 The four replay stages — extract ~40% shared chrome

| File | L |
| --- | --- |
| `components/replay/google-route-navigator-stage.tsx` | 829 |
| `components/replay/playable-earth-stage.tsx` | 658 |
| `components/replay/earth-replay-stage.tsx` | 546 |
| `components/replay/cinematic-director-stage.tsx` | 538 |

The ADR-0007 named-degradation status panel is implemented **4 times**
(`earth:310`, `playable:262`, `google:391`, `cinematic:463`). The playback dock is
2 near-literal copies (`earth:337–546`, `playable:281–620`) with the same
`isMobile` fork, the same progress readout, and the same zoom guards against
`CAMERA_RANGES_M[0]` / `.at(-1)`. The `mobileControlsExpanded` state and two
context effects are duplicated verbatim.

> **Extract** `surfaces/replay/components/replay-status-overlay.tsx`,
> `replay-playback-dock.tsx`, and a `use-replay-chrome-state.ts` hook. Then split
> `google-route-navigator-stage.tsx` into orchestration / HUD / settings.

Two related fixes belong in the same work: `cameraPoseHasSettled` moves to
`scene/route-camera-stabilizer.ts`, and `FIELD_TEST_ROUTES` (hardcoded slugs
`14736711660`, `14023448720`, also hardcoded in the trailer stage) leaves the
production stage. The stage's `variant: "lab" | "replay"` flag is an ADR-0008
erosion risk and should be reviewed once labs are structurally separate.

### 8.5 `pages/route-intelligence-lab-page.tsx` (701 L) — split 5 ways

Five responsibilities in one file: fixture ids and scene tables (L32–56), a raw
`fetch` (L58–68), pure helpers (L78–103), and three large presentational blocks —
`KilometerJourneyStrip` (144 L), `EarthObservationScenes` (91 L), `RoutePortrait`
(220 L).

> Split the three components into siblings under
> `labs/route-intelligence/`; lift the `fetch` into
> `data/route-intelligence-repository.ts` (a layering fix — a page should not
> `fetch` directly, and ADR-0013 makes this static data); lift the pure helpers
> into the co-located `route-genome.ts`. Leaves ~130 L.

**Constraint:** every `data-testid` consumed by
`app/e2e/route-intelligence-lab.spec.ts` must survive the split unchanged.
Incidental find: the ternary `activityId === "14736711660" ? "San Francisco" :
"Crete"` is repeated 5 times.

### 8.6 Split the renderer port from its factory — removes both import cycles

`replay/replay-engine.ts` (39 L) declares the `ReplayEngine` port **and** eagerly
imports `CesiumReplayEngine` and `MapLibreAtlasReplayEngine` for
`createReplayEngine`. That is the sole cause of both detected import cycles, and
it means a pure type file pulls Cesium and MapLibre into the same module graph.

> **Split** into `surfaces/replay/renderer-port.ts` (types only, zero imports)
> and `surfaces/replay/renderers/create-replay-engine.ts` (the factory and the
> two imports).

`ReplayStatus.state` is exactly the four ADR-0007 degradation states, so that type
is a domain contract and deserves to be import-free.

### 8.7 Split `navigation.ts`

`navigation.ts` (fan-in 19) is imported by `config/`, `components/`, and `pages/`
— it is foundational — yet it imports `lucide-react` icons, which makes a
React-free module depend on a UI library.

> **Split** into `app/route-paths.ts` (pure path builders, 19 consumers) and
> `app/app-sections.tsx` (the icon-bearing `APP_SECTIONS` array, 3 consumers).

The move table lists the `route-paths.ts` rename; the `app-sections.tsx`
extraction is the second half of the same commit.

### 8.8 Explicitly *not* split

- `atlas/cesium-atlas-world-engine.ts` (730 L) and
  `replay/cesium/cesium-replay-engine.ts` (689 L) are large but each is **one
  coherent imperative renderer lifecycle**. Splitting a mount/update/destroy
  lifecycle across files makes it harder to reason about, not easier. They shrink
  naturally once Sections 7.1 and 7.2 remove their duplicated helpers.
- `components/ui/*` are vendored shadcn primitives. Leave their internals alone
  so future `shadcn` CLI updates stay mechanical.


---

## 9. Proposed deletions

| Path | L | Evidence |
| --- | --- | --- |
| `components/ui/sidebar.tsx` | 726 | **0 importers.** Verbatim vendored shadcn (`"use client"`, no semicolons, 25 exports including `SidebarProvider`/`useSidebar`). Arrived in `117b5dac` (React scaffold) and was superseded by `b14c4f98`, which added the hand-written `AtlasSpine`. |
| `components/metric.tsx` | 8 | **0 importers**, while its shape is reimplemented 4x. Delete *and* promote `ui/metric.tsx` in the same commit (Section 7.5). |
| `RouteBriefing` export in `components/routes/route-briefing.tsx` | ~120 of 212 | Dead export. Only `ElevationProfile` is imported (by `route-detail-page.tsx:11`). Delete `RouteBriefing` and rename the file `route-elevation-profile.tsx`. |
| `hasRouteGeometry` in `domain/routes.ts` | 3 | **0 references anywhere**, including tests, e2e and scripts. |
| `unwrapLongitude` in `domain/geographic-bounds.ts` | ~7 | 0 production callers; the modulo reimplementation in `atlas-regional-fallback.tsx` is the live one. |
| `TILE_FAILURE_WINDOW_MS`, `REPLAY_SPEEDS` re-export, `routeDistanceM` pass-through in `replay-controller.ts:109` | ~5 | Unused outside their own file, or pass-throughs that let stages import geometry from a controller. |
| `RegionRouteCarouselProps`, `RouteThumbnailState` | ~4 | Exported, never imported. |

**Total: ~875 lines of dead code.**

### One deletion held back for a decision

`replay/cinematic/cesium-cinematic-renderer.ts` (319 L) is **fully dead as an
implementation** — both consumers import only its `CinematicRendererStatus` type
while instantiating `NativeCinematicRenderer`. It contains the only colour-grading
shader, depth of field, bloom and fog in the repository.

ADR-0009 already records this as an open consequence: *"Either port the grading to
the native renderer or delete it."* **This plan does not delete it.** That is a
product decision about whether graded cinematic output is still wanted, not a
reorganisation decision. It moves to `surfaces/replay/cinematic/` unchanged, and
the type it is imported for should be extracted into `cinematic-contract.ts` so
the dead module is no longer load-bearing for a type.

---

## 10. Calling-code and configuration impact

This is the section that keeps the refactor from breaking things.

### 10.1 What `tsc` catches for free (349 of 349 import rewrites)

All 349 specifier rewrites are verified by `npm run typecheck`, because:

- every internal import uses `@/`, resolved by `tsconfig.json` `paths`;
- all 13 dynamic imports use static string literals, including the 12
  `lazy(() => import("@/pages/..."))` calls in `router.tsx`;
- there is no `import.meta.glob`, no template-literal import, and no `require()`.

An unresolved module is a type error. **A broken import path cannot survive a
typecheck.** The per-file rewrite list is enumerable and was computed as part of
this plan.

### 10.2 What `tsc` cannot catch — the actual hazards

These are string- or filename-based couplings. Each must be handled by hand, in
the same commit as the move it depends on.

| # | Coupling | Location | Hazard |
| --- | --- | --- | --- |
| H1 | **Lazy chunk filenames** | `app/scripts/check-bundle-budget.mjs` asserts exactly one asset matching `/^replay-page-.*\.js$/` and `/^route-detail-page-.*\.js$/` | `vite.config.ts` does not override `chunkFileNames`, so `[name]` is the module **basename**. The checked-in build confirms it (`dist/assets/replay-page-DeDVXNkW.js`). **Moving these two files into a subfolder is safe; renaming them to `index.tsx`/`page.tsx` breaks the release gate.** Also: any new lazily-imported sibling named `replay-page-*.tsx` would produce a second matching chunk and fail the `!== 1` assertion, so Section 8 splits must not use those prefixes. |
| H2 | **No `pages/` barrel, ever** | same script | Every page is reached via `lazy(import())`. A barrel file would statically pull Cesium into the entry chunk and fail both the 500 KiB budget and the `CesiumWidget` marker assertion. The proposed structure has no barrels except `domain/route/index.ts`, which is React-free and Cesium-free. |
| H3 | **Python test reads TSX source text** | `test_react_app.py:218` reads `src/pages/atlas-page.tsx`; `:260` reads `src/pages/replay-page.tsx` and asserts literal source including `const pickerRoutes = singleRouteMicrosite` | Moving these two pages **requires editing `test_react_app.py` in the same commit**. Also `:51` reads `src/domain/route-lifecycle.ts` and `:52` `src/domain/routes.ts` — both move under this plan. |
| H4 | **Vite virtual-manifest plugin** | `vite.config.ts:24` builds an absolute path to `src/data/generated/routes.manifest.json`; `:36–37` matches the specifier `@/data/generated/routes.manifest.json` **or** any `source.endsWith("/data/generated/routes.manifest.json")` | **Silent failure mode.** If the manifest path changes and only line 24 is updated, `resolveId` stops matching, the virtual one-route module is never produced, and the microsite bundle silently regains every route's data — losing the physical guarantee of ADR-0011 while the runtime filter in `data/routes.ts` keeps tests green. **This plan therefore does not move `data/generated/`.** |
| H5 | **Generator writes into `src`** | `build.py:36–42` (`REACT_DATA`, `REACT_GENERATED_DATA`, `REACT_GENERATED_FILES`) | The Python generator owns these paths (ADR-0003). Any move must be one commit spanning `build.py`, `vite.config.ts`, `pipeline_verification.py:235,252–254,319,322`, `test_react_app.py:11,84,115,136`, and `app/e2e/live-pipeline.spec.ts`. High blast radius, zero structural benefit. **Deferred — see 10.4.** |
| H6 | **shadcn CLI aliases** | `components.json` maps `components -> @/components`, `ui -> @/components/ui`, `utils -> @/lib/utils`, `lib -> @/lib`, `hooks -> @/hooks` | Not a build input; only the `shadcn` CLI reads it. If not updated, a future `npx shadcn add` writes files into the old, now-nonexistent tree. Must be updated with the `ui/` move: `ui -> @/ui`, `utils -> @/ui/utils`, `hooks -> @/ui`. |
| H7 | **Entry HTML** | `app/index.html` references `src/main.tsx` | Moving `main.tsx` to `app/main.tsx` requires editing `index.html`. One line, but a build-breaking miss. |
| H8 | **e2e reads generated data from disk** | `app/e2e/live-pipeline.spec.ts` reads `src/data/generated/routes.manifest.json` and `src/data/quests.generated.json` | Unaffected as long as 10.2/H4 holds and `data/generated/` stays put. |
| H9 | **`data-testid` and DOM contracts** | 24 e2e specs; engines write `data-camera-*`, `data-grounding-*`, `data-geometry-points`; `navigation.spec.ts:191` queries `data-slot="sidebar-container"` on `AtlasSpine` | File moves cannot break these, but the **splits** in Section 8 can. Every extracted component must carry its `data-testid` and `data-slot` attributes across unchanged. Note the vendored `data-slot="sidebar-container"` marker survives on the hand-written `AtlasSpine` and is queried by e2e — do not "clean it up" while deleting `ui/sidebar.tsx`. |

### 10.3 Configuration files to update

| File | Change |
| --- | --- |
| `app/index.html` | `src/main.tsx` -> `src/app/main.tsx` (H7) |
| `app/components.json` | four alias values (H6) |
| `app/vite.config.ts` | no change required, **provided `data/generated/` does not move** (H4) |
| `app/tsconfig.json` | no change. `@/*` -> `./src/*` and `include: ["src"]` are both structure-independent |
| `app/vitest.config.ts` | no change. `src/**/*.test.ts(x)` is structure-independent |
| `app/playwright*.config.ts` | no change. Specs address the app over HTTP |
| `test_react_app.py` | four read paths (H3) |
| `CONTEXT.md` §10 | the "Where things live" table lists `app/src/domain/`, `app/src/data/`, `app/src/replay/`, `app/src/atlas/`, `app/src/components/globe/`. **Must be updated in the final commit** or the canonical domain document becomes wrong |
| `CONTEXT.md` §8 | one line, only if Section 8.1 is executed |
| `docs/adr/` | no ADR is invalidated. Consider a new ADR recording the `surfaces/`+`labs/` structure once it lands |

### 10.4 Explicitly out of scope for this plan

**`app/src/data/generated/` and `app/src/data/quests.generated.json` do not
move.** Rationale: the only structural complaint is that committed data sits in a
code folder, which is cosmetic; the cost is a six-file cross-language change with
a documented **silent** failure mode (H4) that would weaken an ADR-0011 guarantee
without any test noticing.

Two separate, smaller tickets are worth filing instead:

1. `data/quests.generated.json` is **4.1 MB with zero application importers** —
   only existence-asserted by `pipeline_verification.py` and one e2e spec. It is
   bundled into no chunk but sits in the repository and in `src`. Evaluate
   deleting it or relocating it outside `src` as its own change, with `build.py`
   and the two Python verifiers updated together.
2. Add a guard to `check-bundle-budget.mjs` or the pipeline verifier that fails
   when the virtual-manifest `resolveId` hook does not fire during a microsite
   build, closing failure mode H4 permanently.


---

## 11. Execution plan

Sequenced by **blast radius, ascending**, so confidence is built on the cheap
phases before the expensive ones. Phases 1–8 are pure moves and contain **no
behaviour change whatsoever**.

### Ordering by measured cost

| Order | Phase | Files moved | Import specifiers rewritten | Files touched |
| --- | --- | --- | --- | --- |
| 1 | Labs | 14 | 15 | 9 |
| 2 | providers/ | 6 | 10 | 8 |
| 3 | Atlas surface | 22 | 27 | 16 |
| 4 | Routes + Finder + Admin | 21 | 37 | 24 |
| 5 | app/ | 9 | 28 | 23 |
| 6 | Replay surface | 34 | 60 | 29 |
| 7 | ui/ | 10 | 72 | 39 |
| 8 | domain/ | 14 | 100 | 71 |

`domain/` and `ui/` are deliberately **last** among the moves despite being
conceptually simplest, because `domain/routes.ts` (fan-in 66), `lib/utils.ts`
(fan-in 25) and `ui/button.tsx` (fan-in 23) give them the largest rewrite sets.
By the time they are reached, the mechanical process has been exercised seven
times.

### Phase 0 — Deletions (no moves)

Delete `components/ui/sidebar.tsx` and `components/metric.tsx`; promote
`ui/metric.tsx` and remove the four local copies; delete the dead exports in
Section 9. Both files have zero importers, so this cannot break an import.

*Verify:* `npm run typecheck && npm run test:unit`, plus
`npx playwright test e2e/navigation.spec.ts` because of the
`data-slot="sidebar-container"` assertion (H9).

### Phases 1–8 — Pure moves, one phase per commit

For each phase, mechanically:

1. `git mv` each file (and its co-located test) to the new path.
2. Rewrite the affected `@/` specifiers — the exact list is derivable, and every
   miss is a type error.
3. Run `npm run typecheck`. **This is the gate.** It is complete for import
   correctness (10.1).
4. Run `npm run test:unit`.
5. Handle that phase's hazards from 10.2 in the same commit — H7 with the `app/`
   phase, H3 with the Atlas and Replay phases, H6 with the `ui/` phase.

Use `git mv` rather than delete-and-add so history follows the file.

*Verify per phase:* `npm run verify:ticket` (typecheck, build, all unit tests,
core navigation smoke). Per `docs/agents/testing.md` this is the **Ticket** tier
and is the correct gate for a structural change with no behaviour change.

Renames folded into their phase: `navigation.ts` -> `app/route-paths.ts`;
`design-system-foundation-page.tsx` -> `labs/design-system/design-system-lab-page.tsx`
(it routes at `lab/design-system` and calls itself "goDiesel design lab" but lacks
the `-lab-` marker; no bundle pattern and no Python test reference it, so the
rename is safe); `maplibre-atlas-replay-engine.ts` -> `maplibre-replay-engine.ts`
(removes the `replay/atlas` vs `atlas/` collision);
`google-route-navigator-controller.ts` -> `playback/route-navigator-controller.ts`
(it is provider-neutral).

### Phase 9 — Structural splits that remove cycles and violations

Section 8.6 (port/factory), 8.3 (grounding extraction), 8.7 (`navigation.ts`), and
the `route-regions.ts` split that resolves the `domain -> data` violation. These
are refactors with no intended behaviour change but they do move code between
modules.

*Verify:* `npm run verify:ticket`, plus `npx playwright test e2e/earth-replay.spec.ts
e2e/atlas.spec.ts e2e/atlas-cesium.spec.ts`.

### Phase 10 — `domain/routes.ts` split (Section 8.1)

Its own commit, paired with the `CONTEXT.md` §8 edit. Split `routes.test.ts`
(439 L) along the same seam.

*Verify:* `npm run verify:ticket` plus the full unit suite; `routes.test.ts`
includes a filesystem sweep over `public/data/routes/*.json`, which is a strong
regression check on both parsers.

### Owner decisions (recorded 2026-08-08)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Replay duration: 180 s or 210 s (§7.4) | **210 seconds.** `replay-tempo.ts` uses 210 for every replay path. This changes the Cesium/Atlas replay and the Playable Earth lab from 180 to 210. Record the value in `CONTEXT.md` §7. |
| 2 | `cesium-cinematic-renderer.ts` (§9) | **Keep the file. Port the colour grade to the native renderer.** The grade, depth of field, bloom and fog become reachable on the ADR-0009 primary path. Add a follow-up note to ADR-0009, which currently records the choice as open. |
| 3 | `domain/routes.ts` split needs a `CONTEXT.md` §8 edit (§8.1) | **Accepted.** |

### Phase 11 — Consolidations that change behaviour

Sections 7.1–7.5, and the cinematic director split (8.2), the stage chrome
extraction (8.4), and the route-intelligence page split (8.5).

These are **not** pure moves:

- 7.3 changes two map components to honour `ROUTE_THREAD_STYLE` instead of
  hardcoded hex.
- 7.4 resolves the 180-vs-210 second duration divergence. The owner chose
  **210 seconds** for every path, so the Cesium/Atlas replay and the Playable
  Earth lab change from 180 to 210. This is a deliberate, visible timing change
  and needs its own evidence.
- The antimeridian fix in 7.6 changes `route-card` rendering.

*Verify:* this is where the testing policy escalates. Per
`docs/agents/testing.md`, changes to camera, terrain, imagery or provider
behaviour require the **live-provider** tier:
`GODIESEL_ATLAS_PREVIEW_URL=<url> npm run test:e2e:atlas-live` and
`npm run test:e2e:earth`, plus the visual checks. Do each consolidation as its own
ticket with its own evidence; do not batch them.

### Phase 12 — Documentation

Update `CONTEXT.md` §10 "Where things live" (mandatory — it currently names
`app/src/replay/`, `app/src/atlas/` and `app/src/components/globe/`). Consider an
ADR recording the `surfaces/` + `labs/` structure and the rule that production
must not import from `labs/`.

*Verify:* documentation only; per the Gate Validity rule in
`docs/agents/testing.md`, no gate is rerun.

### A guard worth adding while the structure is fresh

Add a unit test, or an ESLint boundary rule, asserting that **no file outside
`labs/` imports from `labs/`**, and that **no file in `domain/` imports from
`data/`, `surfaces/`, `labs/`, `ui/` or `providers/`**. Both invariants are true
after Phase 9 and both were violated before it. A ~20-line test over the import
graph makes the new structure self-enforcing rather than aspirational — this plan
found the existing violations only by computing the graph, which nothing in CI
does today.

---

## 12. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A broken import path reaches a commit | Low | Impossible past `npm run typecheck`; complete coverage established in 10.1 |
| Bundle budget fails on chunk names | **High if unmanaged** | H1: `replay-page.tsx` and `route-detail-page.tsx` keep their basenames; no new `replay-page-*` / `route-detail-page-*` siblings; no `pages/` barrel |
| Microsite silently ships all routes | **High, silent** | H4: `data/generated/` does not move under this plan; add the resolve-hook guard in 10.4 |
| `test_react_app.py` fails on moved paths | Medium | H3: edit the four read paths in the same commit as the move |
| Dev server fails to boot | Medium | H7: `index.html` updated with the `app/` phase |
| A split drops a `data-testid` and an e2e spec fails | Medium | H9: diff attributes explicitly; splits are sequenced last and individually verified |
| Behaviour drift hidden inside a "move" commit | Medium | Phases 1–8 are moves only. Consolidations are Phase 11, each its own ticket |
| Merge conflicts against in-flight work | Medium | Phases are per-surface and independent; land them in quick succession, and do Phase 0 first since deletions conflict least |
| Reviewer cannot see intent in a 122-file diff | Medium | One phase per commit, `git mv` to preserve history, and `git log --follow` remains usable |

**Rollback.** Every phase is one commit containing only moves plus mechanical
specifier rewrites, so `git revert <sha>` is a complete rollback with no data
migration and no build-artifact implications. Phases 0 and 9–11 are the only ones
that change code content, and each is independently revertible.

---

## 13. What this plan deliberately does not do

- **Does not move `data/generated/`** (10.4) — cosmetic gain, silent ADR-0011
  failure mode.
- **Does not delete `cesium-cinematic-renderer.ts`** (Section 9). The owner chose
  to keep the file and port the colour grade to the native renderer.
- **Does not touch `index.css`** or attempt the three-way design-token drift
  (field-guide tokens vs stock shadcn vs raw hex). That is a design-system ticket;
  a file move would only relocate it.
- **Does not restructure the vendored `components/ui/*` internals**, so future
  `shadcn` updates stay mechanical.
- **Does not add barrels**, except `domain/route/index.ts` (React-free,
  Cesium-free). Barrels defeat the code-splitting the bundle budget enforces (H2).
- **Does not rename `QuestRoute`, `quests.json`, or the `#quest/` hash.**
  `CONTEXT.md` §8 records these as a deliberate legacy data and type contract
  whose renaming is its own ticket.
- **Does not change any canonical URL, route table path, or the route data
  model** — forbidden by `CONTEXT.md` invariant 9.

---

## 14. Appendix: measurements

### Before and after

| Metric | Today | Proposed |
| --- | --- | --- |
| Files in `app/src` | 147 | 145 (2 deleted) |
| Lines | 25,375 | ~23,600 after Section 9 + 7.3 |
| Top-level folders | 10 | 7 |
| Folders holding exactly one production module | 6 (`replay/atlas`, `replay/camera`, `replay/scene`, `components/search`, `config`, `lib`) | 0 |
| Max depth below `src` | 3 | 4 (`surfaces/<s>/<group>/<file>`) |
| Top-level folders touched to change one surface | up to 5 | 1 |
| Import cycles | 2 | 0 (Section 8.6) |
| Layering violations | 2 | 0 (Sections 7.2, 9) |
| Duplicated function names | 16 | ~2 |
| Files with zero importers | 2 | 0 |

### Largest files after the plan

| File | Today | After |
| --- | --- | --- |
| `route-cinematic-director.ts` | 1,286 | ~435 (largest of 6) |
| `cesium-atlas-world-engine.ts` | 730 | ~690 (helpers extracted) |
| `ui/sidebar.tsx` | 726 | deleted |
| `route-intelligence-lab-page.tsx` | 701 | ~130 + 3 siblings |
| `cesium-replay-engine.ts` | 689 | ~640 (helpers extracted) |
| `domain/routes.ts` | 664 | ~230 (largest of 4) |
| `google-route-navigator-stage.tsx` | 829 | ~300 + extracted chrome |

### Method notes

Import graph resolved by parsing every `import`/`export ... from`, dynamic
`import()`, and bare `import "..."` in all 143 `.ts`/`.tsx` files, mapping `@/*`
to `src/*` and resolving `.ts`, `.tsx`, `.json` and `index.*` candidates. Fan-in
counts in Section 6 include test files, since a test import must be rewritten
exactly like a production one.
