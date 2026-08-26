# Sovereign Adventure Worlds current truth specification

## Product truth

A route is the central goDiesel entity and recorded route geometry remains source truth.
A World Pack is a versioned, route-scoped preserved representation of the world around one route.
A World Pack does not assert that the owner completed, recorded, or visited anything beyond the canonical route evidence.
A World Pack may contain measured, reconstructed, derived, procedural, or unavailable geography only when that class is explicit at artifact and quality-cell grain.

The phrase World Pack is established by the goal but is not yet present in `CONTEXT.md`.
It remains a domain-modeling addition pending the architecture ADR and contract proof.

## Existing boundaries preserved

- `build.py` remains the only writer of generated route data.
- The compiler reads a strict route detail or a future explicit acquisition adapter.
- The compiler never changes route identity, coordinates, distances, timestamps, segment boundaries, lifecycle, completion, curation, or evidence labels.
- A route may exist without a World Pack.
- A World Pack version may improve without changing route identity or an earlier sealed version.
- Atlas and Replay production behavior remain unchanged during the isolated proof.
- Playable Route World v2 remains a lab under ADR-0008 until a separate promotion decision.
- Earth Engine and every other credentialed acquisition source stay outside the required runtime.

## Saved world boundary

A saved world is a sealed World Pack directory or deterministic archive that passes all of these checks:

- every required source and derived artifact is local and content-addressed;
- every required runtime reference resolves within the installed pack or shared local object store;
- the manifest names schema, compiler, configuration, source, transform, quality, and pack versions;
- the checksum inventory detects missing, extra, or modified required artifacts;
- coverage declares every cell inside the exploration boundary;
- each cell declares visual and physical quality and evidence class;
- runtime, collision, navigation, and cinematic inputs do not require network access or provider credentials;
- export and import preserve pack identity;
- repair can rebuild derived artifacts from the retained normalized source inventory;
- a failed build or repair leaves the previous sealed version unchanged.

A browser cache, service-worker cache, live tile URL, signed URL, provider response without retained licence evidence, screenshot, or partially populated directory is not a saved world.

## Acquisition and runtime boundary

Acquisition adapters may use local owner files, public datasets, or explicitly licensed services.
They must normalize retained inputs into durable internal artifacts and record the source URI, acquisition time, source date when known, licence, attribution, checksum, media type, and adapter version.
The runtime may read only the World Pack contract and local content-addressed objects.
Temporary live visual enhancement is a separate overlay and can never satisfy a required coverage cell.

## Visual and physical worlds

The visual world and physical world are separate manifest graphs.
Visual assets may include imagery, textured terrain, detailed structures, photogrammetry, splats, and procedural materials.
Physical assets use deterministic terrain collision, structure proxies, traversable surfaces, route corridors, navigation graphs, slope rules, and recovery anchors.
No visual level-of-detail mesh is the sole collision source.

Movement remains disabled until the active physical neighbourhood passes integrity and readiness checks.

## Determinism

The same normalized source inventory, compiler version, configuration, quality preset, and deterministic platform-independent inputs must produce byte-identical JSON, route geometry, physical geometry, navigation, coverage, lineage, checksum, and camera-plan artifacts.
Archives normalize entry ordering, timestamps, ownership, permissions, and compression metadata.
GPU pixels may use a documented perceptual comparison, but the render input manifest, geometry, transforms, camera timeline, frame count, and shot timing must remain exact.

## Versioning and non-destruction

World Pack identity is derived from its canonical manifest content and required artifact inventory.
Every build writes to a staging directory and becomes visible only after verification and an atomic rename.
Sealed versions are immutable.
New sources or transformations produce a new version and retain prior evidence rather than overwriting it.
Migrations create a new readable version or compatibility view and never mutate the only copy of an older sealed version.

## Required quality language

Evidence class is one of `recorded`, `derived`, `measured`, `reconstructed`, `procedural`, or `unavailable`.
The existing route evidence labels remain unchanged; the additional World Pack classes apply to world geography and transformation outputs, not route history.
Visual quality and physics quality are separate explicit tiers.
No silent gap, unlabelled invention, or inferred owner history is permitted.

## Reference worlds

The fixed Stage 0 corpus is declared in `reference-corpus.json`.
It selects one dense urban recorded route, one high-relief mountain recorded route, and one remote coastal recorded route from current strict public route details.
Selection does not claim that existing public details contain all original source evidence required for a sealed Archival pack.

## Promotion boundary

The compiler foundation can be reviewed and merged independently when its deterministic, integrity, archive, repair, migration, and failure-atomicity gates pass against synthetic and fixed route inputs.
The local runtime remains a lab until all three reference packs pass offline guided traversal, ten-minute free roam, collision, owner-hardware performance, deterministic cinema, clean-room import, repair, and human-quality gates.
Route Studio integration begins only after those isolated proofs and only through an explicit adapter.
