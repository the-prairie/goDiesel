# Route discovery provider investigation — 2026-10-15

## Diagnosis

The production discovery endpoint returned HTTP 503 for a Banff route query. Direct requests to the configured Overpass service returned HTTP 502 with an explicit capacity/queue-full response. Photon place search returned HTTP 200 with real Banff choices. The failures therefore occur after place resolution, during retrieval of mapped route relations.

A tiny single-relation request also failed, so query complexity alone does not explain the observed outage. The alternate Private.coffee service returned HTTP 500 for both the application query and the tiny query. A bounded probe of another documented public instance returned 504. These observations establish failures from this environment and the production app; they do not establish a worldwide outage or a restoration time.

Raw response evidence is in `app/artifacts/discovery-provider-fix/`, including `production-before.txt`, `overpass-before.txt`, `photon-before.txt`, and `private-coffee.txt`.

## Recovery changes

- Keep the existing Overpass provider; try the fixed Private.coffee endpoint once after transient HTTP, transport, or incomplete-query failures.
- The attempts are sequential with a one-second delay, a 26-second timeout each, and the existing 10 MB response limit. No retry loop and no arbitrary user-supplied endpoint.
- Retain successful-result caching. Reject incomplete or malformed responses rather than caching them as no matches.
- Preserve provider HTTP status/failure category in structured server diagnostics, without logging search text or coordinates.
- Return a non-cacheable 503 with a 60-second Retry-After hint and useful retry copy. Distinguish place-search failure from route-search failure.
- Identify the application with its public URL in the upstream User-Agent.

The alternative is a public OpenStreetMap service, not a synthetic or generated-route source. Its service terms and privacy policy are at https://overpass.private.coffee/. The provider receives the query center/activity; no account, recorded routes, or user identity is included. Its policy permits use in projects and asks that requests remain modest. See also the official public-instance operational guidance: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html.

## Verification

- 295 unit tests passed; 5 explicitly gated tests skipped. Nine new provider recovery cases cover overload, transport resets, errored response cleanup, permanent request failures, partial/malformed responses, cache reuse, and genuine empty results.
- Typecheck passed.
- Independent reviewer reproduced two response-stream cleanup cases that could suppress fallback. Both were fixed and covered by tests.
- Actual local browser: searched woodland routes near Banff, selected Banff, Alberta, Canada, and confirmed the retry state retains location, activity, distance, and theme. No fabricated routes or false empty-state result was shown.
- Updated the live discovery test to use observable results and the current mobile List/Map controls, instead of the removed internal ranking-mode label.

Live discovery success is still blocked by the upstream services. Passing deterministic recovery tests must not be reported as restored external route search.

## Release and production check

- Full deterministic release gate passed: 235 browser tests passed, 39 live/special-mode tests skipped. The final unit rerun after the stream-cleanup fixes passed 295 tests, with 5 gated tests skipped. Typecheck, production build and bundle budget passed.
- Deployed to https://3823f9c4.godiesel.pages.dev and the production alias https://godiesel.pages.dev.
- Production API recheck returned the new 503 response with `code: http`, `Retry-After: 60`, in 4.1 seconds. This verifies the new function is deployed but does **not** establish successful external route retrieval.
- Actual production browser: Photon returned Banff choices; selecting Banff, Alberta, Canada reached the new recoverable error. Verified at mobile 390×844 and desktop 1280×900. Saved `production-mobile.png` and `production-desktop.png` under the artifact directory.
- Switched to My collection and searched “beach run around 20 km”: real Los Angeles and Bali candidates appeared, with route-guide links and selected-map context.
- External-route results/map/save verification remains blocked by upstream availability. No provider response was intercepted during the manual live checks. The source-discovery success test remains a live acceptance gate, not an outage test that can falsely pass.
