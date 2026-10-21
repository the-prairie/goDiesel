# Route Studio API and agent CLI

Route Studio creates planned courses for running, walking, and cycling. Courses can come from GPX files or connected BRouter loops. They are separate from completed Strava activities. Generated courses do not contain recorded elapsed time or pace.

The local preview is `http://127.0.0.1:8824`. The implementation has not been deployed. The examples below require the local Vite server to be running.

## Viewing a saved course

Open a course from **Your courses**, then choose **Open 3D preview** above the
map. The URL is `/#/courses/{id}/preview`. Play, pause, seek by distance, change
preview speed, or switch between Follow and Overview. Dragging the map releases
the follow camera; the Follow action restores it. Back returns to the saved course
and its GPX download.

This is a planned-route visualization. It does not synthesize recorded pace,
elapsed time, or completed-activity history. GPX sections preview separately so
gaps are not connected. Missing elevations stay missing; these sections use a
high overview. The 3D view requires the configured Google browser key and provider
availability. A visible retry state preserves access to the saved course when
the provider cannot load.

## Agent commands

The CLI runs from `app/` with Node.js. It prints JSON to stdout and errors as JSON to stderr. Failures return a nonzero exit code. Any agent that can run commands can use it. Agents with HTTP tools can use the API directly. This implementation does not register a hosted MCP server or install a bot integration.

`generate` reads a structured request from stdin. The place name is descriptive. The start coordinates determine where the loop begins.

```sh
node scripts/course-agent.mjs generate --save --base-url http://127.0.0.1:8824 <<'JSON'
{
	"start": { "lat": 37.7694, "lng": -122.423, "name": "Duboce Park, San Francisco" },
	"distance": 5,
	"unit": "km",
	"activity": "Run",
	"vibes": ["quiet", "green"],
	"seed": 270
}
JSON
```

`--save` persists the returned course. Without that flag, generation and import return a preview without writing to the collection. A saved result includes the course ID and its `/#/courses/{id}` URL.

```sh
node scripts/course-agent.mjs import route.gpx --activity Ride --save --base-url http://127.0.0.1:8824
node scripts/course-agent.mjs list --base-url http://127.0.0.1:8824
node scripts/course-agent.mjs get course-UUID --base-url http://127.0.0.1:8824
node scripts/course-agent.mjs export course-UUID --output route.gpx --base-url http://127.0.0.1:8824
```

`course-UUID` stands for an ID returned by generation or import. `export` writes GPX to stdout when `--output` is absent. It refuses to overwrite an existing output file.

`GODIESEL_BASE_URL` supplies the default server URL. `GODIESEL_COURSE_TOKEN` supplies the owner bearer token. The CLI refuses to send that token over remote HTTP. Localhost HTTP is allowed.

The existing `GET /api/discovery?place=San%20Francisco` endpoint returns `{places:[{name,lat,lng}]}` for place lookup. Agents must select the intended place before requesting generation. The API does not infer coordinates from a name or silently choose between ambiguous matches.

## HTTP contract

All course operations use `/api/courses`. JSON responses use `Cache-Control: no-store`. Requests from another origin are rejected. The API does not enable wildcard CORS.

