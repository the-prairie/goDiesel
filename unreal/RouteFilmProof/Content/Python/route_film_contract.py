"""Validation and sampling helpers for the goDiesel route-film contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CONTRACT = "godiesel.route-film/1"


class RouteFilmContractError(ValueError):
    """Raised before Unreal state is changed when a manifest is invalid."""


def load_manifest(path: str | Path) -> dict[str, Any]:
    manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    validate_manifest(manifest)
    return manifest


def validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("contract") != CONTRACT or manifest.get("schemaVersion") != 1:
        raise RouteFilmContractError("Unsupported route-film manifest contract")

    render = manifest.get("render", {})
    if render.get("width") != 3840 or render.get("height") != 2160:
        raise RouteFilmContractError("The Unreal proof requires a 3840x2160 manifest")
    if render.get("fps", 0) <= 0 or render.get("frameCount", 0) < 2:
        raise RouteFilmContractError("The render timeline is invalid")
    if render.get("tileReadiness", {}).get("incompleteFramesAllowed") != 0:
        raise RouteFilmContractError("Incomplete frames must be forbidden")

    keyframes = manifest.get("camera", {}).get("keyframes", [])
    if len(keyframes) < 2:
        raise RouteFilmContractError("At least two camera keyframes are required")
    if keyframes[0].get("frame") != 0:
        raise RouteFilmContractError("The first camera keyframe must start at frame zero")
    if keyframes[-1].get("frame") != render["frameCount"] - 1:
        raise RouteFilmContractError("The last keyframe must end on the final frame")

    previous_frame = -1
    for keyframe in keyframes:
        if keyframe.get("frame", -1) <= previous_frame:
            raise RouteFilmContractError("Camera keyframes must be strictly increasing")
        for position_name in ("eye", "target"):
            position = keyframe.get(position_name, {})
            if not all(
                isinstance(position.get(field), (int, float))
                for field in ("latitude", "longitude", "heightM")
            ):
                raise RouteFilmContractError(
                    f"Every camera keyframe needs a WGS84 {position_name}"
                )
        previous_frame = keyframe["frame"]


def prestream_positions(manifest: dict[str, Any]) -> list[dict[str, float]]:
    """Return unique camera targets Unreal must visit before capture."""
    positions: list[dict[str, float]] = []
    seen: set[tuple[float, float, int]] = set()
    for keyframe in manifest["camera"]["keyframes"]:
        target = keyframe["eye"]
        identity = (
            round(target["latitude"], 6),
            round(target["longitude"], 6),
            round(keyframe["rangeM"]),
        )
        if identity in seen:
            continue
        seen.add(identity)
        positions.append(
            {
                "latitude": target["latitude"],
                "longitude": target["longitude"],
                "heightM": target["heightM"],
                "headingDeg": keyframe["headingDeg"],
                "pitchDeg": keyframe["pitchDeg"],
                "rangeM": keyframe["rangeM"],
            }
        )
    return positions
