# Route Share Workflow

This protocol turns structured agent intake into one locally reviewable route share.
Creation and public publication are separate owner-authority checkpoints.

This is the first implemented vertical slice of the operator model in `docs/architecture/agent-operating-system.md`.
The five-verb `scripts/godiesel` interface is authoritative for agent operation.
The existing `scripts/route.sh` interface remains available as a compatibility adapter while parity is measured.

## Operator contract

| Operator verb | Unified command | Authority | Primary result |
| --- | --- | --- | --- |
| Inspect | `./scripts/godiesel inspect route-share [slug] --json` | Read only | Current route readiness |
| Plan | `./scripts/godiesel plan route-share --request <file> --json` | Ephemeral local | Fingerprinted proposal in a result envelope and ignored proposal file |
| Apply | `./scripts/godiesel apply route-share --proposal <file> --authorize canonical-local --json` | Canonical local | Creation report in a result envelope |
| Verify | `./scripts/godiesel verify route-share <slug> --json` or `--preview` | Ephemeral local | Validation, focused journey, and optional loopback URLs |
| Release | `./scripts/godiesel release route-share <slug> <name> --authorize external-durable --authorize-target <name> --json` | External durable | Deployment, stable URLs, public smoke result, and receipt |

Standard output is a `system/result.schema.json` result envelope.
The unchanged domain result is under `result`.
Treat that value as the domain authority rather than parsing terminal narration.
Plan, apply, verify, and release also write ignored route-transition receipts under `.route-share/runs/` and their digest-verifiable results under `.route-share/results/`.
These Phase 2 receipts prove route workflow lineage only.
The repository fingerprint, gate attribution, configuration presence, and other system-wide evidence fields remain part of the Phase 3 proof-receipt contract.

## State Machine

```text
intake -> proposal -> owner approval -> create -> validate -> local preview
       -> owner publication approval -> publish -> public smoke test
```

Do not skip a state.
The original request to make a route page does not by itself authorize a durable public URL.

The approved proposal is the durable plan.
If canonical route state, source content, media content, or proposal semantics change after approval, produce a new proposal rather than repairing the old one by hand.

## Intake

Translate the owner brief and attachments into a JSON request that satisfies `route_create.schema.json`.
Do not infer geometry.
A new route requires `gpx_path`, `activity_type`, `route_name`, `region`, and either `source_description` or `curation.vibe`.
An existing route requires `existing_slug` and does not duplicate or rewrite its source.
Use `lifecycle=discovered` unless owner-recorded completion evidence is supplied as `completion_evidence`.
Leave `activity_date` absent when the date is unknown.
Media must declare either a route-level association or an existing annotation id.

Example new GPX request:

```json
{
  "schema_version": 1,
  "gpx_path": "/owner/supplied/ridge-traverse.gpx",
  "activity_type": "Run",
  "route_name": "Ridge Traverse",
  "region": "Kananaskis, Alberta",
  "source_description": "A supplied ridge route with an exposed return.",
  "curation": {
    "vibe": "A high, exposed traverse for a settled-weather day.",
    "caveats": ["The return is exposed to fast weather changes"]
  },
  "annotations": [
    {
      "id": "exposed-return",
      "at_distance_m": 6400,
      "kind": "warning",
      "evidence": "hypothesis",
      "body": "Turn back before this point if weather is building."
    }
  ],
  "proposed_share_name": "ridge-traverse"
}
```

Example existing-route request:

```json
{
  "schema_version": 1,
  "existing_slug": "3519505225411091950",
  "curation": {
    "vibe": "Rome loosening into the Appian landscape."
  },
  "proposed_share_name": "appian-way"
}
```

## Proposal

Run:

```sh
./scripts/godiesel plan route-share --request request.json --json
```

`propose` may write an ignored, checksum-verified staging copy under `.route-share/`.
The result envelope's `receipt.result_path` points to the exact proposal under `.route-share/proposals/` for the apply transition.
It does not modify `quests.json`, `route_sources/`, generated data, or a public deployment.
Partial curation in an existing-route request is merged over the route's current curation; omitted reviewed fields are preserved.
Do not edit fields outside the closed proposal schema.

Present the proposal in plain language before creation:

