#!/usr/bin/env python3
"""Retain a deterministic PLATEAU LOD1 subset around a canonical route."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from world_packs.errors import WorldPackError
from world_packs.plateau_subset import build_plateau_tileset_subset


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route_detail", type=Path)
    parser.add_argument("source_tileset_uri")
    parser.add_argument("output", type=Path)
    parser.add_argument("--corridor-radius-m", type=int, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--source-year", type=int, required=True)
    arguments = parser.parse_args()
    try:
        result = build_plateau_tileset_subset(
            arguments.route_detail,
            arguments.source_tileset_uri,
            arguments.output,
            corridor_radius_m=arguments.corridor_radius_m,
            dataset_id=arguments.dataset_id,
            source_year=arguments.source_year,
        )
    except (OSError, WorldPackError) as error:
        parser.exit(2, f"PLATEAU subset failed: {error}\n")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
