---
status: accepted
date: 2026-08-26
deciders: owner
---

# ADR-0015: A local World Pack is the canonical saved world

## Context

Atlas, Replay, and Playable Earth currently render compelling geography from live providers.
The fixed three-route Stage 0 baseline proved that every immersive path requires external runtime content and that the current experiences made 24,981 external requests during the aggregate ten-minute workload.
Removing providers and credentials made every current immersive path unavailable or caused a non-local request.

Provider content is useful visual evidence but does not preserve a route world.
Provider availability, keys, upstream updates, signed URLs, browser cache, and licence terms can all change independently of a route.
The recorded route remains source truth under ADR-0003 and ADR-0004.

Playable Earth also remains a lab under ADR-0008.
Its Stage 0 grounding offsets and visible level-of-detail discontinuities do not satisfy a physical-world or durability commitment.
ADR-0009 still governs production Replay and is not superseded by this compiler foundation.

## Decision

The canonical saved-world artifact is a versioned, route-scoped, provider-independent local World Pack.

Acquisition and runtime are separate.
Acquisition adapters may admit local, public, or explicitly licensed evidence, but the runtime reads only verified local artifacts named by the World Pack contract.

Visual and physical worlds are separate.
Renderable terrain, imagery, structures, and reconstruction never serve as the sole collision source.
Stable terrain collision, structure collision, traversable surfaces, navigation, constraints, and recovery anchors are independently retained.

Every source and artifact is addressed by SHA-256 and records byte size, media type, format version, evidence class, and transformation lineage.
Identity-bearing JSON uses RFC 8785 JSON Canonicalization Scheme bytes.
The v1 portable archive is deterministic ZIP64 with stored entries, fixed timestamps, fixed permissions, and lexicographic paths.

Pack identity is the RFC 8785 hash of the closed manifest identity projection and all non-self-referential artifact records.
The cinematic experience manifest embeds the pack ID and is therefore a pack-binding artifact outside that identity projection.
Its camera timeline and geometry are inside the identity projection, and the binding artifact remains checksum-covered and verifier-checked.

Builds stage all files, validate schemas, compute identity and checksums, and promote by atomic rename.
The current-version pointer changes only after promotion and sealing.
An existing pack ID with different checksums is a conflict and is never overwritten.

World Pack repair rebuilds from verified retained source evidence and deterministic configuration.
It preserves damaged pack and CAS bytes in quarantine and installs a replacement only when the rebuilt identity exactly matches and full verification passes.
Migrations are ordered, non-destructive, and never mutate the only copy of an older sealed version.

## Consequences

- A saved world remains usable without a provider, credential, browser cache, or original workstation path.
- A source or compiler change creates a new pack identity while earlier sealed versions remain readable.
- Portable archives are larger because v1 stores entries without compression.
- The Core v1 compiler can produce a complete integrity contract from strict route detail, but its terrain and materials are explicitly procedural and its structures, transportation, reconstruction, annotations, and media are explicitly unavailable until stronger sources are admitted.
- A structurally complete Core pack is not automatically a production-quality playable world.
- Playable Route World v2 remains a lab until offline runtime, physical traversal, cinematic, clean-room, performance, and human-quality gates pass for all three reference worlds.
- Source licences and attribution are required build inputs rather than inferred from provider reachability.
- The first pack-binding exclusion is narrow and verifier-enforced; adding another self-referential artifact requires a new contract version or ADR.

## Evidence

- `docs/world-packs/documentation-reality-check.md`
- `docs/world-packs/current-truth-specification.md`
- `docs/world-packs/architecture-reconciliation.md`
- `docs/world-packs/baseline/current-runtime-provider-disabled.json`
- `docs/world-packs/baseline/live-reference-runtime.md`
- `docs/world-packs/spikes/open-formats-and-sources.md`
- `docs/world-packs/portable-archive-format.md`
- `schemas/world-pack/`
- `world_packs/`
- `c8c68055`, `1ee95b7b`, `06ea9a2f`, `f0efc924`, `f51f61c6`
