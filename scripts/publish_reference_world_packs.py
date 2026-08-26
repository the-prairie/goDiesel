#!/usr/bin/env python3
"""Build the fixed reference corpus into browser-readable sealed World Packs."""

from __future__ import annotations

import json
import os
import shutil
import stat
import tempfile
import uuid
from pathlib import Path

from world_packs.canonical import canonical_json_document, sha256_file
from world_packs.compiler import BuildConfiguration, WorldPackCompiler
from world_packs.verification import verify_pack


ROOT = Path(__file__).resolve().parents[1]
CORPUS_PATH = ROOT / "docs/world-packs/reference-corpus.json"
PUBLIC_ROOT = ROOT / "app/public/world-packs"
ACQUIRED_AT = "2026-08-25T23:54:10-06:00"
LICENCE = "owner-controlled-derived-route-data"
ATTRIBUTION = "goDiesel route pipeline"


def _make_writable(root: Path) -> None:
    if not root.exists():
        return
    for path in sorted(root.rglob("*"), reverse=True):
        if not path.is_symlink():
            path.chmod(path.stat().st_mode | stat.S_IWUSR)
    root.chmod(root.stat().st_mode | stat.S_IWUSR)


def _replace_tree(staging: Path, target: Path) -> None:
    if target.is_symlink():
        raise RuntimeError(f"refusing to replace symlinked publication root: {target}")
    if target.exists():
        _make_writable(target)
        shutil.rmtree(target)
    os.replace(staging, target)


def publish() -> dict[str, object]:
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    source_commit = corpus["sourceCommit"]
    staging = PUBLIC_ROOT.parent / f".world-packs-publish-{uuid.uuid4().hex}"
    if staging.exists():
        raise RuntimeError(f"publication staging path already exists: {staging}")
    staging.mkdir()
    published: dict[str, object] = {}
    try:
        with tempfile.TemporaryDirectory(prefix="godiesel-reference-world-packs-") as temporary:
            compiler = WorldPackCompiler(Path(temporary) / "repository")
            for route in corpus["routes"]:
                route_path = ROOT / route["routeDetail"]
                result = compiler.build_route(
                    route_path,
                    BuildConfiguration(
                        world_id=route["id"],
                        acquired_at=ACQUIRED_AT,
                        corridor_radius_m=route["corridorRadiusM"],
                        exploration_radius_m=route["explorationRadiusM"],
                        quality_cell_size_m=route["qualityCellSizeM"],
                        source_uri=(
                            f"repository:{route['routeDetail']}@{source_commit}"
                        ),
                        licence=LICENCE,
                        attribution=ATTRIBUTION,
                        deliberate_missing_cell_offsets=tuple(
                            tuple(offset)
                            for offset in route["deliberateMissingCellOffsets"]
                        ),
                    ),
                )
                health = verify_pack(result.path)
                if health.status != "complete":
                    raise RuntimeError(f"compiled pack did not verify: {result.pack_id}")
                destination = staging / result.world_id / result.pack_id
                destination.parent.mkdir(parents=True)
                shutil.copytree(result.path, destination)
                manifest_path = destination / "manifest.json"
                base_path = (
                    f"/world-packs/{result.world_id}/{result.pack_id}/"
                )
                published[route["slug"]] = {
                    "worldId": result.world_id,
                    "packId": result.pack_id,
                    "basePath": base_path,
                    "manifestSha256": sha256_file(manifest_path),
                }

        (staging / "index.json").write_bytes(
            canonical_json_document(
                {
                    "schemaVersion": 1,
                    "sourceCommit": source_commit,
                    "packs": published,
                }
            )
        )
        _replace_tree(staging, PUBLIC_ROOT)
    except Exception:
        if staging.exists():
            _make_writable(staging)
            shutil.rmtree(staging)
        raise
    return {"schemaVersion": 1, "packs": published}


if __name__ == "__main__":
    print(json.dumps(publish(), indent=2, sort_keys=True))
