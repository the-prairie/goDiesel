# Use Google Vertex for an App Walk

The `vertex` provider uses Gemini through Vertex's global **express-mode API-key
endpoint**. It is an alternative to the OpenAI adapter, not an OpenAI-key alias.
Use a key authorized for this Vertex endpoint and a Gemini model available to
that key. An AI Studio or Google Maps key is not assumed interchangeable. This
adapter does not silently switch to AI Studio or a project-scoped OAuth endpoint.

## Local Chrome: the simplest start

In a checkout containing this feature, install the application dependencies:

```sh
npm ci --prefix app
```

Run this from the repository root, using an image-capable Gemini model available
in your Vertex console (the model below is an example, not a live access claim):

```sh
python3 scripts/walk_vertex.py --model gemini-3.5-flash
```

On Windows, use `python` in place of `python3`. The launcher finds installed Google
Chrome, starts a fresh headed session, and asks for the API key using hidden
terminal input. It does not save the key or put it in the command line. Run it
from an interactive terminal, not an editor's noninteractive output panel.
Screenshots and interface text are sent to Google; model calls consume the key's
quota/billing. The launcher prints this before requesting the key. Reports remain
under `.godiesel/walks/`. No owner browser profile is reused and nothing is deployed.

The default mission is memory: choose a route, read its story, watch Replay, and
return. For the planning journey:

```sh
python3 scripts/walk_vertex.py --model gemini-3.5-flash --mission planning
```

`--chrome /path/to/chrome` selects an explicit installed executable when automatic
discovery cannot find it. Finding Chrome is not proof that hardware acceleration
or imagery works; the walk still observes the renderer and actual provider behavior.
Missing credentials, a refused request, or an incomplete journey remains blocked.

## Existing operator entry point

For an operator that already loads secrets securely, configure these variables
in that process (never commit their values):

- `GODIESEL_WALK_PROVIDER=vertex`
- `GOOGLE_API_KEY`: the private Vertex express-mode key
- `GODIESEL_WALK_MODEL`: the explicitly selected Gemini model ID
- `GODIESEL_WALK_ALLOW_REMOTE_AGENT=1`
- `GODIESEL_WALK_BROWSER_PATH`: the installed Chrome executable, for the local live run

Then use the established interface:

```sh
./scripts/godiesel verify app-walk --profile live --target https://godiesel.pages.dev/ --mission memory --driver agent --headed --time-budget 600 --request-budget 6000 --json
```

The default provider remains `openai` for backward compatibility. Vertex selection
is explicit; the presence of a Google key alone never changes the service used.
The one-off acceptance workflow previously pinned to OpenAI is not changed by
this local setup and does not inherit a key entered on your computer.

## Provider contract and evidence

Requests use `POST https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent`,
`x-goog-api-key`, an inline PNG plus bounded interface text, and a JSON response
schema. The same local action validator rejects extra fields and unsafe actions
regardless of provider. There are no model tools or provider fallbacks.

Vertex responses must complete with `STOP`, contain one JSON decision, and report
consistent token usage. Thinking tokens count toward the existing cumulative
150,000-token limit; they are not parsed or saved as decisions. Vertex has a
4,096-token generation limit per call, including thinking, and the existing
30-call limit. A response that hits a limit does not become a successful action.
Raw provider error bodies and credential-bearing headers are not saved.

Reports label this adapter `vertex-gemini`, record the configured model and actual
call/token counts, and retain independent mission checks. Mocked responses and
unit tests prove adapter behavior only. They are never live-model or imagery proof.
Local screenshots remain private files; Google's handling of submitted inputs is
subject to the applicable account/service policies, not a zero-retention promise.

API references (checked September 5, 2026):
- https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys
- https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/vertex-ai-express-mode-api-reference
- https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
- https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse
