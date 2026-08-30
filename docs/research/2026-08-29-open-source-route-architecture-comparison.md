# Open-source route architecture comparison

Date: 2026-08-29.

This comparison asks one narrow question: which architecture patterns from mature open-source route, activity, and map projects would make goDiesel smaller without materially changing its behaviour?

It does not treat popularity as architectural evidence.

It uses only the projects' official repositories, architecture documents, and source trees, pinned to the reviewed revisions.

The projects are deliberately heterogeneous. Their source trees support narrow
analogies about responsibility boundaries and deletion discipline; they do not
validate goDiesel's manifest/detail data contract, deployment model, or product
architecture. Those choices must stand on goDiesel's own requirements and
verification evidence.

## Executive conclusion

goDiesel is already aligned with the most transferable pattern in the comparison: route truth is prepared outside presentation, parsed into a domain model, and handed to renderers through narrow boundaries.

That alignment is recorded in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md), [ADR-0004](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0004-two-tier-route-data-with-lenient-summaries-and-strict-details.md), and [ADR-0014](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0014-app-src-is-organised-by-surface.md).

The open-source evidence does not justify adding a general database, global state framework, worker architecture, provider plugin system, or cross-platform core to this single-user static application.

The largest simplifications come from finishing goDiesel's existing decisions rather than importing another project's architecture.

The highest-confidence deletion is the superseded static application still embedded in `build.py`, which [ADR-0001 already identifies as dead weight retained past its fallback period](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0001-single-page-react-application-replaces-generated-static-app.md).

The next deletion candidate is the 4.3 MB `quests.generated.json` aggregate, which [ADR-0004 records as committed but not imported by the application](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0004-two-tier-route-data-with-lenient-summaries-and-strict-details.md).

That file is still part of publication and verification, so it should be removed by simplifying that contract around the manifest and per-route details, not by deleting the file first.

The third deletion candidate is legacy Replay-specific Cesium and cinematic grading code after the missing native-Google route scorecard is completed, because [ADR-0009 makes native Google Maps 3D primary and identifies the legacy cinematic vocabulary as effectively dead on the shipping path](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0009-native-google-maps-3d-is-the-primary-replay-renderer.md).

Cesium should remain in Atlas because [ADR-0006 assigns it a separate production responsibility there](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0006-cesium-is-the-production-atlas-world.md).

## Current goDiesel architecture

goDiesel is one bounded context with one route model and five product surfaces, so service boundaries or independently deployable domains would contradict its documented product shape rather than simplify it.

That scope is explicit in the canonical [goDiesel context](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/CONTEXT.md).

The Python pipeline is the sole writer of generated route data, while the React application reads a lenient summary manifest eagerly and strict route details lazily.

Those responsibilities are defined in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md) and [ADR-0004](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0004-two-tier-route-data-with-lenient-summaries-and-strict-details.md).

The frontend separates application composition, pure domain code, data access, shared providers, product surfaces, labs, and shared UI, and a structural test prevents domain-to-IO imports and surface-to-surface imports.

The folder contract and its enforcement are visible in [ADR-0014](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0014-app-src-is-organised-by-surface.md) and [`structure.test.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/structure.test.ts).

Replay already has a small engine port with only `mount`, `setPose`, and `destroy`, while implementation selection remains in one factory.

That boundary is visible in [`renderer-port.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/surfaces/replay/renderer-port.ts).

These are sound boundaries worth preserving while deleting implementations and transitional artifacts behind them.

## 1. gpx.studio

### What its architecture demonstrates

gpx.studio keeps its GPX model, parser, serializer, statistics, and simplification operations in a local `gpx` package that is separate from the Svelte website package.

The package boundary and public exports are visible in its pinned [`gpx/package.json`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/gpx/package.json) and [`gpx/src/index.ts`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/gpx/src/index.ts).

The domain package models the GPX hierarchy directly and owns transformations such as cloning, reversing, statistics, and GeoJSON conversion rather than putting those operations in view components.

