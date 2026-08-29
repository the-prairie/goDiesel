# World Pack repair and migrations

## Repair contract

`godiesel world repair` first performs full pack verification.
A valid pack is a no-op.

For a damaged single-source pack, foundation repair requires the valid manifest and one retained strict route-detail source inventory.
It accepts source bytes only when their SHA-256 and byte size match the inventory.
If the pack copy is damaged, it may recover the same source object from the repository content-addressed store.
If both copies are missing or damaged, repair stops before modifying the installed pack.

That source-rebuild path reconstructs the entire single-source pack in an isolated repository from the retained source, acquisition metadata, licence, attribution, quality preset, radii, quality-cell size, and deliberate-gap fixtures recorded in the manifest.
The rebuilt pack must have the exact expected pack ID and pass full verification.

The active reference packs combine multiple independently acquired sources.
Their exact recovery contract is the repository content-addressed store or a retained portable `.worldpack.zip` archive whose transport checksum and internal pack checksums verify.
Importing that archive restores the same immutable pack identity without contacting a provider.
The compiler does not claim that a lone route-detail source can reproduce missing terrain, structure, licence-evidence, or other independently acquired bytes.

Only then does repair move the damaged pack to `quarantine/<world-id>/`, atomically install the rebuilt pack at the original identity path, seal it, and verify it again.
A failed swap restores the quarantined directory.
Damaged content-addressed objects are also quarantined before their source-rebuilt bytes are re-admitted.

## Migration contract

Migrations advance exactly one schema version per registered step.
They operate on copies and must return the declared next version.
Missing paths, duplicate registrations, wrong returned versions, and future schemas fail by name.

The current pack schema is v1 and has no older sealed pack format in the repository.
Running `godiesel world migrate` on a valid v1 pack is therefore a verified no-op.
No speculative v0 migration is provided, and no current pack is rewritten merely to exercise the framework.
