# Architecture

This directory explains how goDiesel works as one system.

Use the documents in this order:

1. Read root `CONTEXT.md` for domain language and system-wide invariants.
2. Read [Agent Operating System](agent-operating-system.md) for the current and target operator model.
3. Read the relevant records under `docs/adr/` for binding architecture decisions.
4. Read `app/DESIGN.md` for the visual and interaction contract.
5. Read a focused workflow under `docs/agents/` only when performing that workflow.

Architecture documents describe the system and its intended shape.
They do not replace executable contracts, live status commands, or run evidence.

## Document authority

| Question | Authority |
| --- | --- |
| What does a domain term mean? | `CONTEXT.md` |
| Why is the system shaped this way? | Accepted ADRs under `docs/adr/` |
| How should an agent operate the system? | This directory and `AGENTS.md` |
| How is one task performed today? | Focused guides under `docs/agents/` and command help |
| What should be built next? | Current plans under `docs/plans/` |
| What happened in one run? | Command result, evidence receipt, and external verification |
| What is the live state now? | A read-only status or inspection command |

When documents disagree, prefer executable state and accepted ADRs, then repair the stale document in the same change.
