# Playable Earth Guided Agency Scorecard

Date: 2026-07-13

Issue: [#21](https://github.com/the-prairie/goDiesel/issues/21)

Canonical route: Kyoto, Japan (`17654151284`)

Local URL: `http://127.0.0.1:8787/#/lab/playable-earth/17654151284`

## Gate Status

The objective dogfood pass is complete.

The gate decision remains pending until the owner records whether guided control is materially more delightful than passive replay and whether it invites a voluntary second play.

No surface-grounding work may begin while those fields are pending.

## Method

The route ran continuously for three minutes in automatic replay and three minutes in guided mode against live Google Photorealistic 3D Tiles.

The browser viewport was 1440 by 1000 in Chrome.

Each mode was sampled every 30 seconds for route progress, control mode, lateral offset, camera yaw, canvas count, and approximate requestAnimationFrame rate.

Guided input alternated sustained left and right steering with left and right camera look.

The replay-to-guided transition was also measured near the route end in a separate pass.

The displayed frame rate is a browser requestAnimationFrame estimate, not a GPU frame-time trace.

## Objective Results

| Dimension | Result | Evidence |
| --- | --- | --- |
| Camera continuity | Pass | Progress advanced continuously and the Cesium canvas never remounted. No camera discontinuity was observed when switching modes. |
| Camera comfort | Owner review required | Motion was bounded and stable, but comfort is subjective and cannot be established by browser automation. |
| Visible grounding | Weak | The route thread becomes legible over settled imagery, but the current marker remains a floating map marker rather than a visibly grounded actor. |
| Tile stability | Mixed | Settled imagery remained usable, but the lab declared `ready` while the canvas was still a flat green surface. Guided camera movement caused 202 aborted tile requests as Cesium replaced superseded requests. |
| Approximate frame rate | Pass | Automatic replay sampled from 118.0 to 121.4 FPS. Guided mode sampled from 119.6 to 120.5 FPS on a 120 Hz display. |
| Mode-switch continuity | Pass | Switching at 20.14 km preserved the same route progress with a measured delta of 0 m. |
| Route-thread legibility | Pass after tile settle | The bright route thread remained readable over dense Kyoto imagery and stayed associated with the current marker. |
| Control clarity | Mixed | Play, progress, speed, and mode controls are clear. Steering and look controls are icon-only, and sustained keyboard input reaches the hard limits quickly. |

## Captured Evidence

The first ready frame shows the false-ready loading condition.

![Automatic replay start showing unsettled tiles](assets/issue-21/automatic-start.png)

The guided start frame shows the same loading-state problem after the mode switch.

![Guided mode start showing unsettled tiles](assets/issue-21/guided-start.png)

The final guided frame shows the settled world, route thread, current marker, and controls after the full traversal.

![Guided mode after a full route traversal](assets/issue-21/guided-end.png)

## Paper Cuts

- The `ready` state fires before photorealistic tiles are visually ready.
- Sustained steer and look inputs reach the corridor and yaw limits in about seven seconds, which makes keyboard control feel binary.
- The current marker does not make contact with the terrain in a visually convincing way.
- Cesium aborts many obsolete tile requests while the guided camera changes direction.
- A single non-functional 404 appears in the console, likely for a missing browser asset.

These are repairable implementation issues.

They do not by themselves disprove the guided-agency hypothesis.

## Core Hypothesis Questions

Owner response required:

1. Does taking control feel materially more delightful than watching passive replay?
2. After finishing the test, do you voluntarily want to play this route or another route again?

## Allowed Decision

Select exactly one after the owner review:

- Stop and discard.
- Retain as an isolated lab.
- Continue to opportunistic surface grounding.

Current decision: **Pending owner review.**
