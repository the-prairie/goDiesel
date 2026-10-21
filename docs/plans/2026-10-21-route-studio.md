# Route studio implementation

## Completion criteria

A person can generate a running, walking, or cycling loop near a chosen place, inspect the actual distance and mapped path, save it, reopen it, and download GPX. A person can upload or drop GPX and use the same preview and save flow. An agent can perform these operations through HTTP or a checked-in CLI. Existing collection routes also offer GPX export. Suunto Race S handoff uses the Suunto app rather than claiming direct watch integration.

Browser verification stays headless. No merge or deployment is part of this task.

## Work sequence

- [x] Read the poteto principles and inspect existing ownership.
- [x] Phase A. Frame the result and its evidence.
- [x] Phase B. Design the workflow and isolate the worktree.
- [x] Phase C. Implement and verify the course domain, provider, HTTP boundary, UI, and agent client.
- [x] Phase D. Record decisions and independent review.
- [x] Phase E. Validate the complete flow and report limitations.

The critical path is a real routing response. Domain parsing and the UI can proceed independently. Two bounded delegates own the domain and backend. The parent owns integration and browser verification. Each boundary gets focused behavior tests before the complete flow runs. The existing preview on port 8823 remains untouched.

## Ownership and alternatives

The existing catalog is static build output. Its `planned` lifecycle has no recorded geometry and is never replay eligible. Extending that object with generated traces would erase that distinction. Browser-only storage also cannot accept uploads from an independent agent.

The chosen design introduces a course workspace with one validated Course contract. A course has segmented geometry, an activity, provenance, and derived distance. It is not a completed activity. HTTP and the UI share this contract. Local development stores courses as files. Production requires an explicitly configured owner token and durable store. Production writes fail closed until configured.

A second candidate extended the static Python import pipeline and rebuilt the site for every upload. That preserves catalog ownership but cannot provide interactive route generation or safe private agent uploads. It was rejected for this workflow. The existing canonical catalog remains build-owned.

## Evidence required

- Unit tests cover validation, GPX round-trip, segment gaps, missing elevation, XML rejection, reducer cancellation, and stale results.
- HTTP tests cover authentication, body limits, persistence, and provider failures.
- Live generation produces real running and cycling courses near San Francisco. Fixtures alone do not prove provider availability.
- Headless desktop and mobile-emulation clicks cover generation, upload, save, reopen, and GPX download.
- Independent review checks the diff and behavior before a PR is handed back.
- Physical Suunto import and watch sync remain unverified until exercised on the user's phone and watch.

## Scope limits

This first version implements structured preferences, not unsupported claims about scenery or safety. It does not fabricate roads, timestamps, pace, or GPS activity history. The agent supplies a structured request after interpreting the person's natural language. Direct Suunto partner APIs and autonomous public sign-up are outside this change.
