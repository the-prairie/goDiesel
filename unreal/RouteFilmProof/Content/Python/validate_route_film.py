"""Command-line preflight for a generated route-film manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from route_film_contract import load_manifest, prestream_positions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    report = {
        "contract": manifest["contract"],
        "route": manifest["route"]["slug"],
        "cameraKeyframes": len(manifest["camera"]["keyframes"]),
        "prestreamPositions": len(prestream_positions(manifest)),
        "comparisonFrames": manifest["comparison"]["frames"],
        "render": manifest["render"],
        "status": "ready-for-unreal-import",
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
