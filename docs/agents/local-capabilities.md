# Canonical Local Capabilities

Use `scripts/godiesel` for route generation, owner curation, planned-route persistence inspection, and provider readiness.
These adapters preserve the existing Python writers, browser storage boundary, provider loaders, and verification gates.

## Route Generation

Inspect generated inventory without reading private route values or invoking the writer:

```sh
./scripts/godiesel inspect route-generation --json
```

After reviewing canonical source changes, rebuild both generated tiers through `build.py` with explicit local authority:

```sh
./scripts/godiesel apply route-generation --authorize canonical-local --json
```

The adapter invokes `rebuild.sh`; it never imports `build.py` or writes generated data itself.
`rebuild.sh` delegates to the locked `route_build.py` writer entry point.
Route creation owns the same lock inside `route_create.py`, so both the unified interface and retained `scripts/route.sh` commands share one write boundary with owner curation and Admin.
The existing staging, backup, atomic replacement, and interrupted-run recovery remain authoritative.
The writer fails the whole generation when any approved route lacks metadata, source geometry, or route points, so an incomplete projection cannot replace the complete public catalogue.
After the writer exits successfully, the adapter independently inspects the complete projection and reports a blocked result when any inventory, field, provenance, or aggregate remains stale.
Inspection validates the manifest version, generation timestamp, inventory statistics, route identities, strict detail and summary consumer contracts, durable-source metadata and geometry, canonical annotations and replay choices, exact detail-to-manifest projection, and aggregate statistics derived from valid detail records.
Route-generation proof fingerprints the selected private Strava metadata and geometry as one path-free aggregate, monitors those source files during the gate, and never writes their paths or values into the evidence receipt.

Run or reuse focused proof:

```sh
./scripts/godiesel verify route-generation --json
./scripts/godiesel verify route-generation --reuse --json
```

## Owner Curation

Inspect counts by curation status without returning owner-authored copy:

```sh
./scripts/godiesel inspect owner-curation --json
```

Create a closed request containing `schema_version: 1`, `document_type: owner-curation-request`, one existing `activity_id`, and a `curation` object that satisfies the owner-curation domain contract.
Turn that request into a deterministic review plan:

```sh
./scripts/godiesel plan owner-curation --request <request-json> --json
```

The plan is written under ignored `.godiesel/plans/owner-curation/`.
It records the observed canonical and generated state fingerprint, the exact checkout and implementation identity, a privacy-safe field-level change summary, a self-digest, and the complete possible write set.
That set includes the mutation lease, `quests.json`, both generated metadata files, their atomic temporary and recovery files, the generated route-detail directory, and ignored source, projection, staging, and full-generation recovery paths.
When automatic rollback cannot finish, the blocked result names only repository-relative recovery paths for manual repair.

Review the plan, then apply that exact file with explicit local authority:

```sh
./scripts/godiesel apply owner-curation --plan <plan-path> --authorize canonical-local --json
```

Apply blocks when the plan digest is invalid, the checkout or implementation changed, or route state changed after planning.
Reapplying an already completed plan succeeds without invoking the writer again only when canonical curation and the complete generated projection agree.
The CLI and loopback HTTP endpoint call the same `save_owner_curation` service, which retains validation, incremental publication, full-rebuild fallback, source rollback, and generated-file recovery behavior.
All Admin and unified CLI writes to the owner-owned route catalogue or its generated projections share one non-blocking cross-process lock.

Run or reuse the existing writer and recovery proof:

```sh
./scripts/godiesel verify owner-curation --json
./scripts/godiesel verify owner-curation --reuse --json
```

Fresh verification and proof reuse both block while full-generation backup or staging residue exists, including malformed or dangling symbolic-link entries.

## Planned Routes

Inspect the persistence boundary:

```sh
./scripts/godiesel inspect planned-route-persistence --json
```

