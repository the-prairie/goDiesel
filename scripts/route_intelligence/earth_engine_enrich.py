#!/usr/bin/env python3
"""Build source-backed environmental signals for one goDiesel route."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import time
from pathlib import Path
from typing import Any

import ee
import requests


DYNAMIC_WORLD = "GOOGLE/DYNAMICWORLD/V1"
ALPHA_EARTH = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
COPERNICUS_DEM = "COPERNICUS/DEM/GLO30_2024_1"
SENTINEL_2 = "COPERNICUS/S2_SR_HARMONIZED"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("route_json", type=Path)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corridor-m", type=int, default=350)
    parser.add_argument("--sample-count", type=int, default=48)
    return parser.parse_args()


def percentile_points(points: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    if count >= len(points):
        return points
    return [points[round(index * (len(points) - 1) / (count - 1))] for index in range(count)]


def scalar(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    return float(value)


def percent(value: Any) -> float:
    return round(max(0.0, min(100.0, scalar(value) * 100.0)), 1)


def mask_sentinel_clouds(image: ee.Image) -> ee.Image:
    scl = image.select("SCL")
    clear = (
        scl.neq(3)
        .And(scl.neq(8))
        .And(scl.neq(9))
        .And(scl.neq(10))
        .And(scl.neq(11))
    )
    return (
        image.updateMask(clear)
        .select(["B4", "B3", "B2"])
        .divide(10_000)
        .copyProperties(image, image.propertyNames())
    )


def sentinel_collection(region: ee.Geometry) -> ee.ImageCollection:
    return (
        ee.ImageCollection(SENTINEL_2)
        .filterBounds(region)
        # Keep moderately cloudy source tiles because the SCL mask below removes
        # cloud pixels while preserving usable land observations.
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
        .map(mask_sentinel_clouds)
    )


def composite_or_fallback(
    primary: ee.ImageCollection,
    fallback: ee.ImageCollection,
) -> ee.Image:
    return ee.Image(
        ee.Algorithms.If(
            primary.size().gt(0),
            primary.median(),
            fallback.median(),
        )
    )


def route_overlay(line: ee.Geometry, width: int = 5) -> ee.Image:
    return (
        ee.Image(0)
        .byte()
        .paint(line, 1, width)
        .selfMask()
        .visualize(palette=["ff583d"], opacity=0.96)
    )


def visualized_true_color(image: ee.Image, line: ee.Geometry) -> ee.Image:
    base = image.visualize(
        bands=["B4", "B3", "B2"],
        min=0.015,
        max=0.31,
        gamma=1.08,
    )
    return base.blend(route_overlay(line))


def download_thumbnail(image: ee.Image, region: ee.Geometry, destination: Path) -> None:
    for attempt in range(3):
        url = image.getThumbURL(
            {
                "region": region,
                "dimensions": 1400,
                "format": "png",
                "crs": "EPSG:3857",
            }
        )
        try:
            response = requests.get(url, timeout=300)
            if not response.ok:
                raise RuntimeError(
                    f"Earth Engine thumbnail failed ({response.status_code}): {response.text[:1200]}"
                )
            destination.write_bytes(response.content)
            return
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def render_scenes(
    route: dict[str, Any],
    line: ee.Geometry,
    context: ee.Geometry,
    destination: Path,
) -> list[dict[str, Any]]:
    destination.mkdir(parents=True, exist_ok=True)
    collection = sentinel_collection(context)
    region = context.bounds()
    route_date = dt.date.fromisoformat(route["date"])
    recorded_start = ee.Date((route_date - dt.timedelta(days=55)).isoformat())
    recorded_end = ee.Date((route_date + dt.timedelta(days=55)).isoformat())
    recent = collection.filterDate("2023-01-01", "2026-01-01")
    scenes: list[tuple[str, str, ee.Image]] = [
        (
            "portrait",
            "Recent cloud-cleared portrait",
            composite_or_fallback(recent, collection),
        ),
        (
            "recorded-season",
            f"Recorded season · {route_date.strftime('%B %Y')}",
            composite_or_fallback(
                collection.filterDate(recorded_start, recorded_end),
                recent,
            ),
        ),
    ]
    seasonal_months = {
        "winter": (12, 2),
        "spring": (3, 5),
        "summer": (6, 8),
        "autumn": (9, 11),
    }
    for key, (start_month, end_month) in seasonal_months.items():
        seasonal = (
            collection.filterDate("2020-01-01", "2026-01-01")
            .filter(ee.Filter.calendarRange(start_month, end_month, "month"))
        )
        scenes.append(
            (
                key,
                f"Typical {key} · 2020-2025 composite",
                composite_or_fallback(seasonal, recent),
            )
        )

    dem_collection = ee.ImageCollection(COPERNICUS_DEM)
    projection = dem_collection.first().projection()
    dem = dem_collection.mosaic().setDefaultProjection(projection).select("DEM")
    hillshade = ee.Terrain.hillshade(dem).divide(255).multiply(0.42).add(0.58)
    recent_rgb = composite_or_fallback(recent, collection)
    terrain_rgb = recent_rgb.select(["B4", "B3", "B2"]).multiply(hillshade)
    scenes.append(("terrain", "Terrain-shaped satellite portrait", terrain_rgb))

    manifest = []
    for key, label, image in scenes:
        filename = f"{key}.png"
        scene_path = destination / filename
        if scene_path.exists() and scene_path.stat().st_size > 10_000:
            print(f"Reused {scene_path}")
        else:
            rendered = visualized_true_color(image, line)
            download_thumbnail(rendered, region, scene_path)
            print(f"Rendered {scene_path}")
        manifest.append(
            {
                "key": key,
                "label": label,
                "src": f"/data/route-intelligence/{route['activity_id']}/{filename}",
                "dataset": SENTINEL_2 if key != "terrain" else f"{SENTINEL_2} + {COPERNICUS_DEM}",
            }
        )
    return manifest


def build_stack(line: ee.Geometry, corridor: ee.Geometry) -> ee.Image:
    now = ee.Date(dt.date.today().isoformat())
    dynamic_world = (
        ee.ImageCollection(DYNAMIC_WORLD)
        .filterBounds(corridor)
        .filterDate(now.advance(-24, "month"), now)
        .select(["water", "trees", "grass", "flooded_vegetation", "crops", "shrub_and_scrub", "built", "bare"])
        .mean()
    )
    green = dynamic_world.select(["trees", "grass", "flooded_vegetation", "crops", "shrub_and_scrub"]).reduce(ee.Reducer.sum()).rename("green")

    dem_collection = ee.ImageCollection(COPERNICUS_DEM)
    projection = dem_collection.first().projection()
    dem = dem_collection.mosaic().setDefaultProjection(projection).select("DEM")
    slope = ee.Terrain.slope(dem).divide(35).clamp(0, 1).rename("slope_norm")
    exposure = slope.multiply(0.7).add(dynamic_world.select("bare").multiply(0.3)).rename("exposure")

    embedding = ee.ImageCollection(ALPHA_EARTH).filterBounds(line)
    embedding_2023 = embedding.filterDate("2023-01-01", "2024-01-01").mosaic()
    embedding_2024 = embedding.filterDate("2024-01-01", "2025-01-01").mosaic()
    change = ee.Image(1).subtract(embedding_2023.multiply(embedding_2024).reduce(ee.Reducer.sum())).clamp(0, 1).rename("change")

    return ee.Image.cat(
        dynamic_world.select("built"),
        green,
        dynamic_world.select("water"),
        exposure,
        change,
        dem.rename("elevation_satellite_m"),
        slope.rename("slope_norm"),
    )


def enrich(route: dict[str, Any], project: str, corridor_m: int, sample_count: int) -> dict[str, Any]:
    ee.Initialize(project=project)
    points = route["route"]
    coordinates = [[point["lng"], point["lat"]] for point in points]
    line = ee.Geometry.LineString(coordinates)
    corridor = line.buffer(corridor_m)
    context = line.buffer(max(1200, corridor_m * 3))
    stack = build_stack(line, corridor)

    corridor_values = stack.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=corridor,
        scale=20,
        bestEffort=True,
        maxPixels=20_000_000,
    ).getInfo()
    water_context = stack.select("water").reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=context,
        scale=20,
        bestEffort=True,
        maxPixels=20_000_000,
    ).getInfo()

    selected = percentile_points(points, sample_count)
    features = ee.FeatureCollection(
        [
            ee.Feature(
                ee.Geometry.Point([point["lng"], point["lat"]]),
                {"distance_km": point["d"] / 1000},
            )
            for point in selected
        ]
    )
    sampled = stack.reduceRegions(
        collection=features,
        reducer=ee.Reducer.mean(),
        scale=20,
    ).getInfo()["features"]

    samples = []
    for feature in sampled:
        properties = feature["properties"]
        samples.append(
            {
                "distance_km": round(scalar(properties.get("distance_km")), 2),
                "built": percent(properties.get("built")),
                "green": percent(properties.get("green")),
                "water": percent(properties.get("water")),
                "exposure": percent(properties.get("exposure")),
                "change": percent(properties.get("change")),
            }
        )

    output = {
        "route_id": str(route["activity_id"]),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "corridor_m": corridor_m,
        "signals": {
            "built": percent(corridor_values.get("built")),
            "green": percent(corridor_values.get("green")),
            "water": percent(water_context.get("water")),
            "exposure": percent(corridor_values.get("exposure")),
            "change": percent(corridor_values.get("change")),
        },
        "samples": samples,
        "datasets": [
            {"id": DYNAMIC_WORLD, "role": "land-cover probabilities and recent environmental context"},
            {"id": COPERNICUS_DEM, "role": "terrain slope and satellite elevation comparison"},
            {"id": ALPHA_EARTH, "role": "annual landscape-change signal"},
        ],
    }
    return output


def main() -> None:
    args = parse_args()
    route = json.loads(args.route_json.read_text())
    result = enrich(route, args.project, args.corridor_m, args.sample_count)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    coordinates = [[point["lng"], point["lat"]] for point in route["route"]]
    line = ee.Geometry.LineString(coordinates)
    scene_context = line.buffer(max(1800, args.corridor_m * 5))
    result["visuals"] = render_scenes(
        route,
        line,
        scene_context,
        args.output.parent / str(route["activity_id"]),
    )
    result["datasets"].append(
        {"id": SENTINEL_2, "role": "cloud-cleared true-color route scenes and seasonal composites"}
    )
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