| Request                                                                                                           | Result                                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /api/courses`                                                                                                | `{ "courses": Course[] }`                         |
| `GET /api/courses?id=course-UUID`                                                                                 | `{ "course": Course }`                            |
| `GET /api/courses?id=course-UUID&format=gpx`                                                                      | GPX attachment                                    |
| `POST { "action": "generate", "request": CourseRequest }`                                                         | Unsaved `{ "course": Course, "receipt": string }` |
| `POST { "action": "import", "gpx": "...", "filename": "route.gpx", "activity": "Run", "name": "Optional title" }` | Unsaved `{ "course": Course }`                    |
| `POST { "action": "save", "course": Course, "receipt": "Required for generated courses" }`                        | Persisted `{ "course": Course }`                  |

POST requires `Content-Type: application/json`. Errors have the shape `{ "error": "Readable explanation" }`. New saves return 201. Repeated saves return the existing course with 200.

Generated courses require the signed receipt returned by generation. The receipt covers the validated course content. Modified geometry, titles, or provenance invalidate it. The CLI forwards the receipt with `--save`. Local development uses an ephemeral signing key, so restarting the server expires unsaved generated previews. Persisted courses remain available after a restart. GPX imports do not claim provider-generated provenance and do not require a receipt.

The server derives IDs from validated course content. The submitted ID and creation timestamp do not affect identity. A repeated import or save of the same content does not create a duplicate. Changing the activity, title, description, or geometry creates a different course.

`CourseRequest` contains the following fields.

| Field      | Accepted value                                         |
| ---------- | ------------------------------------------------------ |
| `start`    | `{lat,lng,name}` with valid WGS84 coordinates          |
| `distance` | A number equivalent to 1–200 km                        |
| `unit`     | `km` or `mi`                                           |
| `activity` | `Run`, `Walk`, or `Ride`                               |
| `vibes`    | An array drawn from `quiet`, `green`, `water`, `paved` |
| `seed`     | A whole number from 0 to 2147483647                    |

`Course` contains `id`, `name`, `description`, `activity`, `createdAt`, `source`, `segments`, `distanceM`, `ascentM`, and `warnings`. Its definition and parser live in `app/src/domain/courses.ts`.

`segments` preserves separate GPX tracks and route segments. Each point contains `lat`, `lng`, and optional `elevationM` and `time`. Missing elevations produce a null ascent value. The server recomputes distance and ascent from geometry. It does not accept client metric claims as authoritative.

The request limit is 5 MiB. Courses can contain at most 50,000 points. GPX declarations with external entities or document types are rejected. Invalid coordinates, malformed timestamps, and unsupported XML structures fail visibly.

## Routing behavior

The routing service must support BRouter's GeoJSON output and round-trip engine mode. Running and walking use `hiking-mountain` with SAC difficulty limited to T1. Cycling uses `trekking`, or `fastbike` when paved surfaces are requested. Ferries and straight-line connector fallback are disabled.

The service generates connected loops from mapped ways. It does not generate arbitrary geometry between imagined landmarks. Geometry is rejected if the loop does not close within 80 m, the start snaps more than 500 m away, or a consecutive point gap exceeds 1 km.

The initial BRouter round-trip radius is the target distance divided by 5.2. The API adjusts the radius against achieved route length for at most three sequential requests. It accepts a result within 10% of the target without a mismatch warning. Results 10–30% away include the achieved-distance warning. Results more than 30% away are rejected. The API deadline is 65 seconds, with a 22-second limit for each provider request.

The preferences map to these profile parameters.

| Preference                | Profile parameter   | Meaning                                                             |
| ------------------------- | ------------------- | ------------------------------------------------------------------- |
| Quiet                     | `consider_noise=1`  | Prefer mapped low-noise characteristics                             |
| Green                     | `consider_forest=1` | Prefer mapped forest or park characteristics                        |
| Water                     | `consider_river=1`  | Prefer mapped river or lake proximity                               |
| Paved, cycling            | `fastbike` profile  | Use its existing penalties for unpaved roads and paths              |
| Paved, running or walking | Unsupported         | The returned course explicitly warns that paving cannot be enforced |

These parameters affect route costs. They do not prove that a route is quiet, safe, paved throughout, or accessible under current conditions. A route can include repeated ways. A different seed changes the initial bearing, but map constraints can still produce the same loop.

The provider can return estimated travel time. Route Studio discards that value. Elevations returned by the provider are retained as route geometry, not recorded athlete telemetry.

The implementation follows the primary BRouter sources.

- [Server request handler and profile parameter protocol](https://github.com/abrensch/brouter/blob/master/brouter-server/src/main/java/btools/server/request/ServerHandler.java).
- [Round-trip engine and radius semantics](https://github.com/abrensch/brouter/blob/master/docs/developers/android_service.md#round-trip).
- [Hiking profile parameters](https://github.com/abrensch/brouter/blob/master/misc/profiles2/hiking-mountain.brf).
- [Cycling profile parameters](https://github.com/abrensch/brouter/blob/master/misc/profiles2/trekking.brf).
- [Deployed hiking profile](https://brouter.de/brouter/profiles2/hiking-mountain.brf), which contains the noise, forest, and river parameters.
- [Deployed cycling profile](https://brouter.de/brouter/profiles2/trekking.brf). This version lacks the newer `unpavedPenalty` parameter.
- [Deployed paved cycling profile](https://brouter.de/brouter/profiles2/fastbike.brf), including the unpaved road and path penalties.

## Storage and deployment configuration

The Vite adapter persists local courses outside the served workspace in `~/.local/share/godiesel/workspaces/{workspace-hash}/courses/`. The hash derives from the resolved app directory. Writes use a temporary file and atomic rename. Restarting the server preserves saved courses. Explicit storage directories inside the Vite root are rejected. The middleware blocks direct filesystem URLs to course storage and the legacy `/.local/courses/` path.

Unauthenticated local access requires both a loopback socket and a `localhost`, `127.0.0.1`, or `::1` host. Network access requires an owner token. When a token is configured, local callers also need it. An owner token grants access to the whole course collection. This is a single-owner API, not a multi-user account system.

The Cloudflare Pages adapter requires a `COURSE_STORE` KV binding and a `GODIESEL_COURSE_TOKEN` secret. It fails closed when either is missing. Generation also requires `GODIESEL_ROUTER_URL` pointing to an explicitly configured BRouter-compatible service and a server-only `GODIESEL_COURSE_SIGNING_KEY` of at least 32 bytes. The signing key must differ from the owner token and must not be given to agent clients. There is no production fallback to the public demo server.

KV is eventually consistent across locations. A new save can take time to appear in another location. The local filesystem adapter does not have that delay. Production persistence, routing capacity, and deployment remain unverified until the binding and dedicated routing service are configured and exercised.

The local default `https://brouter.de/brouter` is for bounded development evaluation. It is not a production availability commitment. Coordinates and routing preferences are sent to the configured service.

