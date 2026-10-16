---
status: accepted
date: 2026-10-15
supersedes: none
---

# ADR-0016: Explicit state transitions at lifecycle boundaries

## Context

Finder external discovery coordinated nine local state values across place
resolution, route requests, selection, presentation, and save feedback. Its
`idle` and `ready` labels each represented several different outcomes.

T01 replaces those setters with a pure reducer. Browser characterization tests
were run against the original component before the extraction. The same tests
pass against the reducer implementation. This is the reference for subsequent
state-management work, not a requirement to migrate every local state value.

## Decision

Use pure TypeScript reducers for related state whose transitions enforce a
meaningful invariant. Keep simple UI state local and retain existing pure
playback, geometry, ranking, and validation functions.

### Module template

Keep each model beside its owning surface or data hook under ADR-0014.

| Part | Convention | Finder reference |
| --- | --- | --- |
| Pure model | `<flow>-state.ts` | `discovery-state.ts` |
| State | `<Flow>State` with tagged lifecycle variants | `DiscoveryState` and `DiscoveryRequestState` |
| Events | `<Flow>Event`, named for an interaction or outcome | `searchStarted`, `routesReceived`, `planSaveFailed` |
| Initialization | `initial<Flow>State(inputs)` | `initialDiscoveryState(destination)` |
| Transition | `reduce<Flow>(state, event)` | `reduceDiscovery(state, event)` |
| Selectors | Pure derivation of display and availability | `discoveryMessage(request)` |
| Adapter | Existing component, hook, or engine owns IO | `ExternalDiscovery` |
| Unit tests | Colocated `<flow>-state.test.ts` | `discovery-state.test.ts` |
| Integration tests | User-visible transitions and effect boundaries | `discovery-state.spec.ts` |

### Transition rules

1. Use a discriminated union for mutually exclusive lifecycle states. Put
   required data on the variant that needs it. Loading routes requires a resolved
   place. Results require that place and a route array, which may be empty.
2. Keep independent concerns separate within the model or in local state.
   Destination drafts, request snapshots, selection preferences, list/map mode,
   and save feedback do not share one lifecycle.
3. Reducers perform no IO, mutation, clock reads, random generation, or resource
   cleanup. Events carry the information needed to decide the next state.
4. Use explicit events instead of arbitrary state patches or setter callbacks.
   Exhaustively handle the event union. Intentional no-ops return the current
   state and have tests.
5. Async outcomes carry an operation identity and are accepted only by the
   matching pending stage. The adapter owns abort signals and disposes its
   resources. A request ID is scoped to its component lifetime, not globally.
6. Preserve URL authority and component identity. Do not create another store
   that mirrors router state. Do not silently remove a keyed remount.
7. Derive labels, eligibility, filtered results, dirty state, and validation.
   Keep editable drafts distinct from validated persisted records.
8. Retain high-frequency imperative frame drivers and throttled UI snapshots.
   A state migration is not permission to dispatch every frame through React.
9. Preserve existing failure, retry, timeout, and reset policies. Corrections
   require separately described behavior changes and regression tests.
10. Remove replaced setters and transition branches in the same ticket. Do not
    leave the reducer and old state as competing owners.

XState v5 is an exception when hierarchical states and invoked resource actors
remove substantial adapter coordination. Such a ticket must make the machine
the lifecycle owner. A machine that merely shadows existing status strings is
not sufficient justification for the dependency.

### T01 behavior contract

- Requests are explicit. Known regions bypass geocoding. Place results require
  a choice even when only one place remains. Name deduplication stays at the
  response boundary inside the adapter's existing error handling.
- Destination edits clear place choices but preserve the current prompt,
  pending request, or results. Submission snapshots do not follow draft edits.
- Search returns to list mode and clears previous results and choices.
  Selection resets on route success. Save feedback survives another search.
- No places and no routes are distinct internal outcomes. Their existing UI
  messages, including the generic empty-results message for no places, remain.
- The adapter owns one AbortController and a monotonically increasing request
  ID per mounted component. Replacement aborts the previous request. Cleanup
  aborts on unmount. It checks the signal before dispatching a completion.
- The reducer rejects superseded IDs, wrong-stage results, and completions
  after settlement. Unmount is an adapter boundary, not a synthetic reducer
  state. Browser tests prove cancellation across scope and submitted-intent
  remounts.
- There is no frontend request deadline, automatic retry, or cancel button.
  Retry uses the current destination. The `near` URL parameter changes only
  on submission and retains the existing replace behavior.
- Selection and save feedback remain separate from requests. Saving an external
  plan stays synchronous. Its storage exception produces the existing message.
- Ranking, filters, source geometry, map rendering, and plan persistence keep
  their existing implementations.

### Verification expectations

Before extracting state, pin the current observable behavior with focused
integration tests. Run those tests against the original and replacement code.
Test the pure transition contract with concrete event sequences, including
failure/retry, input edits during pending work, replacement, wrong-stage and late
outcomes, and independent UI actions. Test cancellation and resource ownership
through the adapter rather than adding unused cancellation events to the reducer.

Follow [the testing policy](../agents/testing.md). Run focused tests during
implementation and the ticket gate once before merge, plus affected browser
specs separately. Preserve successful evidence unless a later edit changes the
covered behavior. Provider, terrain, imagery, and camera changes require their
applicable live checks. A local reducer extraction does not require the complete
release or live-pipeline gate.

Each backlog ticket also requires an agent to use the affected product through
actual browser controls. Exercise the main flow, failure or retry paths where
available, navigation and responsive layouts. Inspect rendered screenshots as
well as accessible state. Automated browser tests supplement this review.

Record the tested commit, viewport, interactions, screenshots, fixture boundaries
and any live-provider limitations. An independent reviewer checks meaningful
state or architecture changes and repeats the affected product interactions.
Reproduce discovered bugs before fixing them. Keep behavior corrections in a
separate commit from the state extraction, add a focused regression, and repeat
the affected clicks. A passing test suite alone does not complete a ticket.

## Consequences

Request state can no longer claim both pending work and settled results.
Transition rules are directly testable without React or network access.
The component still exposes the resource and URL effects a maintainer must
inspect. Reducer extraction adds a module and event types, so it is justified
only where it removes coupled decisions or invalid combinations.

New transitions still require tests. New external effects or controls may also
require adapter or presentation changes. This standard does not promise that
every feature can be implemented by adding one state.

## Evidence

- [Pure discovery reducer](../../app/src/surfaces/finder/discovery-state.ts).
- [Transition tests](../../app/src/surfaces/finder/discovery-state.test.ts).
- [Discovery component and effect adapter](../../app/src/surfaces/finder/components/external-discovery.tsx).
- [Browser characterization](../../app/e2e/discovery-state.spec.ts).
- [Persistence and export integration](../../app/e2e/discovery-planning.spec.ts).
- [Finder domain policy](0015-finder-hybrid-search-and-sourced-discovery.md).

### Standalone Python Admin

The unbundled `admin.html` adapter imports pure TypeScript modules from `admin-ui/`
through checked-in generated JavaScript. The Python server serves an explicit
asset allowlist. Its standalone launch needs no Node build step. Application
verification rejects stale generated modules. See the [module workflow](../../admin-ui/README.md).

The reducer conventions above apply unchanged. Browser IO remains in the existing
module script. The first boundary extraction moves only `escapeHtml` to prove the
module delivery path. Mutation and classification state remain separate follow-up
migrations with their own characterization tests.
