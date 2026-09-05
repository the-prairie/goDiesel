# Exploring, rather than replaying a script

App Walk has two intentionally different drivers. The guided driver repeats known
landmarks and verifies them. The agent driver gets only a mission, the current
accessibility snapshot, the current screenshot, and a bounded action history.
It does not receive repository code, selectors from tests, or an expected route.

## An explicitly configured remote walker

The optional adapter uses the OpenAI Responses API with image input and a strict
structured action schema. It sends private route screenshots and UI text to that
service only after an explicit opt-in. `store: false` disables Response storage;
it is **not** a promise about every provider retention policy.

Configure `OPENAI_API_KEY`, `GODIESEL_WALK_MODEL` (an image-capable model supporting
structured outputs), and `GODIESEL_WALK_ALLOW_REMOTE_AGENT=1` in the authorized
operator environment. Do not commit these settings or pass secrets on the command
line. There is no assumed model name, bundled key, silent fallback, or retry loop.

```sh
./scripts/godiesel verify app-walk --profile live --target https://godiesel.pages.dev/ --mission explore --driver agent --headed --json
```

`memory` and `planning` can also use the agent driver. Their completion is judged
from independently observed milestones, not a model's claim of success. The
open-ended `explore` mission requires multiple surfaces and a minimum observed
interaction history, but deliberately does not claim that these counts establish
quality. Its notes remain hypotheses requiring a separate review.

Actions use a closed schema: visible control clicks, bounded field changes outside
Admin, limited keyboard keys, scrolling, short waits, a reload, a note, or finish.
There is no arbitrary JavaScript, shell, selector, destination URL, publication,
curation edit or hidden Enter-to-submit action. Each response is tied to the most
recent observation; the chosen control is revalidated before interaction. Motion
may change a page during deliberation, so changing a clock does not invalidate an
otherwise valid response. A stale observation id does.

The walk is bounded by the browser action/request/deadline limits, 30 model calls,
a 1,600-token per-response output limit, and an observed 150,000-token cumulative
budget. The call crossing the cumulative threshold is recorded and terminates the
walk; a token budget is not an exact dollar quote. Model outages, refusals,
incomplete output and missing usage produce a blocked result, never a substitute
fixture. The provider adapter has no tool access.

API contracts used: OpenAI's official Responses, Images and Vision, and Structured
Outputs documentation, verified on September 4, 2026. The adapter uses
`POST https://api.openai.com/v1/responses`, `input_image`, `text.format` with
`json_schema`, and extracts `output_text` from completed message output.

## Broader guided missions

```sh
./scripts/godiesel verify app-walk --mission library --seed 2026-09-04 --viewport phone --json
./scripts/godiesel verify app-walk --mission admin-readonly --json
./scripts/godiesel verify app-walk --mission recovery --profile controlled --json
./scripts/godiesel verify app-walk --mission share --profile live --target https://share-appian-way.godiesel.pages.dev/ --json
```

`library` samples a currently rendered route, including a rotating discovered
collection when that control exists, then tests refresh and browser Back. It
records the actual choice; it does not claim to cover every catalog row.

`admin-readonly` inspects disabled curation and the absence of save actions. It
never starts or touches the real owner writer. Real isolated writer/regeneration
proof remains with `test_admin_curation.py`, `test_curation_publish.py`, and the
existing curation browser/live-pipeline gates. It is not implied by this walk.

`recovery` injects one HTTP 503 into the selected route-detail request, captures
the error, and uses Retry against the original server. This experiment is refused
in live mode. Its HTTP fixture test cannot run through the DOM-only adapter.

`share` is a read-only visit to an already-authorized share target. It verifies its
guide/Replay round trip and one observed route-data request. Complete build-time
scoping is still proved by the existing microsite gate, not inferred from network
sampling. No new share is published.

Labs are deliberately not part of production coverage. A human may investigate a
lab with the existing lab-specific tests; it cannot silently improve or worsen the
production App Walk result.

A `returning` session means a reload within a new disposable browser context. It
is not Lauren's browser profile or a claim of multi-day persistence. Phone and
landscape modes are viewports, not physical-device evidence.

## Independent verification

The agent protocol tests attack stale observations, unknown actions, unsafe names,
hidden submits, unbounded waits, and self-awarded success. The browser-loop tests
inject a deterministic decision provider labeled `injected-test-adapter`; they
prove orchestration but are not live model evidence. The optional provider request
and response contracts are tested without sending private content externally.

Screenshots are fingerprinted in the report. The Python adapter rejects changed
images, and fingerprints recurse into nested application source and public data.
