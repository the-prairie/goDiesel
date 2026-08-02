# Unreal Route Film Proof

This project is an isolated quality gate for one continuous goDiesel route film.
It does not replace the production Google 3D replay unless repeated frame comparisons show an unmistakable improvement.

## Requirements

- Unreal Engine 5.8
- Cesium for Unreal
- Cesium ion access to Google Photorealistic 3D Tiles
- Apple ProRes Media and Movie Render Queue plugins
- `ffmpeg` for the web proxy

## Generate the portable manifest

From `app/`:

```sh
npm run export:unreal-manifest -- --route=14023448720 --duration=24
```

The command writes `Manifests/14023448720-feature.json` inside this project.

## Preflight the contract

```sh
python3 Content/Python/validate_route_film.py \
  Manifests/14023448720-feature.json \
  --report Saved/RouteFilm/preflight.json
```

## Unreal scene contract

1. Create a level named `/Game/RouteFilmProof/RouteFilmWorld`.
2. Add a `CesiumGeoreference` and Google Photorealistic 3D Tiles tileset.
3. Keep frustum culling enabled and set the tileset maximum screen-space error to 8 for the prestream pass and 2 for capture.
4. Import every manifest camera keyframe into one Level Sequence named `RouteFilm_<slug>`.
5. Convert WGS84 targets through the scene `CesiumGeoreference`; do not treat latitude and longitude as Unreal world coordinates.
6. Prestream every position returned by `prestream_positions()` and wait for zero pending tile requests before capture.
7. Abort the render if any camera position remains incomplete after the configured readiness timeout.

After the scene actors exist, run `Content/Python/import_route_film.py` from the
Unreal Python console or with `-ExecutePythonScript` to create the continuous
camera sequence from the manifest.

## Movie Render Queue outputs

- Resolution: 3840 x 2160
- Frame rate: manifest frame rate
- Warm-up: manifest `tileReadiness.settleFrames`
- Master: 16-bit half-float EXR sequence
- Mezzanine: Apple ProRes 422 HQ
- Web proxy: H.264 MP4 through the command-line encoder
- Camera: one continuous take with no editorial cuts

Run the same manifest three times.
All runs must complete with zero missing-tile frames before comparison against the browser renderer.
