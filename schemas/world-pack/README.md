# World Pack schemas

`v1` contains the closed JSON Schema 2020-12 contracts for a sealed World Pack.
Runtime and compiler documents reject unknown fields at their declared boundaries.

Identity-bearing JSON is serialized with RFC 8785 JSON Canonicalization Scheme bytes.
Human-readable files may add one trailing newline, which is included in the artifact checksum but excluded from identity derivation when the contract names canonical content.

The schemas separate these concerns:

- `manifest` identifies one immutable pack and its required artifacts.
- `artifact` defines a content-addressed retained or derived file.
- `source-inventory` records admissible source evidence, licence, attribution, and acquisition lineage without workstation paths.
- `source-receipt` binds downloaded custody bytes to immutable source versions and retained legal evidence before compiler admission.
- `transformations` records deterministic compiler steps and their input and output content identities.
- `coverage` records visual and physical provenance for every declared quality cell, including explicit unavailability.
- `canonical-route` preserves normalized route truth without inventing route history.
- `runtime-world` resolves every required local runtime asset and declares no provider or network dependency.
- `world-navigation` records fixed-timestep actor constraints, route nodes, edges, checkpoints, and recovery anchors.
- `camera-timelines` fixes camera geometry, frame count, frame rate, and route-relative timing.
- `experience-manifest` binds a sealed pack identity to its deterministic camera and geometry artifacts without making the self-reference part of pack identity.
- `checksums` covers every sealed file except the checksum document itself.
- `migration-version` declares reader compatibility and non-destructive migration ancestry.

These schemas do not grant a source licence or turn derived route detail into an original owner recording.
