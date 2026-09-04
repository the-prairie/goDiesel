import ast
import json
import os
import shutil
from pathlib import Path

import pytest

from quest_meta import build_route_curation


ROOT = Path(__file__).parent
APP = ROOT / "app"
# NOTE: the paths below track the app/src layout. They are a filename coupling
# that TypeScript cannot verify, so they must be updated in the same commit as
# any move of the files they read.
MANIFEST = APP / "src/data/generated/routes.manifest.json"
ROUTE_DETAILS = APP / "public/data/routes"


def test_shadcn_project_config_exists():
    config = json.loads((APP / "components.json").read_text())

    assert config["tsx"] is True
    assert config["aliases"]["ui"] == "@/ui"
    assert config["tailwind"]["css"] == "src/index.css"


def test_representative_route_has_generated_reviewed_curation():
    source_routes = json.loads((ROOT / "quests.json").read_text())["routes"]
    source = next(
        route for route in source_routes if str(route["activity_id"]) == "17654151284"
    )
    detail = json.loads((ROUTE_DETAILS / "17654151284.json").read_text())
    curation = detail["curation"]

    expected_curation = build_route_curation(source["curation"])
    assert curation == expected_curation

    assert curation["review_status"] == "reviewed"
    assert set(curation) == {
        "vibe",
        "ideal_use",
        "terrain",
        "difficulty",
        "highlights",
        "caveats",
        "seasonality",
        "editorial_note",
        "review_status",
    }
    assert "curation" not in next(
        route
        for route in json.loads(MANIFEST.read_text())["routes"]
        if route["slug"] == "17654151284"
    )


def test_generated_manifest_and_lazy_route_records_preserve_source_data():
    manifest = json.loads(MANIFEST.read_text())

    assert all("route" not in route for route in manifest["routes"])
    assert all(1 < len(route["trace"]) <= 96 for route in manifest["routes"])
    assert all(len(point) == 4 for route in manifest["routes"] for point in route["trace"])

    detail_files = sorted(ROUTE_DETAILS.glob("*.json"))
    assert len(detail_files) == len(manifest["routes"])

    representative = manifest["routes"][0]
    detail = json.loads((ROUTE_DETAILS / f'{representative["slug"]}.json').read_text())
    assert detail["slug"] == representative["slug"]
    assert detail["replay"] == representative["replay"]
    assert detail["provenance"]["temporal"]["status"] in {"recorded", "unavailable"}
    assert detail["provenance"]["track"]["segment_count"] >= 1
    assert isinstance(detail["provenance"]["discontinuities"], list)

    stats = json.loads((APP / "src/data/generated/route-stats.json").read_text())
    details = [json.loads(path.read_text()) for path in detail_files]
    assert stats["route_count"] == len(details)
    assert stats["completed_km"] == round(sum(
        route["distance_km"]
        for route in details
        if route.get("lifecycle", "completed") == "completed"
    ), 1)


def test_interrupted_route_publication_restores_last_complete_generation(tmp_path):
    build_tree = ast.parse((ROOT / "build.py").read_text())
    recovery_functions = [
        node
        for node in build_tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name in {
            "validate_route_publication_backup",
            "recover_interrupted_route_publication",
        }
    ]

    route_details = tmp_path / "public/data/routes"
    route_details.mkdir(parents=True)
    (route_details / "route.json").write_text("old route")
    generated_files = tuple(tmp_path / f"generated-{index}.json" for index in range(3))
    for path in generated_files:
        path.write_text("old metadata")

    backup = route_details.parent / ".route-generation-backup"
    shutil.copytree(route_details, backup / "routes")
    (backup / "metadata").mkdir()
    for index, path in enumerate(generated_files):
        shutil.copyfile(path, backup / "metadata" / f"{index}.bin")
    (backup / "ready").touch()

    (route_details / "route.json").write_text("new route")
    for path in generated_files:
        path.write_text("new metadata")

    namespace = {
        "os": os,
        "Path": Path,
        "shutil": shutil,
        "ROUTE_GENERATION_BACKUP": backup,
        "REACT_ROUTE_DETAILS": route_details,
        "REACT_GENERATED_FILES": generated_files,
    }
    exec(compile(ast.Module(body=recovery_functions, type_ignores=[]), "build.py", "exec"), namespace)
    namespace["recover_interrupted_route_publication"]()

    assert (route_details / "route.json").read_text() == "old route"
    assert all(path.read_text() == "old metadata" for path in generated_files)
    assert not backup.exists()


@pytest.mark.parametrize("symlink_location", ["backup", "nested"])
def test_interrupted_route_publication_rejects_symlinks_before_mutation(
    tmp_path,
    symlink_location,
):
    build_tree = ast.parse((ROOT / "build.py").read_text())
    recovery_functions = [
        node
        for node in build_tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name in {
            "validate_route_publication_backup",
            "recover_interrupted_route_publication",
        }
    ]
    route_details = tmp_path / "public/data/routes"
    route_details.mkdir(parents=True)
    (route_details / "route.json").write_text("current route")
    generated_files = tuple(tmp_path / f"generated-{index}.json" for index in range(2))
    for path in generated_files:
        path.write_text("current metadata")
    external = tmp_path / "external"
    external.mkdir()
    (external / "route.json").write_text("external route")
    backup = route_details.parent / ".route-generation-backup"
    if symlink_location == "backup":
        backup.symlink_to(external, target_is_directory=True)
    else:
        backup.mkdir()
        (backup / "routes").symlink_to(external, target_is_directory=True)
        (backup / "metadata").mkdir()
        for index, _path in enumerate(generated_files):
            (backup / "metadata" / f"{index}.missing").touch()
        (backup / "ready").touch()
    namespace = {
        "os": os,
        "Path": Path,
        "shutil": shutil,
        "ROUTE_GENERATION_BACKUP": backup,
        "REACT_ROUTE_DETAILS": route_details,
        "REACT_GENERATED_FILES": generated_files,
    }
    exec(
        compile(ast.Module(body=recovery_functions, type_ignores=[]), "build.py", "exec"),
        namespace,
    )

    with pytest.raises(RuntimeError):
        namespace["recover_interrupted_route_publication"]()

    assert (route_details / "route.json").read_text() == "current route"
    assert all(path.read_text() == "current metadata" for path in generated_files)
    assert (external / "route.json").read_text() == "external route"
