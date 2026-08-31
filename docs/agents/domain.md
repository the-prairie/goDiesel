# Domain Docs

goDiesel uses a single-context domain documentation layout.

## Reading order

1. Read root `CONTEXT.md` for vocabulary and invariants.
2. Read `docs/architecture/README.md` for document authority and the system map.
3. Read relevant accepted ADRs before changing their area.
4. Read a focused workflow only when performing that workflow.
5. Inspect executable state before making a current-state claim.

This repository contains all of those locations.
Their absence should be treated as a repository defect rather than silently ignored.

## Knowledge placement

| Knowledge | Authority |
| --- | --- |
| Domain noun, state, or invariant | `CONTEXT.md` |
| Product purpose and direction | `PRODUCT.md` and `STRATEGY.md` |
| Visual and interaction rule | `app/DESIGN.md` |
| Durable architecture choice | Accepted ADR |
| Current system mechanics | `docs/architecture/` |
| Focused procedure | `docs/agents/` |
| Future sequence and acceptance | Current plan under `docs/plans/` |
| Executable contract | Code, schema, and tests |
| One run's observation | Command result or evidence artifact |
| Current counts, health, or external status | Read-only inspection output |

## Vocabulary

Use terms as defined in `CONTEXT.md`.

Do not replace established terms with new synonyms.

When required language is missing, record it as a domain-modeling gap.

Do not add dynamic counts, branch names, credential state, provider health, or deployment state to `CONTEXT.md`.
Those facts must be queried because prose cannot keep them current.

## Architecture Decisions

Surface any conflict with an existing ADR explicitly.

Do not silently override an accepted architecture decision.

Add a proposed ADR for a new durable decision.
Mark it accepted only when the owner has accepted the decision and its implementation status is represented honestly.

## Accretion rule

Promote a fact only when its recurrence and authority justify a durable home.

- A semantic ambiguity becomes a domain-modeling gap.
- A durable choice becomes an ADR.
- A repeated failure becomes an executable test and a narrower workflow correction.
- Missing future capability becomes plan work.
- A one-off observation remains in its result or evidence artifact.

Do not paste run narratives into multiple documents.
Update the narrowest authoritative artifact and link to it from indexes.
