#!/usr/bin/env python3
"""Build source-backed environmental signals for one goDiesel route."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

import ee


DYNAMIC_WORLD = "GOOGLE/DYNAMICWORLD/V1"
ALPHA_EARTH = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
COPERNICUS_DEM = "COPERNICUS/DEM/GLO30_2024_1"


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

    return {
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


def main() -> None:
    args = parse_args()
    route = json.loads(args.route_json.read_text())
    result = enrich(route, args.project, args.corridor_m, args.sample_count)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
