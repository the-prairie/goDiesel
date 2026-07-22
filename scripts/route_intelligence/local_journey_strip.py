#!/usr/bin/env python3
"""Crop an existing Earth Engine route portrait into kilometer journey frames."""

from __future__ import annotations

import argparse
import json
import math
import struct
import subprocess
from pathlib import Path
from typing import Any


EARTH_RADIUS_M = 6_378_137
FRAME_WINDOW_M = 4_000
OUTPUT_SIZE_PX = 480


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("route_json", type=Path)
    parser.add_argument("enrichment_json", type=Path)
    return parser.parse_args()


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as source:
        header = source.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Expected PNG input: {path}")
    return struct.unpack(">II", header[16:24])


def mercator(lng: float, lat: float) -> tuple[float, float]:
    x = EARTH_RADIUS_M * math.radians(lng)
    bounded_lat = max(-85.05112878, min(85.05112878, lat))
    y = EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(bounded_lat) / 2))
    return x, y


def kilometer_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total_m = float(points[-1]["d"])
    targets = [kilometer * 1000 for kilometer in range(int(total_m // 1000) + 1)]
    if total_m - targets[-1] >= 250:
        targets.append(total_m)

    frames = []
    for target_m in targets:
        point = min(points, key=lambda candidate: abs(float(candidate["d"]) - target_m))
        frames.append(
            {
                "distance_km": round(float(point["d"]) / 1000, 2),
                "lat": float(point["lat"]),
                "lng": float(point["lng"]),
                "elevation_m": round(float(point["elev"])),
            }
        )
    return frames


def inferred_portrait_bounds(
    points: list[dict[str, Any]],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    projected = [mercator(float(point["lng"]), float(point["lat"])) for point in points]
    min_x = min(point[0] for point in projected)
    max_x = max(point[0] for point in projected)
    min_y = min(point[1] for point in projected)
    max_y = max(point[1] for point in projected)
    route_width = max_x - min_x
    route_height = max_y - min_y
    image_ratio = width / height
    denominator = 2 * (image_ratio - 1)
    inferred_margin = (
        (route_width - image_ratio * route_height) / denominator
        if abs(denominator) > 0.001
        else 0
    )
    average_lat = sum(float(point["lat"]) for point in points) / len(points)
    expected_margin = 1_800 / math.cos(math.radians(average_lat))
    if inferred_margin <= 0 or inferred_margin > expected_margin * 2.5:
        inferred_margin = expected_margin
    return (
        min_x - inferred_margin,
        min_y - inferred_margin,
        max_x + inferred_margin,
        max_y + inferred_margin,
    )


def render_frame(
    portrait: Path,
    destination: Path,
    center_x: int,
    center_y: int,
    crop_size: int,
    width: int,
    height: int,
) -> tuple[int, int]:
    x = max(0, min(width - crop_size, center_x - crop_size // 2))
    y = max(0, min(height - crop_size, center_y - crop_size // 2))
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(portrait),
            "-vf",
            f"crop={crop_size}:{crop_size}:{x}:{y},scale={OUTPUT_SIZE_PX}:{OUTPUT_SIZE_PX}:flags=lanczos",
            "-q:v",
            "3",
            "-frames:v",
            "1",
            str(destination),
        ],
        check=True,
    )
    return x, y


def main() -> None:
    args = parse_args()
    route = json.loads(args.route_json.read_text())
    enrichment = json.loads(args.enrichment_json.read_text())
    route_id = str(route["activity_id"])
    portrait = args.enrichment_json.parent / route_id / "portrait.png"
    destination = portrait.parent / "journey-strip"
    destination.mkdir(parents=True, exist_ok=True)

    width, height = png_dimensions(portrait)
    min_x, min_y, max_x, max_y = inferred_portrait_bounds(route["route"], width, height)
    pixels_per_meter = min(width / (max_x - min_x), height / (max_y - min_y))
    crop_size = max(112, min(width, height, round(FRAME_WINDOW_M * pixels_per_meter)))

    manifest = []
    frames = kilometer_points(route["route"])
    for index, frame in enumerate(frames):
        x, y = mercator(frame["lng"], frame["lat"])
        pixel_x = round((x - min_x) / (max_x - min_x) * width)
        pixel_y = round((max_y - y) / (max_y - min_y) * height)
        filename = f"km-{index:02d}.jpg"
        frame_path = destination / filename
        crop_x, crop_y = render_frame(
            portrait,
            frame_path,
            pixel_x,
            pixel_y,
            crop_size,
            width,
            height,
        )
        manifest.append(
            {
                **frame,
                "index": index,
                "is_finish": index == len(frames) - 1,
                "src": f"/data/route-intelligence/{route_id}/journey-strip/{filename}",
                "dataset": "COPERNICUS/S2_SR_HARMONIZED",
                "window_m": FRAME_WINDOW_M,
                "generation": "local-crop-from-approved-route-portrait",
                "marker_x_pct": round((pixel_x - crop_x) / crop_size * 100, 1),
                "marker_y_pct": round((pixel_y - crop_y) / crop_size * 100, 1),
            }
        )
        print(f"Rendered {frame_path}")

    enrichment["journey_strip"] = manifest
    args.enrichment_json.write_text(json.dumps(enrichment, indent=2) + "\n")
    print(f"Wrote {args.enrichment_json} with {len(manifest)} journey frames")


if __name__ == "__main__":
    main()
