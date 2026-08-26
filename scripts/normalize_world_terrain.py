#!/usr/bin/env python3
"""Normalize an admitted raster source into deterministic route-local terrain."""

from __future__ import annotations

import argparse
from pathlib import Path

from world_packs.acquisition import admit_source_receipt
from world_packs.canonical import canonical_json_document
from world_packs.errors import WorldPackError
from world_packs.raster_normalizer import normalize_raster_terrain


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route_detail", type=Path)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("custody_root", type=Path)
    parser.add_argument("source_logical_name")
    parser.add_argument("output", type=Path)
    parser.add_argument("--exploration-radius-m", type=int, required=True)
    parser.add_argument("--step-m", type=int, default=25)
    parser.add_argument("--vertical-datum", required=True)
    parser.add_argument(
        "--nodata-semantic", choices=("water", "unavailable"), required=True
    )
    parser.add_argument("--nodata-fill-absolute-elevation-m", type=float, default=0)
    arguments = parser.parse_args()
    try:
        sources = admit_source_receipt(arguments.receipt, arguments.custody_root)
        matches = [
            source
            for source in sources
            if source.logical_name == arguments.source_logical_name
        ]
        if len(matches) != 1:
            parser.error("source logical name does not resolve exactly once")
        document = normalize_raster_terrain(
            arguments.route_detail,
            matches[0],
            exploration_radius_m=arguments.exploration_radius_m,
            step_m=arguments.step_m,
            vertical_datum=arguments.vertical_datum,
            nodata_semantic=arguments.nodata_semantic,
            nodata_fill_absolute_elevation_m=(
                arguments.nodata_fill_absolute_elevation_m
            ),
        )
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_bytes(canonical_json_document(document))
    except (OSError, WorldPackError) as error:
        parser.exit(2, f"terrain normalization failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
