# Physical Runtime Contract

The World Pack runtime uses separately compiled terrain and traversable-surface collision GLBs as physical authority.
The visual terrain model never determines player grounding, collision, or recovery.

## Readiness

Movement remains disabled until the browser has verified the pack identity, checksum ledger, every runtime-required artifact, collision GLB grid topology, navigation graph, actor contract, and recovery anchors.
A rendered frame without that physical neighbourhood is still loading, not ready.

## Simulation

The navigation document owns the fixed timestep and actor dimensions.
Core v1 runs at 60 Hz with a 0.35 m actor radius, 1.75 m actor height, 0.35 m maximum upward step, and 35 degree maximum slope.
The runtime consumes exactly one fixed timestep per simulation step.
Display frame duration does not alter collision integration.

Movement is divided into substeps no longer than 45 percent of the actor radius.
Every substep samples the same triangle topology stored in the collision GLBs.
The actor footprint must remain inside the terrain mesh.
An admitted structure obstacle is expanded by the actor radius and height before a move is accepted.
These rules prevent a fast frame from tunnelling through a thin obstacle or crossing a world edge between collision samples.

## Terrain

The Core terrain collision GLB is a regular route-local ENU grid with explicit indexed triangles.
The browser validates monotonically increasing axes, rectangular rows, finite float positions, index type, triangle count, and the exact compiler grid topology before constructing the heightfield.
Height and slope are evaluated on the indexed triangle under the actor rather than interpolated from the visual model.

The traversable-surface GLB is a separately checksummed indexed triangle mesh.
It preserves the recorded route elevation and can represent more than one support elevation at the same horizontal coordinate.
The runtime selects the layer nearest the actor's current or recorded elevation, so a route crossing does not collapse onto a single-valued terrain heightfield.
Current packs declare `heightfield` terrain, `indexed-triangle-mesh` traversable surfaces, and `footprint-prisms` structure collision.

## Route Relationship

Free-roam position is projected onto the closest recorded route segment after every fixed step.
The projection supplies route progress, checkpoint selection, ghost comparison, and a deterministic rejoin target without forcing the actor to remain on the route.
Rejoin projects only onto declared navigation edges and samples the layered traversable surface at that point.
Recorded discontinuities have no navigation, route-thread, or traversable-ribbon edge, so rejoin and route seeking snap to recorded evidence rather than interpolating through a gap.
It does not teleport to a visually inferred road or provider surface.

## Failure And Recovery

An invalid or missing collision sample fails closed.
An attempted move across the collision boundary is blocked in place.
An actor state that is already outside valid support recovers to the most recently passed declared recovery anchor.
The recovery increments an inspectable counter and never places the actor in a void.
A slope, upward step, or structure obstacle violation blocks horizontal movement and increments an inspectable blocked-tick counter.
The actor remains grounded on the last accepted physical surface.

## Current Evidence Limit

Tokyo contains procedural route-derived terrain collision, while Banff and Ucluelet contain admitted measured terrain with declared no-data behavior.
All three packs compile retained OSM building footprints into route-cleared obstacle prisms.
Repeated real-pack traversal and owner-Mac performance evidence are recorded under `docs/world-packs/proof`; blind experiential quality remains a separate promotion gate.
