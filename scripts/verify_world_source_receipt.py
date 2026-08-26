#!/usr/bin/env python3
"""Verify retained source custody bytes against a committed receipt."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from world_packs.acquisition import admit_source_receipt
from world_packs.errors import WorldPackError


def verify_receipt(receipt: Path, custody_root: Path) -> dict[str, object]:
    sources = admit_source_receipt(receipt, custody_root)
    return {
        "schemaVersion": 1,
        "status": "admitted",
        "sourceCount": len(sources),
        "sources": [source.logical_name for source in sources],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path)
    parser.add_argument("custody_root", type=Path)
    arguments = parser.parse_args()
    try:
        result = verify_receipt(arguments.receipt, arguments.custody_root)
    except (OSError, WorldPackError) as error:
        parser.exit(2, f"source receipt verification failed: {error}\n")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
