# Live reference runtime baseline

## Result

The fixed owner-Mac live-provider workload passed on 2026-08-26.
It observed Atlas, native Google Replay, and Playable Earth for Tokyo, Banff/Kananaskis, and Ucluelet for an aggregate 600,000 ms.
Each of the nine route-surface combinations received a fixed 66,666 ms observation window after its readiness oracle passed.
This is a ten-minute aggregate stability baseline, not a claim that every surface was observed for ten minutes.

The committed machine-readable summary is `live-reference-runtime.json`.
The complete ignored local artifact has SHA-256 `7c1a6fb24e3f9c2c07ae18458888dae006781f9666c2caf0d0f6772b2e061020`.
It contains no API-key value, query string, signed URL, response body, or private source path.

## Command

```sh
GODIESEL_WORLD_LIVE_BASELINE=1 \
  GODIESEL_WORLD_LIVE_BASELINE_MS=600000 \
  GODIESEL_CAPTURE_WORLD_LIVE_BASELINE=1 \
  npx playwright test --config playwright.world-pack-live-baseline.config.ts
```

Result: 1 passed in 10.7 minutes, with the measured test completing in 10.5 minutes.

## Readiness and frame pacing

| World | Surface | Ready ms | p95 frame ms | p99 frame ms | Frames over 33 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| Tokyo | Atlas | 2,215 | 10.3 | 16.7 | 1 |
| Tokyo | Replay | 3,698 | 25.0 | 33.5 | 89 |
| Tokyo | Playable Earth | 2,387 | 17.6 | 25.0 | 17 |
| Banff | Atlas | 2,126 | 10.1 | 10.4 | 0 |
| Banff | Replay | 3,417 | 10.0 | 10.3 | 2 |
| Banff | Playable Earth | 1,651 | 10.2 | 16.7 | 0 |
| Ucluelet | Atlas | 2,203 | 9.8 | 10.3 | 0 |
| Ucluelet | Replay | 3,282 | 10.0 | 10.3 | 2 |
| Ucluelet | Playable Earth | 1,611 | 10.1 | 16.4 | 1 |

All guided route-progress samples were monotonic.
Every measured surface had one connected, active WebGL context at observation end.
The current Google Replay element creates up to four contexts during a navigation, while Atlas and Playable Earth create two.

The JSON heap measurements are Chromium runtime heap usage, not whole-process, GPU, or resident-system memory.
The largest settled JS heap was 367,144,420 bytes in Ucluelet Atlas.
Tokyo Playable Earth settled at 310,616,056 bytes after peaking at 317,408,416 bytes.
These are comparison observations and do not prove lifecycle memory recovery.

## Network and durability

The workload made 24,981 external requests.
It recorded 1,496 aborted provider requests and zero HTTP responses with status 400 or higher.
The aborts happened during navigation and visual-LOD churn, so they are request-churn evidence rather than a missing-tile count.

Playable Earth requested 189 Cesium runtime resources from `cesium.com` in addition to Google tile traffic.
The result independently confirms that all three current immersive experiences depend on live external runtime content.

## Grounding and visual inspection

Playable Earth reported these route grounding offsets:

- Tokyo: `+63.17 m`, classified by the current system as fallback due to an outlier.
- Banff: `+7.29 m`, classified as sampled.
- Ucluelet: `-46.59 m`, classified as sampled.

Visual inspection of all nine screenshots found:

- Tokyo Replay has rich city context, but structures frequently obscure the route thread.
- Tokyo Playable Earth shows a doubled or occluded route thread around water and bridge geometry.
- Banff Playable Earth contains a severe visible tile or LOD discontinuity across the route.
- Ucluelet is recognisable and route-readable, but the declared grounding offset is far outside a stable physical-world target.
- Atlas provides useful regional context but does not provide a route-scoped, locally preserved world.

The current runtime has no physical actor or collision system, so a collision-failure measurement does not exist.
It also exposes no fixed camera-pose continuity oracle or retained route-to-surface control set, so camera discontinuity and numeric alignment remain unavailable rather than guessed.

## Visual evidence

Provider-derived screenshots remain in ignored local artifacts and are represented in the repository by hashes:

| Capture | SHA-256 |
| --- | --- |
| Banff Atlas | `c5885e276b4f0d0df25a7e8a2c1250d05c75d4ad0e240151528371a0da8a8b1e` |
| Banff Playable Earth | `4109807afc038848cc09f27e1d898d6fc0a2e2f643b049225724d0852fb42baa` |
| Banff Replay | `96b95567c7516aac9f2cfb110e967db14fc864b3339a4b61e2ee24ec5fddca0e` |
| Tokyo Atlas | `84e79c66c518c485a2d4104e815c9061c99488c19afc26a7fd6b5c21678397ae` |
| Tokyo Playable Earth | `873503cab8c1436ebdf15c481df5003ec9812cb6fab200aad5154e34e529e0cb` |
| Tokyo Replay | `db25db7449d4e9b6bf3eeba939b9b767778f49035c882ed8e548098ad510700d` |
| Ucluelet Atlas | `94bb7fda209bf187bc78652fde2995c2d3d0f8693e20fbde7167be3b12adefd4` |
| Ucluelet Playable Earth | `f6ec86dda8b34e175c033480be594ac7f4fbca2a106840e979c7398500829a35` |
| Ucluelet Replay | `33d6dfe8d5db3be2277d1251088226c452819fd8c202cc3850fb9d877e6d1162` |

A separate 51.6-second evidence run captured all nine journeys with Playwright video and trace enabled.
The ignored local WebM is 5,852,970 bytes with SHA-256 `ea8df673737f0cce4cbd1af9919fbeda849f0fe8771b5a1c7fdb4fde8c34f93d`.
The ignored local trace ZIP is 148 MiB with SHA-256 `4503b8d20735d3dbb51cdc2c2fa3eb078daccd7d2dea4d9d3c19550bffca0e93` and passed `unzip -t`.

## Remaining comparison gate

A blind human rubric remains required before runtime promotion.
It cannot be replaced by this instrumented baseline or by an attractive screenshot.
