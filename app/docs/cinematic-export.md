# Deterministic Route Film Export

The offline route-film renderer produces a frame-verified 4K master from the live cinematic director.

It does not record real-time browser playback.
It seeks to an exact film timestamp, waits for the visible Google 3D image to become detailed and stable, writes a lossless PNG frame, and only encodes the film after every required frame has evidence.

## Render

Run the app locally with the Google Maps key configured, then render a route:

```bash
npm run render:route-film:4k -- \
  --route=14023448720 \
  --cut=feature \
  --headed
```

The defaults produce:

- A 3840 x 2160 ProRes 422 HQ master.
- A smaller H.264 viewing proxy.
- A JSON evidence report for every captured frame.
- A resumable PNG cache while rendering.

The frame cache is removed after a successful encode unless `--keep-frames=true` is supplied.
An interrupted or failed render keeps the cache and resumes it on the next matching invocation.

## Stability Contract

A frame is eligible for capture only after consecutive viewport samples:

- Contain sufficient color and luminance detail.
- Remain below the configured mean pixel-change threshold.
- Match the exact fixed-timestep camera frame requested by the manifest.

The renderer fails instead of silently recording incomplete imagery.
`--allow-unsettled=true` exists only for diagnosis and records the exception in the evidence report.

This contract verifies the visible output at the requested resolution.
It does not claim that Google has loaded tiles outside the camera frustum or a higher level of detail than the provider exposes.

## Useful Options

```text
--output=/path/to/master.mov
--frame-dir=/path/to/resumable-cache
--report=/path/to/report.json
--motion-samples=1
--spatial-scale=1
--max-seconds=5
--preflight=true
--resume=true
--proxy=true
--keep-frames=false
--settle-attempts=12
--settle-delay-ms=180
```

Use a `.mov` output for ProRes 422 HQ.
Use a `.mp4` output for a direct H.264 master.