That ownership is visible in [`gpx/src/gpx.ts`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/gpx/src/gpx.ts).

The website adds persistence and reactive state separately through Dexie-backed file state, and the map layer collection observes that state rather than parsing GPX itself.

Those responsibilities are visible in [`file-state.ts`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/website/src/lib/logic/file-state.ts) and [`gpx-layers.ts`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/website/src/lib/components/map/gpx-layer/gpx-layers.ts).

### Applicability to goDiesel

**Already aligned:** goDiesel's `domain/route` and `domain/geometry` folders already give parsing and route derivation a UI-free home, and the structural test makes that separation stronger than a naming convention alone.

The relevant local evidence is [`app/src/domain/route`](https://github.com/the-prairie/goDiesel/tree/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/domain/route) and [`structure.test.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/structure.test.ts).

**Adopt:** keep route parsing, repair, simplification, and presentation derivation out of React components, and consolidate duplicate route calculations into the existing pure domain folders.

This adopts the responsibility boundary demonstrated by the pinned [gpx.studio domain package](https://github.com/gpxstudio/gpx.studio/tree/6a0d4343718e01637a8e301251977fb218cf88f8/gpx/src) without copying its packaging mechanics.

**Reject:** do not introduce a second workspace package merely to imitate gpx.studio, because goDiesel has one consumer and already enforces the same boundary inside one TypeScript project.

**Reject:** do not generalize the route catalogue into Dexie-backed live object state, because gpx.studio needs mutable multi-file editing and undo while goDiesel's generated catalogue is intentionally read-only at runtime.

The gpx.studio persistence requirement is demonstrated by [`file-state.ts`](https://github.com/gpxstudio/gpx.studio/blob/6a0d4343718e01637a8e301251977fb218cf88f8/website/src/lib/logic/file-state.ts), while goDiesel's read contract is explicit in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md).

## 2. OpenTracks

### What its architecture demonstrates

OpenTracks stores recorded tracks in its private application data and treats GPX, KML, and KMZ as interchange formats rather than as its live internal store.

Its official README documents the SQLite store and export-based backup model in the [Backup section](https://codeberg.org/OpenTracksApp/OpenTracks/src/commit/e28a84fc88c60c2a2a51cf920c8b30baeca730a6/README.md#backup).

OpenTracks deliberately keeps richer map presentation outside the recorder through a dashboard API, with OSMDashboard as the reference map implementation.

That split is documented in the [Dashboard API section](https://codeberg.org/OpenTracksApp/OpenTracks/src/commit/e28a84fc88c60c2a2a51cf920c8b30baeca730a6/README.md#dashboard-api-incl-map).

The Data API exposes only user-selected tracks through temporarily granted read-only URIs, and its documentation explicitly says that no write access is possible.

The access contract is documented in [`README_API.md`](https://codeberg.org/OpenTracksApp/OpenTracks/src/commit/e28a84fc88c60c2a2a51cf920c8b30baeca730a6/README_API.md).

The internal `TrackDataHub` observes recorded data and distributes processed, downsampled track points to listeners, which separates storage observation from individual charts and fragments.

That responsibility is visible in [`TrackDataHub.java`](https://codeberg.org/OpenTracksApp/OpenTracks/src/commit/e28a84fc88c60c2a2a51cf920c8b30baeca730a6/src/main/java/de/dennisguse/opentracks/data/TrackDataHub.java).

### Applicability to goDiesel

**Already aligned:** the browser is a reader, source data stays private, and the loopback owner writer regenerates published artifacts instead of mutating browser data directly.

That local contract is defined by [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md) and [ADR-0010](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0010-owner-curation-through-a-loopback-only-writer.md).

**Adopt:** retain one small repository or observer per route-data concern, rather than letting each surface fetch, cache, parse, and retry route details independently.

OpenTracks' `TrackDataHub` supplies evidence for the ownership principle, but its Android observer implementation is not a dependency recommendation.

**Reject:** do not copy Android content providers, services, intents, or listener hubs into the web application, because they solve live recording and inter-application permission boundaries that goDiesel does not have.

The Android-specific problem is explicit in the [OpenTracks Data API implementation description](https://codeberg.org/OpenTracksApp/OpenTracks/src/commit/e28a84fc88c60c2a2a51cf920c8b30baeca730a6/README_API.md#implementation).

## 3. Organic Maps

### What its architecture demonstrates

Organic Maps separates platform user interfaces, shared C++ map logic, static data, build tools, and an offline map generator in its repository structure.

The official [`docs/STRUCTURE.md`](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/docs/STRUCTURE.md) names those responsibilities directly.

Its Python `maps_generator` is an explicit CLI that drives a C++ generator to produce `.mwm` artifacts containing data for rendering, search, routing, and other runtime uses.

That boundary is documented in the pinned [`maps_generator` README](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md).

Organic Maps requires the generator and consuming application to come from compatible releases, which makes artifact compatibility an explicit contract rather than an assumption.

The same [`maps_generator` README](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#maps_generator) states that the application does not support maps built by a newer generator.

The generator can restart from a named stage and regenerate selected map regions when prior output exists.

That capability is documented under [Rebuild stages](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#rebuild-stages).

### Applicability to goDiesel

**Already aligned:** provider enrichment and private-source processing stay outside the runtime, and the client consumes generated artifacts.

The local decisions are recorded in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md) and [ADR-0013](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0013-earth-engine-enrichment-stays-out-of-the-runtime.md).

**Adopt:** give `build.py` an explicit entry point and named, testable generation stages so importing helpers does not execute the complete pipeline.

This directly addresses the module-level execution cost documented in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md) and follows the explicit staged driver demonstrated by [Organic Maps](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#basic-usage).

**Adopt:** make artifact compatibility visible through the existing route contract or manifest version, then reject incompatible details at the parser boundary.

This is a smaller application of Organic Maps' explicit [generator/runtime compatibility rule](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#maps_generator), not a proposal for its binary map format.

**Reject:** do not copy Organic Maps' cross-platform C++ core, map-region packaging, or incremental build framework, because those mechanisms exist to produce and distribute a world-scale offline map product.

The scale and responsibilities are documented in [`docs/STRUCTURE.md`](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/docs/STRUCTURE.md) and [What are maps?](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#what-are-maps).

## 4. MapLibre GL JS

### What its architecture demonstrates

MapLibre GL JS separates vector-tile parsing and layout on Web Workers from WebGL rendering on the main thread.

Its official [`ARCHITECTURE.md`](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md#main-thread--worker-split) documents the split.

MapLibre makes each bucket type the single point of knowledge for turning a vector-tile layer family into WebGL buffers, while rendering delegates by style layer.

That ownership is described in [Parsing and layout](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md#parsing-and-layout) and [Rendering with WebGL](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md#rendering-with-webgl).

The repository keeps rendering, source loading, style evaluation, geometry, tiles, WebGL plumbing, and UI in distinct source folders because it is a reusable renderer with many independent consumers.

That source organization is visible in the pinned [`src` tree](https://github.com/maplibre/maplibre-gl-js/tree/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/src).

### Applicability to goDiesel

**Already aligned:** goDiesel has one Replay engine factory and a minimal engine port, so provider-specific lifecycle code can change without entering route playback or presentation code.

The local evidence is [`renderer-port.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/surfaces/replay/renderer-port.ts).

**Adopt:** keep exactly one module responsible for translating a route and pose into each provider's calls, and keep readiness and degradation states provider-neutral at the surface boundary.

This applies MapLibre's single-point-of-knowledge principle from its [bucket architecture](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md#parsing-and-layout) at goDiesel's much smaller scale.

**Adopt:** delete a renderer implementation when its product role ends instead of widening the shared port to preserve implementation-specific features.

This follows goDiesel's own renderer decisions in [ADR-0006](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0006-cesium-is-the-production-atlas-world.md) and [ADR-0009](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0009-native-google-maps-3d-is-the-primary-replay-renderer.md).

**Reject:** do not reproduce MapLibre's worker pipeline, style subsystem, or public plugin surface inside goDiesel, because MapLibre itself already owns those renderer responsibilities.

The breadth of those responsibilities is visible in its official [architecture document](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md) and [source tree](https://github.com/maplibre/maplibre-gl-js/tree/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/src).

## 5. wanderer

### What its architecture demonstrates

wanderer is a self-hosted trail catalogue that supports uploads, route planning, sharing, advanced search, and multiple users' trails.

Those product responsibilities are listed in its pinned [README](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/README.md#core-features).

Its default deployment contains separate web, PocketBase-backed database, and Meilisearch services with persistent volumes and health checks.

That topology is explicit in its pinned [`docker-compose.yml`](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/docker-compose.yml).

wanderer also implements provider imports as standalone WASM plugins with manifests, schemas, runtime discovery, host-mediated HTTP, authentication injection, policy enforcement, RPC, and scheduled or manual sync.

The official [`plugins/README.md`](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/plugins/README.md) documents that runtime and its security boundary.

### Applicability to goDiesel

**Reject:** the service topology is structurally inapplicable to a single-owner static application whose route catalogue is generated ahead of time.

The contrast is between wanderer's documented [sharing and search responsibilities](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/README.md#core-features) and goDiesel's single-owner bounded context in [`CONTEXT.md`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/CONTEXT.md).

**Reject:** do not introduce a plugin SDK or generic provider runtime for two known source kinds, because the manifest, worker, RPC, policy, OAuth, and lifecycle machinery would outweigh the two explicit adapters it replaced.

The real cost of that generalization is visible in wanderer's [plugin runtime flows](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/plugins/README.md#runtime-flows), while goDiesel's two source kinds and single adapter are defined in [`CONTEXT.md`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/CONTEXT.md#source-kind).

**Adopt only if the product changes:** a host-mediated provider boundary becomes defensible if goDiesel later supports independently installed providers, untrusted connector code, or multiple users' credentials.

Those are the conditions solved by wanderer's [host request boundary](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/plugins/README.md#host-request-boundary), and none is part of goDiesel's current canonical context.

## Concrete simplification decisions

### Adopt now

1. Delete the superseded static HTML application and its generation path from `build.py`, while preserving the frozen fallback tag rather than regenerating fallback output on every build.

   This completes the consequence already recorded in [ADR-0001](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0001-single-page-react-application-replaces-generated-static-app.md).

2. Refactor `build.py` behind an explicit `main()` and named stage functions before making further pipeline changes.

   This removes import-time execution identified in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md) and follows Organic Maps' explicit [generator driver](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#basic-usage).

3. Replace the aggregate `quests.generated.json` publication and verification dependency with the existing summary manifest plus per-route detail artifacts, then delete the aggregate.

   This finishes the two-tier model and removes the unused artifact documented in [ADR-0004](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0004-two-tier-route-data-with-lenient-summaries-and-strict-details.md).

4. Consolidate repeated pure route calculations into `domain/route` or `domain/geometry` and keep surfaces as consumers.

   This is already the enforced local direction in [ADR-0014](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0014-app-src-is-organised-by-surface.md) and matches gpx.studio's [domain package ownership](https://github.com/gpxstudio/gpx.studio/tree/6a0d4343718e01637a8e301251977fb218cf88f8/gpx/src).

5. Keep renderer translation behind the smallest existing port and centralize provider readiness and cleanup rather than adding provider branches to stages and React components.

   The local port is [`renderer-port.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/surfaces/replay/renderer-port.ts), and MapLibre provides the comparable [single-point-of-knowledge pattern](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md#parsing-and-layout).

### Adopt after proof

1. Delete the legacy Cesium Replay implementation and legacy cinematic grading implementation after a native-Google all-route scorecard, fallback verification, and the required live-provider gate pass.

   The evidence obligation and legacy status are recorded in [ADR-0009](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0009-native-google-maps-3d-is-the-primary-replay-renderer.md).

2. Preserve Cesium's Atlas implementation while deleting only Replay-specific legacy code, because Atlas and Replay have separate accepted renderer decisions.

   The Atlas responsibility remains explicit in [ADR-0006](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0006-cesium-is-the-production-atlas-world.md).

### Reject

1. Reject a general provider plugin system, because wanderer's real implementation shows that a credible plugin boundary requires manifests, validation, isolated workers, policy, authentication, lifecycle, and RPC rather than a small interface alone.

   The full cost is documented in wanderer's [`plugins/README.md`](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/plugins/README.md).

2. Reject a runtime database or search service for the generated route catalogue, because the current product has one owner and a bounded static corpus.

   wanderer's services exist for a searchable, shareable multi-user catalogue as shown by its [README](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/README.md#core-features) and [`docker-compose.yml`](https://github.com/open-wanderer/wanderer/blob/628f6ae8dddc1261995990f33543ad1500b71c43/docker-compose.yml).

3. Reject a second frontend domain package unless another real consumer appears, because the current structural guard already enforces purity without package and build-system overhead.

   The existing enforcement is visible in [`structure.test.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/structure.test.ts).

4. Reject custom worker, tile, style, or rendering frameworks, because MapLibre, Cesium, and Google already own those provider-level systems.

   MapLibre's official [architecture](https://github.com/maplibre/maplibre-gl-js/blob/8bec9e4105dca0b9e1daef6a4cca5d94b17f56ff/ARCHITECTURE.md) demonstrates how much machinery a real renderer requires.

5. Reject cross-platform or world-map abstractions from Organic Maps, because they solve offline global map production and three native UI platforms rather than a personal route atlas.

   Organic Maps documents that scope in [`docs/STRUCTURE.md`](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/docs/STRUCTURE.md) and [What are maps?](https://github.com/organicmaps/organicmaps/blob/910d1913b7523c7d9787b6c7d98b7c2eeeed4295/tools/python/maps_generator/README.md#what-are-maps).

## Safety order

The removal sequence should preserve behaviour by deleting one obsolete responsibility at a time.

1. Capture current pipeline artifacts, browser journeys, bundle checks, and live-provider evidence before changing generation or renderers, as required by goDiesel's [testing policy](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/agents/testing.md).

2. Remove the static fallback generator first because its replacement is already deployed and frozen by tag in [ADR-0001](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0001-single-page-react-application-replaces-generated-static-app.md).

3. Introduce an explicit pipeline entry point without changing output, prove byte-identical generation, and only then remove the unused aggregate artifact.

   The existing byte-comparison obligation is documented in [ADR-0003](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0003-python-generator-is-the-only-writer-of-route-data.md).

4. Consolidate duplicate pure calculations in small slices with focused unit tests before deleting the old call sites.

   The destination boundaries remain those enforced by [`structure.test.ts`](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/app/src/structure.test.ts).

5. Treat renderer deletion as a separate provider change that requires the native-Google route scorecard and live-provider gates, because [ADR-0009](https://github.com/the-prairie/goDiesel/blob/04fbc357f154de7bf2bde32ac9ac96a82e6b1ee8/docs/adr/0009-native-google-maps-3d-is-the-primary-replay-renderer.md) records that proof as outstanding.

## Final position

The comparison is consistent with a smaller goDiesel, not a more generalized
one. The local import graph, product contracts, and verification results are the
evidence for the actual deletions in this change.

The architecture to preserve is the existing pure route model, offline writer, two-tier read path, surface folders, and narrow renderer ports.

The architecture to remove is the superseded static application, publication artifacts with no runtime consumer, duplicate route derivations, and provider implementations whose product role has ended.

The architectures to refuse are multi-service catalogues, provider plugin hosts, native cross-platform cores, and custom renderer internals, because their complexity is structurally inapplicable to the current single-user static product.