## Suunto Race S handoff

GPX exports contain route geometry and optional elevations. Download the GPX, import it into the Suunto app, save the route, and sync it to the watch. [Suunto documents the iOS GPX import flow](https://us.suunto.com/pages/how-do-i-import-a-gpx-file-in-suunto-app-for-ios).

This release does not claim direct watch transfer. [Suunto's Route API](https://apizone.suunto.com/route-description) requires partner access before a direct integration can be implemented. A physical iPhone 13 and Suunto Race S import and sync test has not been completed.

## Verification evidence

`npx vitest run src/domain/course-api.test.ts` checks authorization, origin rejection, preview-before-save behavior, repeated saves, GPX export, provider failure, distance bounds, signed provenance, cancellation, filesystem persistence, Vite storage isolation, and KV pagination.

The local public-provider trial generated a 5.094 km running loop for a 5 km request and a 9.396 km cycling loop for a 10 km request. A further cycling request with the paved preference returned 10.903 km using `fastbike`. All were saved, reopened, and exported using `scripts/course-agent.mjs`. The running export was imported again through the same CLI. Raw responses and exports are in the ignored `app/artifacts/route-studio/` directory.

The six scenarios in `GODIESEL_COURSE_PREVIEW_URL=http://127.0.0.1:8824 GODIESEL_LIVE_COURSES=1 npm run test:e2e:courses` passed with actual headless browser interactions. They covered desktop and mobile-viewport GPX upload, save, reopen, download, drag-and-drop, invalid XML, collection-route export, and live generation. The live browser requests returned a 5.427 km run for 5 km and a 13.113 km ride for 12 km. A further touch-enabled 390 × 844 Chromium check confirmed that the collection GPX action preserves the mobile route summary.

An independent review reran the initial 74 focused domain, API, and reducer tests. It also rejected modified generation receipts and owner-token-forged signatures, checked nine filesystem URL aliases, and exercised cancellation and failed navigation at 1440 px and 390 px. No blocking findings remained.

A subsequent local Workers runtime check caught random signing-key generation in module scope, which Cloudflare forbids. Initialization now happens inside a request handler. A regression test covers that constraint. The final focused suite contains 79 passing tests, including four starting-place selection and stale-response cases. Local workerd with local KV rejected an unauthenticated request with 401, then imported, saved, reopened, and exported a course with the owner token. This verifies the local hosting adapter; remote KV and production routing remain untested.

The broad `npm run verify` run passed typechecking, the production build, the bundle budget, 790 unit tests, and 407 browser scenarios; 68 browser scenarios were skipped by their existing environment gates. Its one failure was the Routes screenshot baseline after adding the creation action. Both desktop and mobile compositions were inspected, their baselines updated, and the focused screenshot comparison rerun successfully. The subsequent runtime fix passed the final 79-test focused suite, typechecking, another production build, and another real generation/save/reopen browser flow. Successful unrelated checks were not repeated.

These trials establish that the local request path works for the tested starts and activities. They do not establish route quality in every location or production service reliability. Mobile evidence is browser emulation, not a physical iPhone or watch test. Local screenshots and raw exports are in `app/artifacts/route-studio/`.

### Shared controls and 3D preview

The follow-up replaces native selects in Finder, Routes, and Admin with the
shared `SelectField`. Route Studio uses radio-based `SegmentedControl` for short
choices and `Disclosure` for optional instructions. Saved-course pages expose
their preview and GPX actions above the map, without the creation form beneath.

Headless desktop and mobile-emulation checks exercised the Calgary saved-course
link against the real Google renderer on port 8824. Playback, seeking to 5 km,
camera selection, and return navigation worked with one map, three route
polylines, and no page errors. Screenshots and the live result are in
`app/artifacts/course-preview/`. Course UI comparisons are in
`app/artifacts/course-ui/`.

Independent review found two defects before acceptance: direct longitude
interpolation crossed the globe for a short antimeridian segment, and camera
controls snapped instead of transitioning. Both are fixed. The reviewer repeated
the failing interactions and confirmed short longitude interpolation, paused
camera settling, Follow handoff from the explored pose, and immediate changes
under reduced motion. The camera regression cases use the renderer test seam;
the Calgary check uses the live provider.

The focused preview checks passed 81 unit tests and six browser scenarios.
Shared-control consumer checks passed 53 distinct scenarios across focused runs.
Course-form keyboard navigation, cancellation, and disabled states passed at
1440 px and 390 px. Physical-phone rendering and Suunto sync remain unverified.

Final `npm run verify` passed typechecking, the production build, the 293.6 KiB
initial-shell bundle budget, 807 unit tests, and 418 browser scenarios. Five unit
tests and 68 browser scenarios were skipped by their existing environment gates.
No snapshot updates were needed for this refinement. The independent review found
no remaining must-fix issues after the two repairs.

### Compact course-preview controls

The course preview now shares the replay dock styling, transport controls, and
settings components. Its elevation scrubber uses the course's supplied samples;
missing elevations remain gaps, and courses without elevation retain a labeled
distance slider. Camera options, section selection, and explanatory copy live in
a content-sized settings sheet. No camera or playback lifecycle behavior changed.

Matched Calgary screenshots measured the dock at 133 px high, down from 228 px,
at both 1440×900 and 390×844. The desktop width decreased from 768 to 640 px.
All transport targets remain at least 44×44 px. Background interactions exercised
play/pause, speed, seeking to 6.04 km, camera selection, manual-camera Follow,
and return navigation with the actual Google map and no page errors.

Focused verification passed typechecking, 13 unit tests, and eight browser
scenarios, including 320×568 portrait and 844×390 landscape, keyboard seeking,
round profile markers, missing elevation, and section switching. Independent
review also checked sparse profiles, sheet sizing, Escape dismissal, and focus
restoration. Evidence and rerunnable capture scripts are in the ignored
`app/artifacts/course-dock/` directory. Mobile testing used browser emulation;
physical-device evidence remains incomplete. The earlier full gate above applies
to commit `4fdc1d2`; this HUD refinement was verified with focused checks.

### Your marker

Replay settings and course-preview settings share a photo editor. Choose a JPG,
PNG, or WebP image, drag or adjust the crop with labeled sliders, then choose
Use photo. The Google 3D marker displays the saved circular portrait across
routes and course previews. Dot keeps the saved photo available; Remove photo
clears it. Editing remains available while the map loads.

The original image stays in memory during editing. Saving stores only a cropped
256×256 JPEG in browser local storage. This is a browser preference, without
account sync or a server upload. Input limits are 10 MB and 24 megapixels.
Canceling or closing settings discards the draft. Failed storage writes preserve
the crop for retry and leave the active marker unchanged. An unreadable stored
portrait falls back to the dot. Legacy Atlas and Cesium replay markers retain
their existing appearance.

Focused verification passed typechecking, 40 unit tests, and the five marker
browser scenarios. The latter cover desktop and mobile layouts, crop changes,
cancel, removal, reload, route switching, invalid images, storage failure,
focus restoration, and editing during map loading. Existing course-preview and
replay interactions were also checked. Actual background Google-map interactions
covered the saved Calgary course, San Francisco, and Bali at 1440×900 and
390×844, with no page errors. Screenshots use an illustrated test portrait.

Independent review checked crop/export pixel agreement and found the map-loading
restriction, which was repaired and covered by a regression test. Evidence and
the rerunnable live check are in the ignored `app/artifacts/your-marker/`
directory. Mobile evidence is emulation; no physical phone test was performed.
This feature and the corrected replay design remain unmerged and undeployed.
