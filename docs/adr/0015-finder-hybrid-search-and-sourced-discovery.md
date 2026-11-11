# ADR 0015: Finder searches guides and discovers sourced paths

Status: Accepted for local implementation, 2026-10-13.

Deployment update, 2026-10-14: the user authorized publishing this personal
application to the existing Cloudflare Pages production project. See
`docs/dogfood-reports/2026-10-14-production-release.md` for the artifact,
configuration, deployed checks, and the remaining public-scale limitations.

Finder previously searched four manually chosen candidates. It now searches all
published routes, using BM25 keyword scoring and cosine similarity of guide
embeddings. Exact activity, place, distance bounds, climb ceiling, and documented
terrain filter candidates before ranking. Match explanations cite recorded
metrics or guide excerpts; editorial text remains interpretation.

A bounded English parser extracts common activity, place, kilometre range, and
climb-ceiling phrases. The visible applied filters are authoritative and editable.
Unrecognised language remains a text query; this is not an unrestricted LLM
planner. A route-similarity query uses a named reference route's embedding.

The derived search cache is built from generated route guides, not imagery or
private raw exports. `npm run search:index` computes normalized 384-dimensional
MiniLM embeddings. `npm run search:check` verifies source fingerprints before
builds. It never modifies canonical route records. Route data still belongs to
`build.py`.

Query inference runs lazily in a web worker using the version-pinned
Transformers.js standalone browser runtime. This avoids a paid inference account
and sends no query text or collection content to a model service. The browser
fetches model/runtime assets from Hugging Face and jsDelivr. First use requires a
model download; subsequent loads use browser caches. An unavailable model leaves
keyword search usable and visibly labelled. This is the web-sized adaptation of
DigUp's lexical-plus-vector pattern, not a port of its desktop multimodal model.

External discovery uses a shared `/api/discovery` handler in Vite development /
preview and Cloudflare Pages Functions. Photon resolves explicit place searches;
ambiguous names require a user choice. Overpass returns named hiking, walking,
running, bicycle and MTB route relations within 18 km. Requests have fixed
upstreams, bounded radius/response size/time, throttling and a bounded cache.

External candidates are not `RouteSummary` memories and are never replayable or
silently saved as completed activities. Their source relation remains linked.
Missing/nested relation geometry is rejected; member lines remain separate, so
no route is invented across a gap. Source distances and mapped path lengths are
labelled separately. Unknown ascent or surface cannot pass an explicit filter.
Source descriptions are attributed to OSM. Current access, continuity and trail
conditions are not asserted. Named-route coverage is limited and providers may
fail; the collection remains available independently.

No automatic official-site crawling, arbitrary URL fetching, route generation,
or invented GPX export is included. External paths can be inspected at source;
importing one into the canonical library continues through the existing import
workflow. Before public-scale use, move the public community provider endpoints
to hosted capacity and add durable global rate limiting. This release is the
personal local application; no deployment or paid-service setup is implied.

References:
- https://github.com/ARahim3/DigUp
- https://huggingface.co/Xenova/all-MiniLM-L6-v2
- https://github.com/huggingface/transformers.js
- https://github.com/komoot/photon
- https://wiki.openstreetmap.org/wiki/Relation:route


## Extension: discovery planning, 2026-10-14

External candidates can now be saved in a separate, versioned local store
(`godiesel.external-plans.v1`). They appear in Routes under Planned, retain source
geometry, and can be previewed, removed, or exported as GPX. A storage failure
is displayed rather than reported as a successful save. Export writes separate
track segments without fabricated connectors, elevations or timestamps. This
supersedes the earlier source-link-only planning limitation; it does not create
a canonical recorded route or enable replay.

External ranking now uses keywords and the same browser-local semantic model.
Only source names, descriptions and documented surface tags are embedded. Place
and numeric constraints are removed from the semantic query because they are
already enforced as filters. Names without descriptions receive reduced
semantic weight; exact name matches retain lexical weight. An unavailable model
leaves keyword ranking usable. The model is not used to infer missing facts.

Topology classification uses exact shared coordinate vertices and undirected
edges. It identifies a mapped loop, open path, branching paths or disconnected
components, without snapping gaps or proving traversability. Substantial
source-versus-mapped distance differences are surfaced, and neither length may
violate an explicit distance filter. Overpass way surface tags provide
length-weighted coverage; partial tagging never establishes the whole surface.
Climb remains source-tagged when available, unknown otherwise. No terrain-derived
elevation profile or verified access claim is introduced.
