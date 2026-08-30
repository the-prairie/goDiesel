# Route Share Workflow

This protocol turns structured agent intake into one locally reviewable route share.
Creation and public publication are separate owner-authority boundaries.

## State Machine

```text
intake -> proposal -> owner approval -> create -> validate -> local preview
       -> owner publication approval -> publish -> public smoke test
```

Do not skip a state.
The original request to make a route page does not by itself authorize a durable public URL.

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
./scripts/route.sh propose --request request.json > proposal.json
```

`propose` may write an ignored, checksum-verified staging copy under `.route-share/`.
It does not modify `quests.json`, `route_sources/`, generated data, or a public deployment.
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

## Creation And Preview

After explicit approval to create, run:

```sh
./scripts/route.sh create --proposal proposal.json
./scripts/route.sh preview <slug>
```

`create` registers durable sources, atomically updates `quests.json`, rebuilds generated data, validates source health and the microsite source record, and emits a JSON creation report.
The same approved proposal may be applied again and returns `already_applied`.
If post-write validation fails, report the recoverable state under `.route-share/recovery/` and do not publish.

`preview` runs the existing route-only dry-run before it starts a loopback-only server on an available port.
Use `--detach` only when a background preview is useful; it writes a PID and log under `.route-share/`.
Report the exact validation outcome, local guide URL, and local Replay URL.

## Publication

Stop after local preview until the owner explicitly authorizes publication and confirms the stable share name.
Then run:

```sh
./scripts/route.sh publish <slug> <share-name>
```

The command reuses the existing route-only build, Playwright journey, Cloudflare Pages deployment, and public smoke test.
It refuses an existing `share-<name>` branch.
Use `--replace-existing` only when the owner explicitly approves replacement of that durable URL.

Report the public guide URL, public Replay URL, and smoke-test result.
Google 3D or terrain promises still require the live-provider review described in `docs/agents/testing.md`.
