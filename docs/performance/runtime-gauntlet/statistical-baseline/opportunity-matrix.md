# Runtime opportunity matrix

**Status:** ranked from run `issue113-hermetic-2026-08-27`
**Source issue:** #113

The score is `(impact x confidence) / effort`, using integer inputs from 1 to 5.
These are recommendations for later optimization issues.
This profiling stage changes no production runtime behavior.

| Rank | Measured hotspot | Evidence | Proposed lever and expected movement | Equivalence class | Impact | Confidence | Effort | Score | Regression risk | Golden oracle |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 50,000-point route pose tail | Node p50/p95/p99 were 20.23/89.67/91.11 ms with CV 0.780; CPU leaders were `minimalLongitudeArc` with 1,835 samples and `pointAtDistance` with 1,756 | Pre-index cumulative distance and longitude-arc data, then use bounded lookup; target p95 below 30 ms | Identical pose, bearing, progress, altitude, and dateline behavior for every query | 4 | 5 | 2 | 10.00 | Index invalidation or edge interpolation can change camera paths | Existing pose digest plus dense boundary and property comparisons |
| 2 | Atlas with 2,500 routes | Desktop p50/p99 were 1,292/2,158 ms and mobile 1,802/2,460 ms; peak-heap p99 was 128.0/112.9 MB; long-task-total p99 was 4,339/3,394 ms; React expensive-commit p95 was 59.3/62.7 ms | Precompute or batch immutable coordinate buffers and avoid rebuilding unchanged route render data; target at least 30% lower p95 latency and peak heap | Same 2,500 source-backed traces, route count, heat lines, ordering, viewport, and renderer output | 5 | 5 | 4 | 6.25 | Buffer sharing can corrupt geometry, precision, ordering, or renderer ownership | Corpus digest, canvas pixel oracle, route count, selected-route behavior, and heap/allocation profile |
| 3 | Mobile Atlas cold tail | Mobile p50/p95/p99 were 1,169/1,942/1,999 ms with CV 0.255 versus desktop 1,145/1,226/1,306 ms; mobile p99 long-task total was 2,205 ms | Isolate mobile-only layout, renderer, and fixture-settlement work, then defer or reuse the measured dominant task; target mobile p95 below 1,400 ms | Same viewport, reduced-motion contract, map framing, route visibility, URL state, and ready oracle | 4 | 4 | 3 | 5.33 | Deferred work can expose incomplete Atlas state or change readiness semantics | Mobile Atlas screenshot, ready-state timing marks, URL-state oracle, and long-task distribution |
| 4 | Route detail and Replay startup outside React | Detail and Replay medians were about 924-935 ms while selected React actual duration was only 21.3-25.9 ms; every selected renderer surface retained one active context | Reuse immutable decoded route and renderer bootstrap work; target 20-30% lower p50 without retaining a second WebGL context | Same route geometry, map framing, telemetry, camera, provenance, and one active context | 4 | 4 | 4 | 4.00 | Renderer reuse can leak state across routes or retain GPU memory | Route-detail and Replay screenshots, telemetry oracle, lifecycle heap, and active-context assertions |
| 5 | Region construction at 2,500 routes | Node p50/p95/p99 were 41.18/42.94/43.74 ms with CV 0.020; CPU profile includes `deriveGeographicBounds` and `minimalLongitudeArc` | Cache immutable per-route bounds and incrementally aggregate regions; target p95 below 25 ms | Identical region membership, ordering, counts, and geographic bounds | 2 | 4 | 2 | 4.00 | Stale bounds can misplace routes or break dateline regions | Existing region-order digest plus dateline fixtures |

No standalone lifecycle leak optimization is recommended from this packet.
Lifecycle heap variation remained bounded, every settled boundary retained one connected non-lost context, and the independent-sequence count is too small for a p95 or p99 claim.
