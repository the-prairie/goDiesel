"""Deterministic bounded extraction from local or remote Cloud Optimized GeoTIFFs."""

from __future__ import annotations

import math
import os
import tempfile
import warnings
from pathlib import Path

from .errors import AcquisitionError, ValidationError
from .geometry import EARTH_RADIUS_M, route_local_points
from .route import load_canonical_route


def extract_route_cog_window(
    route_detail_path: Path,
    source_uri: str,
    output_path: Path,
    *,
    exploration_radius_m: int,
    remote_etag: str,
    remote_byte_size: int,
    padding_pixels: int = 2,
) -> dict[str, object]:
    if exploration_radius_m < 1 or padding_pixels < 0:
        raise ValidationError("COG extraction radius and padding are invalid")
    if not source_uri or not remote_etag or remote_byte_size < 1:
        raise ValidationError("COG remote source identity is incomplete")
    try:
        import rasterio
        from pyproj import Transformer
        from rasterio.windows import Window
    except ImportError as error:
        raise AcquisitionError(
            "COG window extraction requires the pinned world compiler dependencies"
        ) from error

    route = load_canonical_route(route_detail_path)
    points = route_local_points(route)
    origin = route["coordinates"][0]
    assert isinstance(origin, dict)
    origin_latitude = float(origin["latitude"])
    origin_longitude = float(origin["longitude"])
    latitude_scale = math.pi * EARTH_RADIUS_M / 180.0
    longitude_scale = latitude_scale * math.cos(math.radians(origin_latitude))
    minimum_x = min(point.x for point in points) - exploration_radius_m
    maximum_x = max(point.x for point in points) + exploration_radius_m
    minimum_y = min(point.y for point in points) - exploration_radius_m
    maximum_y = max(point.y for point in points) + exploration_radius_m
    corner_longitudes = [
        origin_longitude + x / longitude_scale
        for x in (minimum_x, maximum_x, minimum_x, maximum_x)
    ]
    corner_latitudes = [
        origin_latitude + y / latitude_scale
        for y in (minimum_y, minimum_y, maximum_y, maximum_y)
    ]

    with rasterio.open(source_uri) as source:
        if source.count != 1 or source.crs is None:
            raise AcquisitionError("COG source must be a one-band georeferenced raster")
        transformer = Transformer.from_crs("EPSG:4326", source.crs, always_xy=True)
        projected_x, projected_y = transformer.transform(
            corner_longitudes, corner_latitudes
        )
        fractional = source.window(
            min(projected_x),
            min(projected_y),
            max(projected_x),
            max(projected_y),
        )
        column_offset = max(0, math.floor(fractional.col_off) - padding_pixels)
        row_offset = max(0, math.floor(fractional.row_off) - padding_pixels)
        column_end = min(
            source.width,
            math.ceil(fractional.col_off + fractional.width) + padding_pixels,
        )
        row_end = min(
            source.height,
            math.ceil(fractional.row_off + fractional.height) + padding_pixels,
        )
        window = Window(
            column_offset,
            row_offset,
            column_end - column_offset,
            row_end - row_offset,
        )
        if window.width < 2 or window.height < 2:
            raise AcquisitionError("COG route window is empty")
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="Setting the shape on a NumPy array has been deprecated",
                category=DeprecationWarning,
            )
            values = source.read(1, window=window)
        profile = {
            "driver": "GTiff",
            "width": int(window.width),
            "height": int(window.height),
            "count": 1,
            "dtype": source.dtypes[0],
            "crs": source.crs,
            "transform": source.window_transform(window),
            "nodata": source.nodata,
            "compress": "deflate",
            "predictor": 3,
            "zlevel": 9,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "BIGTIFF": "IF_SAFER",
        }
        source_crs = source.crs.to_string()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.", dir=output_path.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with rasterio.open(temporary, "w", **profile) as destination:
            destination.write(values, 1)
            destination.update_tags(
                ADAPTER="godiesel-cog-window-v1",
                REMOTE_ETAG=remote_etag,
                SOURCE_URI=source_uri,
            )
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)

    return {
        "method": "cog-window-v1",
        "remoteEtag": remote_etag,
        "remoteByteSize": remote_byte_size,
        "sourceCrs": source_crs,
        "sourceWindow": [
            int(window.col_off),
            int(window.row_off),
            int(window.width),
            int(window.height),
        ],
        "boundsWgs84": [
            round(min(corner_longitudes), 8),
            round(min(corner_latitudes), 8),
            round(max(corner_longitudes), 8),
            round(max(corner_latitudes), 8),
        ],
    }
