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
Generation shares the catalogue mutation lock with route creation, owner curation, and every Admin writer that can change canonical or generated route state.
The existing staging, backup, atomic replacement, and interrupted-run recovery remain authoritative.

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
It records the observed canonical and generated state fingerprint, a self-digest, and the complete possible write set.
That set includes `quests.json`, both generated metadata files, and the generated route-detail directory because a failed incremental publication may invoke the full-generation fallback.

Review the plan, then apply that exact file with explicit local authority:

```sh
./scripts/godiesel apply owner-curation --plan <plan-path> --authorize canonical-local --json
```

Apply blocks when the plan digest is invalid or route state changed after planning.
Reapplying an already completed plan succeeds without invoking the writer again only when both canonical curation and every required generated projection agree.
The CLI and loopback HTTP endpoint call the same `save_owner_curation` service, which retains validation, incremental publication, full-rebuild fallback, source rollback, and generated-file recovery behavior.
All Admin and unified CLI writes to the owner-owned route catalogue or its generated projections share one non-blocking cross-process lock.

Run or reuse the existing writer and recovery proof:

```sh
./scripts/godiesel verify owner-curation --json
./scripts/godiesel verify owner-curation --reuse --json
```

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
./scripts/godiesel verify provider-readiness --provider google-3d --provider-target <url> --json
```

The target must be an HTTP or HTTPS URL without credentials, query parameters, or fragments.
The adapter records configuration presence, provider identity, and a digest of the exact target in an ignored evidence receipt.
Configuration presence and a passing deterministic test never substitute for this live result.

Reuse is provider- and target-specific:

```sh
./scripts/godiesel verify provider-readiness --provider atlas --provider-target <url> --reuse --json
```

Live-provider proof can be reused for at most 15 minutes and only while its exact target, configuration presence, selected command, and covered inputs remain unchanged.

Do not run a live provider command merely because configuration exists.
Run it only when the intended claim depends on that provider, renderer, terrain, imagery, or camera behavior.

## Evidence

Successful generation, curation, and provider verification writes a schema-valid receipt under ignored `.godiesel/evidence/`.
Impact rules decide which gates a changed path requires.
Each exact verification command separately declares the implementation, contract, fixture, configuration, data, renderer, and provider inputs that invalidate its receipt.
Those command inputs also narrow a known provider path to its applicable live check; a newly classified provider path that matches no known command expands to every command in the tier so proof cannot disappear silently.
The generation, curation, and live-provider commands also run their adapter contract tests before recording success.
Raw test output, private route values, and secret values are not included.