```text
Route: <name> in <region>
Activity: <Run or Ride>
Lifecycle: <discovered or completed> because <evidence basis>
Source: <filename>, SHA-256 <first 12 characters>...
Geometry: <distance>; timestamps <recorded or unavailable>; elevation <recorded or unavailable>
Guide: <editorial premise and evidence labels>
Identity: <route id>
Proposed share: <name or not chosen>
Blocking problems: <none or exact codes>
Warnings: <none or exact codes>
```

Stop for missing geometry, lifecycle contradictions, unsafe paths, identity conflicts, unresolved annotation placement, or a choice that materially changes public meaning.

Record the proposal id and digest-bearing source observations in the handoff.
Do not expose absolute private source paths or full checksums in public release notes.

## Creation And Preview

After explicit approval to create, run:

```sh
./scripts/godiesel apply route-share --proposal .route-share/proposals/<proposal-id>.json --authorize canonical-local --json
./scripts/godiesel verify route-share <slug> --preview --json
```

`create` registers durable sources, atomically updates `quests.json`, rebuilds generated data, validates source health and the microsite source record, and emits a JSON creation report.
The same approved proposal may be applied again and returns `already_applied`.
If post-write validation fails, report the recoverable state under `.route-share/recovery/` and do not publish.

`preview` runs the existing route-only dry-run before it starts a loopback-only server on an available port.
That bundle contains only the shared route's generated record and public media referenced by that record.
Use `--detach` only when a background preview is useful; it writes a PID and log under `.route-share/`.
Report the exact validation outcome, local guide URL, and local Replay URL.

## Evidence artifacts

| Artifact | State class | Purpose |
| --- | --- | --- |
| Request JSON | Agent input | Structured owner intent; not approved state |
| Proposal JSON | Ignored evidence and plan | Reviewable normalized transition with source observations |
| Capability result | Runtime evidence | Stable envelope around the unchanged domain result, authority, issues, and receipt pointer |
| Route-transition receipt and result artifact | Ignored evidence | Digest-linked transition outcome, exact local result, and proposal-specific lineage |
| Staged source and media | Ignored ephemeral local state | Checksum-verified inputs used by an approved proposal |
| Creation report JSON | Evidence result | Applied or already-applied result and validation |
| `quests.json` and durable source files | Canonical authored state | Durable route identity, metadata, curation, and source |
| Generated route records | Generated projection | Build output; never hand edited |
| Local preview | Runtime evidence | Owner review without public effect |
| Cloudflare deployment | External durable state | Public route-scoped artifact |

Evidence does not replace state inspection.
Recheck canonical and remote state before retrying after an ambiguous failure.

## Publication

Stop after local preview until the owner explicitly authorizes publication and confirms the stable share name.
Then run:

```sh
./scripts/godiesel release route-share <slug> <share-name> --authorize external-durable --authorize-target <share-name> --json
```

The command reuses the existing route-only build, Playwright journey, Cloudflare Pages deployment, and public smoke test.
It refuses an existing `share-<name>` branch.
Use `--replace-existing` only when the owner explicitly approves replacement of that durable URL.
The release authority class and `--authorize-target` value must both be present.
The target value must exactly match the requested stable share name and does not imply replacement authority.
An approved replacement also requires `--authorize-replacement <share-name>` for that exact alias.
The unified release path also requires passed, digest-matched plan, apply, and verify receipts for the same route.
Use the compatibility adapter only for an explicitly reviewed legacy workflow, not to bypass this state machine.

Report the public guide URL, public Replay URL, and smoke-test result.
Google 3D or terrain promises still require the live-provider review described in `docs/agents/testing.md`.

Report both the immutable deployment URL and the stable alias when Wrangler provides them.
State explicitly when hardware-accelerated Google 3D remains unverified by headless smoke testing.

## Failure handling

- Invalid request or source observations require a corrected request and new proposal.
- A source or canonical-state conflict after approval requires reinspection and a new proposal.
- A failed canonical write must report whether state is unchanged or recoverable under `.route-share/recovery/`.
- A failed focused journey blocks publication.
- An ambiguous remote failure requires remote inspection before retrying.
- A successful upload without a public smoke test is not a completed publication.