The command reads the storage key and version metadata from `app/src/data/planned-route-store.ts`.
It reports the current planned-route count as unknown because that state belongs to the active browser profile.
It never reads, writes, or projects planned routes into `quests.json`.

## Provider Readiness

Inspect configuration presence without emitting values or claiming provider success:

```sh
./scripts/godiesel inspect provider-readiness --json
```

Every provider remains `not_run` until an explicit live check completes.
Earth Engine remains owned by the complete live-pipeline verification because that workflow has broader source and deployment effects.

Run one existing live browser check against one exact target:

```sh
./scripts/godiesel verify provider-readiness --provider atlas --provider-target <url> --json
./scripts/godiesel verify provider-readiness --provider earth-replay --provider-target <url> --json
./scripts/godiesel verify provider-readiness --provider google-3d --provider-target http://localhost:8787 --json
```

The target must be an HTTP or HTTPS URL without credentials, query parameters, or fragments.
It must name an origin root and expose `build-identity.json` from that same origin.
That identity must declare `artifact_kind: built-artifact`; a Vite development server is not valid live-proof evidence even when it exposes the same commit and tree.
Route microsites built from pending working-tree changes declare `artifact_kind: unverified-working-tree-artifact` and are also ineligible for provider proof.
Google 3D is stricter: its only valid target is exactly `http://localhost:8787`.
When that origin is not already running, the adapter starts a Vite preview of the exact prebuilt `app/dist` artifact, waits for its identity, and stops the process after verification.
Production builds require a clean Git checkout, and the identity binds the commit, Git tree, and a unique immutable build instance id.
Built identities also bind a canonical artifact manifest, and provider verification independently fetches and hashes every declared served file before accepting the target.
The adapter records configuration presence, deployed identity, and a digest of the exact target in an ignored evidence receipt.
It reads and validates the deployed identity before and after the live gate, rejects redirected identity documents, and blocks if the target changes during execution.
Google preview verification holds one lease in the repository's Git common directory for the complete preview lifecycle.
Every sibling worktree therefore coordinates ownership of the host-global local target before starting, inspecting, or stopping its preview.
If the shared Git directory cannot be resolved, verification blocks before reading or launching the target.
Configuration presence and a passing deterministic test never substitute for this live result.

Reuse is provider- and target-specific:

```sh
./scripts/godiesel verify provider-readiness --provider atlas --provider-target <url> --reuse --json
```

Live-provider proof can be reused for at most 15 minutes and only while its exact origin, freshly observed build instance, clean local commit and tree, configuration presence, selected command, and covered inputs remain unchanged.

Do not run a live provider command merely because configuration exists.
Run it only when the intended claim depends on that provider, renderer, terrain, imagery, or camera behavior.

## Evidence

Successful generation, curation, and provider verification writes a schema-valid receipt under ignored `.godiesel/evidence/`.
Normal gates do not rewrite tracked screenshots.
Set `GODIESEL_CAPTURE_E2E_EVIDENCE=1` only when deliberately refreshing archival browser evidence, and review the resulting image diffs.
Impact rules decide which gates a changed path requires.
Each exact verification command declares its implementation, contract, fixture, configuration, data, renderer, and provider entry points.
The proof layer recursively includes repository-local Python and JavaScript or TypeScript imports, so a transitive executable dependency invalidates the same receipt and selects the same gate.
The adapter snapshots every covered state before and after the gate.
On macOS and Linux it also monitors existing covered files and every directory in recursive covered trees, so a transient content or permission write-and-restore in those inputs invalidates proof.
Absent exact inputs and additions to nonrecursive wildcard patterns are certified by before/after state only; they are not represented as continuously monitored.
Broken or external covered-input symlinks block proof instead of disappearing from the fingerprint.
Those command inputs also narrow a known provider path to its applicable live check; a newly classified provider path that matches no known command expands to every command in the tier so proof cannot disappear silently.
The generation, curation, and live-provider commands also run their adapter contract tests before recording success.
Raw test output, private route values, and secret values are not included.
