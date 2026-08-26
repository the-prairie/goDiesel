"""Acquisition-time normalization of a retainable DEM into route-local terrain."""

from __future__ import annotations

import math
from pathlib import Path

from .acquisition import AcquiredSource
from .canonical import sha256_file
from .errors import AcquisitionError, ValidationError
from .geometry import EARTH_RADIUS_M, route_local_points
from .route import load_canonical_route
from .schema import validate_document


NORMALIZER_NAME = "godiesel-raster-normalizer"
NORMALIZER_VERSION = "1"
MAXIMUM_GRID_VERTICES = 500_000


def _measured_runs(values: list[bool]) -> list[list[int]]:
    result: list[list[int]] = []
    start: int | None = None
    for index, measured in enumerate([*values, False]):
        if measured and start is None:
            start = index
        elif not measured and start is not None:
            result.append([start, index - start])
            start = None
    return result


def normalize_raster_terrain(
    route_detail_path: Path,
    source: AcquiredSource,
    *,
    exploration_radius_m: int,
    step_m: int,
    vertical_datum: str,
    nodata_semantic: str,
    nodata_fill_absolute_elevation_m: float,
) -> dict[str, object]:
    if exploration_radius_m < 1 or step_m < 1:
        raise ValidationError("terrain normalization radius and step must be positive")
    if nodata_semantic not in {"water", "unavailable"}:
        raise ValidationError("terrain no-data semantic is unsupported")
    if not vertical_datum.strip():
        raise ValidationError("terrain vertical datum is missing")
    try:
        import numpy as np
        import rasterio
        from pyproj import Transformer
    except ImportError as error:
        raise AcquisitionError(
            "raster normalization requires the pinned world compiler dependencies"
        ) from error

    route = load_canonical_route(route_detail_path)
    points = route_local_points(route)
    origin = route["coordinates"][0]
    assert isinstance(origin, dict)
    latitude = float(origin["latitude"])
    longitude = float(origin["longitude"])
    origin_elevation = float(origin["elevationM"])
    minimum_x = math.floor(
        (min(point.x for point in points) - exploration_radius_m) / step_m
    ) * step_m
    maximum_x = math.ceil(
        (max(point.x for point in points) + exploration_radius_m) / step_m
    ) * step_m
    minimum_y = math.floor(
        (min(point.y for point in points) - exploration_radius_m) / step_m
    ) * step_m
    maximum_y = math.ceil(
        (max(point.y for point in points) + exploration_radius_m) / step_m
    ) * step_m
    columns = round((maximum_x - minimum_x) / step_m) + 1
    rows = round((maximum_y - minimum_y) / step_m) + 1
    if columns * rows > MAXIMUM_GRID_VERTICES:
        raise ValidationError(
            f"normalized terrain grid exceeds {MAXIMUM_GRID_VERTICES} vertices"
        )

    latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
    longitude_scale = latitude_scale * math.cos(math.radians(latitude))
    x_axis = minimum_x + np.arange(columns, dtype=np.float64) * step_m
    y_axis = minimum_y + np.arange(rows, dtype=np.float64) * step_m
    grid_x, grid_y = np.meshgrid(x_axis, y_axis)
    grid_longitudes = longitude + grid_x.ravel() / longitude_scale
    grid_latitudes = latitude + grid_y.ravel() / latitude_scale

    with rasterio.open(source.path) as dataset:
        if dataset.count != 1 or dataset.crs is None:
            raise AcquisitionError("terrain source must be a one-band georeferenced raster")
        transformer = Transformer.from_crs("EPSG:4326", dataset.crs, always_xy=True)
        source_x, source_y = transformer.transform(grid_longitudes, grid_latitudes)
        sampled = list(dataset.sample(zip(source_x, source_y), masked=True))
        values = np.array(
            [float(sample[0]) if not bool(sample.mask[0]) else np.nan for sample in sampled],
            dtype=np.float64,
        )
        route_coordinates = route["coordinates"]
        assert isinstance(route_coordinates, list)
        route_x, route_y = transformer.transform(
            [float(point["longitude"]) for point in route_coordinates],
            [float(point["latitude"]) for point in route_coordinates],
        )
        route_samples = list(dataset.sample(zip(route_x, route_y), masked=True))
        measured_route = np.array(
            [
                float(sample[0]) if not bool(sample.mask[0]) else np.nan
                for sample in route_samples
            ],
            dtype=np.float64,
        )
        source_crs = dataset.crs.to_string()

    if not np.isfinite(measured_route).all():
        missing = int((~np.isfinite(measured_route)).sum())
        raise AcquisitionError(
            f"terrain source does not cover {missing} recorded route samples"
        )
    recorded_route = np.array(
        [float(point["elevationM"]) for point in route_coordinates],
        dtype=np.float64,
    )
    route_deltas = recorded_route - measured_route
    alignment_offset = float(np.median(route_deltas))
    residuals = np.abs(route_deltas - alignment_offset)
    residual_p95 = float(np.quantile(residuals, 0.95))
    measured = np.isfinite(values)
    aligned_absolute = np.where(
        measured,
        values + alignment_offset,
        nodata_fill_absolute_elevation_m + alignment_offset,
    )
    local_heights = aligned_absolute - origin_elevation
    measured_values = [bool(value) for value in measured.tolist()]
    document: dict[str, object] = {
        "schemaVersion": 1,
        "coordinateReference": "route-local-enu-v1",
        "origin": {
            "latitude": latitude,
            "longitude": longitude,
            "elevationM": origin_elevation,
        },
        "source": {
            "logicalName": source.logical_name,
            "sha256": sha256_file(source.path),
            "sourceUri": source.source_uri,
            "sourceVersion": source.source_version,
            "sourceCrs": source_crs,
            "verticalDatum": vertical_datum,
            "licence": source.licence_id,
            "attribution": source.attribution,
        },
        "grid": {
            "minimumXM": float(minimum_x),
            "minimumYM": float(minimum_y),
            "stepM": float(step_m),
            "columns": columns,
            "rows": rows,
            "heightsM": [round(float(value), 3) for value in local_heights],
            "measuredRuns": _measured_runs(measured_values),
        },
        "verticalAlignment": {
            "method": "median-recorded-minus-measured-v1",
            "offsetM": round(alignment_offset, 3),
            "routeSampleCount": len(route_coordinates),
            "residualP95M": round(residual_p95, 3),
        },
        "nodata": {
            "semantic": nodata_semantic,
            "fillAbsoluteElevationM": float(nodata_fill_absolute_elevation_m),
            "filledVertexCount": int((~measured).sum()),
        },
        "normalizer": {
            "name": NORMALIZER_NAME,
            "version": NORMALIZER_VERSION,
            "sampling": "nearest-source-cell-centre",
        },
    }
    validate_document("normalized-terrain", document)
    return document
