---
status: accepted
date: 2026-07-14
deciders: owner
---

# ADR-0008: Playable Earth remains an isolated lab

## Context

Playable Earth added interactive agency to replay: a steerable corridor around
the recorded route, free look, and a guided mode, on top of photorealistic
imagery. It was dogfooded twice against live tiles — a guided-agency session on a
Kyoto route, and a disposition review contrasting urban Japan against mountain
Banff and Kananaskis.

The results were mixed and honestly recorded. Grounding was rated **Weak**:

> the current marker remains a floating map marker rather than a visibly
> grounded actor

Tile stability was **Mixed**. The report also declined to overclaim its own
instrumentation: "The displayed frame rate is a browser `requestAnimationFrame`
estimate, not a GPU frame-time trace."

## Decision

> Retain Playable Earth as an isolated lab.

It does not replace normal Replay and does not enter production scope, because
the experience

> still depends too heavily on provider mesh quality, level-of-detail behavior,
> and experimental control semantics to support a production commitment.

Keep it reachable at `#/lab/playable-earth/<slug>` as the immersive reference for
production Replay.

## Consequences

- A **lab** is now an established concept: a real, reachable, tested surface that
  carries no production commitment. `#/lab/*` is where an idea can be judged
  before it is promoted.
- The genuinely valuable part was extracted rather than discarded: the grounding
  algorithm from the Playable Earth controller is reused by the production Cesium
  replay engine. Recorded elevation stays the truth, and sampled mesh height
  supplies only a bounded, outlier-rejecting corrective offset.
- The lab loads Cesium 1.120 from a CDN while the application bundles Cesium
  1.143, and it types the global as `Record<string, any>`. Two Cesium versions
  coexist and the lab has no type safety. This is accepted for a lab and would
  block promotion.
- This is the clearest precedent in the repository for declining to ship
  something that demos well. It should be cited when a lab is proposed for
  promotion.

## Evidence

- `docs/dogfood-reports/2026-07-13-playable-earth-guided-agency.md` (issue #21)
- `docs/dogfood-reports/2026-07-14-playable-earth-disposition.md` (issue #23)
- `app/src/replay/playable-earth-controller.ts`
  (`advancePlayableEarthGrounding`), `app/src/replay/playable-earth-viewer.ts`
