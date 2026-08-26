#!/usr/bin/env python3
"""Extract a bounded route envelope from a version-bound elevation COG."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from world_packs.cog_window import extract_route_cog_window
from world_packs.errors import WorldPackError


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route_detail", type=Path)
    parser.add_argument("source_uri")
    parser.add_argument("output", type=Path)
    parser.add_argument("--exploration-radius-m", type=int, required=True)
    parser.add_argument("--remote-etag", required=True)
    parser.add_argument("--remote-byte-size", type=int, required=True)
    arguments = parser.parse_args()
    try:
        lineage = extract_route_cog_window(
            arguments.route_detail,
            arguments.source_uri,
            arguments.output,
            exploration_radius_m=arguments.exploration_radius_m,
            remote_etag=arguments.remote_etag,
            remote_byte_size=arguments.remote_byte_size,
        )
    except (OSError, WorldPackError) as error:
        parser.exit(2, f"COG window extraction failed: {error}\n")
    print(json.dumps(lineage, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
