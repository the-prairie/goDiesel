# Route Intelligence Field Test

## Question

Can goDiesel turn a recorded route into a legible model of the experience rather than another distance and elevation summary?

This spike compares route `14736711660` in San Francisco with mountain route `14023448720` in Crete.
The pair is intentionally dissimilar so the model must explain both dense urban texture and exposed mountain terrain.

## Product Shape

The output is a Route Genome with five evidence layers.

1. Recorded truth includes geometry, distance, elevation, elapsed time, and activity provenance.
2. Derived effort includes climb density, grade volatility, closure, terrain rhythm, and route chapters.
3. Earth observation includes built cover, living cover, water presence, exposure, and recent landscape change.
4. Narrative interpretation turns measured transitions into an editable hypothesis about what the day feels like.
5. Visual artifacts include a route portrait, elevation signature, effort ribbon, environmental ribbon, seasonal scenes, and chapter markers.

The lab must label every value as recorded, derived, measured, or hypothesis.
Editorial language must never silently become source truth.

## Earth Engine Pass

The enrichment script buffers each route into a corridor, samples 48 positions along it, and writes durable JSON for the frontend.
It intentionally does not expose temporary Earth Engine map tile URLs to the client.

The first pass uses these datasets.

- `GOOGLE/DYNAMICWORLD/V1` supplies 10 m class probabilities for built, water, trees, grass, crops, shrub, and bare surfaces.
- `COPERNICUS/DEM/GLO30_2024_1` supplies 30 m surface elevation and slope.
- `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` supplies a 10 m annual change signal from the difference between 2023 and 2024 embeddings.

The next ambitious layer should add seasonal Sentinel-2 composites, shade and canopy proxies, heat exposure, weather normals, and automatically discovered visual chapter boundaries.

## Run

Create a virtual environment and install `scripts/route_intelligence/requirements.txt`.
Authenticate Earth Engine against a registered personal Cloud project.

```bash
python scripts/route_intelligence/earth_engine_enrich.py \
  app/public/data/routes/14736711660.json \
  --project YOUR_PROJECT_ID \
  --output app/public/data/route-intelligence/14736711660.json

python scripts/route_intelligence/earth_engine_enrich.py \
  app/public/data/routes/14023448720.json \
  --project YOUR_PROJECT_ID \
  --output app/public/data/route-intelligence/14023448720.json
```

Open `/#/lab/route-intelligence` after generation.
The lab automatically replaces provisional environmental hypotheses with the measured JSON signals.

## Success Criteria

- The urban and mountain routes produce visibly different, credible signatures.
- A person can explain the likely rhythm of either route before opening replay.
- Source-backed facts and editorial hypotheses are distinguishable at a glance.
- The same data contract can later power Finder filters such as shaded, coastal, exposed, green, recently changed, and steady-grade.
- Earth Engine enriches route understanding without becoming a runtime dependency of Replay.
