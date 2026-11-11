# ORS planner and evidence-led launch

## Definition of done

The production owner can generate a Run or Ride course with measured preferences, inspect why it was selected, save it, reopen it, preview it, and export GPX. Legacy GPX and BRouter courses still open. Partial provider results and missing geographic evidence remain visible. Credentials never enter the client. A fresh reviewer dogfoods production with task descriptions rather than click instructions. The launch brief and video contain only verified behavior, with real product recordings.

## Checklist

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame. Ground the existing course model, provider results, deployment configuration, and test policy.
- [x] Phase B: Design the workflow. Compare seeded loops and POI-guided routing, then choose the bounded version.
- [ ] Phase C: Run the loop. Implement and verify each unit below.
- [x] Build pure evidence and ranking functions with failure/unknown-data tests.
- [x] Add authenticated ORS generation and bounded geographic evidence retrieval.
- [x] Integrate persistent assessment, shared UI, API/CLI contracts, and cancellation.
- [ ] Verify matched live requests and desktop/mobile app flows on a private preview.
- [ ] Complete independent pre-release review and applicable ticket/release gates.
- [ ] Merge the verified PR and deploy production with private storage and credentials.
- [ ] Give a fresh agent production tasks, fix observed defects, and record the final verified experience.
- [ ] Produce a concise keynote-style launch video and working-backwards PR/FAQ brief tied to evidence.
- [ ] Phase D: Keep the audit trail. Append decisions and links as work progresses.
- [ ] Phase E: Verify and hand back. Confirm production behavior, media playback, and every launch claim.

## Scope and rigor

This extends the pending course workspace in PR165. Approximately four new provider/domain modules and existing course contracts, UI, adapters, and tests are involved. No new paid service is authorized or needed for the initial design. Production cutover uses the repository release gate. Routing changes also need actual provider requests. Desktop and mobile browser emulation run headlessly. Physical phone and watch verification remain separate evidence gaps.

Throughput checkpoint: implement the server/UI directly with one isolated pure-scoring worker, then one fresh pre-release reviewer and a different fresh production reviewer. Maximum two concurrent subagents. Reuse valid unrelated gates unless code changes invalidate them. Evidence and full recordings stay in ignored artifacts; the workflow and decisions are reviewable in Git.

## Architecture choice

Two ORS seeded loops share the same start, target, and activity. Validate connected geometry and the distance band before preference scoring. Deduplicate reversed/identical loops. Evidence contains value, evaluated distance, unknown distance, method, and source. Ranking cannot reward missing evidence. Prefer the 10% distance band; only use the existing 10–30% warning band when no closer candidate exists.

The alternative routes through selected park/water waypoints. It offers stronger direction but needs verified accessible anchors and more distance-correction requests. Defer it until the smaller measured selector is tested.

## Launch experiment

Draft the customer promise before implementation. Preserve failed dogfood attempts and distinguish them from the final recording. Give the production reviewer goals, not implementation hints. Pair each marketing claim with its evidence. Use a customer-first, spare keynote presentation style with real product footage, not a fabricated testimonial or impersonation. A follow-up improvement would compare the launch promise against actual recurring usage rather than treating deployment as the end of learning.
