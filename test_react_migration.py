import ast
import json
import shutil
from pathlib import Path

from quest_meta import build_route_curation


ROOT = Path(__file__).parent
APP = ROOT / "app"
MANIFEST = APP / "src/data/generated/routes.manifest.json"
ROUTE_DETAILS = APP / "public/data/routes"


def test_shadcn_project_config_exists():
    config = json.loads((APP / "components.json").read_text())

    assert config["tsx"] is True
    assert config["aliases"]["ui"] == "@/components/ui"
    assert config["tailwind"]["css"] == "src/index.css"


def test_app_shell_defines_expected_navigation_and_hash_route_support():
    shell = (APP / "src/components/app-shell.tsx").read_text()
    sidebar = (APP / "src/components/app-sidebar.tsx").read_text()
    router = (APP / "src/router.tsx").read_text()
    navigation = (APP / "src/navigation.ts").read_text()

    for label in ("Atlas", "Finder", "Routes", "Replay", "Admin"):
      assert label in navigation

    assert 'createHashRouter' in router
    assert 'Navigate to={APP_PATHS.atlas} replace' in router
    assert 'canonicalizeLegacyQuestHash()' in router
    assert 'window.addEventListener("hashchange", canonicalizeLegacyQuestHash)' in router
    assert 'window.location.hash.match(/^#quest' in navigation
    assert 'routeDetailPath(decodedRouteSlug(match[1]) ?? match[1])' in navigation
    assert 'catch {' in navigation
    assert 'path: "routes/:routeSlug"' in router
    assert 'path: "replay/:routeSlug"' in router
    assert '<Link' in sidebar
    assert 'appSectionForPath(location.pathname)' in sidebar
    assert 'aria-current={activeSection.id === section.id ? "page" : undefined}' in sidebar
    assert '<Outlet />' in shell
    assert "React migration preview" not in shell


def test_route_domain_models_completed_planned_and_discovered_states():
    lifecycle = (APP / "src/domain/route-lifecycle.ts").read_text()
    routes = (APP / "src/domain/routes.ts").read_text()

    assert '"completed" | "planned" | "discovered"' in lifecycle
    assert 'RouteGeometryStatus = "ready" | "missing"' in routes
    assert "normalizeRouteLifecycle(input.lifecycle ?? input.status)" in routes
    assert 'RouteGeometryStatus = "ready" | "missing" | "invalid"' in routes
    assert "const geometryStatus = parsedRoute.status" in routes


def test_build_pipeline_emits_react_route_artifact():
    build = (ROOT / "build.py").read_text()

    assert "QUESTS = Path(__file__).resolve().parent" in build
    assert "quests.generated.json" in build
    assert "routes.manifest.json" in build
    assert "REACT_ROUTE_DETAILS" in build
    assert "simplify_route_for_manifest" in build
    assert "lifecycle = spec.get('lifecycle', 'completed')" in build
    assert "quest['lifecycle'] = lifecycle" in build
    assert "'lifecycle': lifecycle" in build
    assert "'replay': build_replay_metadata(" in build
    assert "if route.get('lifecycle', 'completed') == 'completed'" in build
    assert "react_route_payload" in build


def test_representative_route_has_generated_reviewed_curation():
    source_routes = json.loads((ROOT / "quests.json").read_text())["routes"]
    source = next(
        route for route in source_routes if str(route["activity_id"]) == "17654151284"
    )
    detail = json.loads((ROUTE_DETAILS / "17654151284.json").read_text())
    legacy = json.loads((APP / "src/data/quests.generated.json").read_text())["routes"]
    legacy_route = next(route for route in legacy if route["slug"] == "17654151284")
    curation = detail["curation"]

    expected_curation = build_route_curation(source["curation"])
    assert curation == expected_curation
    assert legacy_route["curation"] == expected_curation

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
    legacy = json.loads((APP / "src/data/quests.generated.json").read_text())
    manifest = json.loads(MANIFEST.read_text())

    assert len(manifest["routes"]) == len(legacy["routes"])
    assert all("route" not in route for route in manifest["routes"])
    assert all(1 < len(route["trace"]) <= 96 for route in manifest["routes"])
    assert all(len(point) == 4 for route in manifest["routes"] for point in route["trace"])

    detail_files = sorted(ROUTE_DETAILS.glob("*.json"))
    assert len(detail_files) == len(legacy["routes"])

    representative = legacy["routes"][0]
    detail = json.loads((ROUTE_DETAILS / f'{representative["slug"]}.json').read_text())
    assert detail["slug"] == representative["slug"]
    assert detail["route"] == representative["route"]
    assert detail["replay"] == representative["replay"]

    stats = json.loads((APP / "src/data/generated/route-stats.json").read_text())
    assert stats["route_count"] == len(legacy["routes"])
    assert stats["completed_km"] == round(sum(
        route["distance_km"]
        for route in legacy["routes"]
        if route.get("lifecycle", "completed") == "completed"
    ), 1)


def test_generated_route_publication_is_staged_and_rollback_safe():
    build_source = (ROOT / "build.py").read_text()

    assert "detail_payloads = {}" in build_source
    assert "TemporaryDirectory" in build_source
    assert "recover_interrupted_route_publication()" in build_source
    assert "ROUTE_GENERATION_BACKUP / 'ready'" in build_source
    assert "metadata_backup" in build_source
    assert "shutil.copytree(REACT_ROUTE_DETAILS, backup_details)" in build_source
    assert "stale_route_file.unlink()" not in build_source


def test_interrupted_route_publication_restores_last_complete_generation(tmp_path):
    build_tree = ast.parse((ROOT / "build.py").read_text())
    recovery_function = next(
        node
        for node in build_tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "recover_interrupted_route_publication"
    )

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
        "shutil": shutil,
        "ROUTE_GENERATION_BACKUP": backup,
        "REACT_ROUTE_DETAILS": route_details,
        "REACT_GENERATED_FILES": generated_files,
    }
    exec(compile(ast.Module(body=[recovery_function], type_ignores=[]), "build.py", "exec"), namespace)
    namespace["recover_interrupted_route_publication"]()

    assert (route_details / "route.json").read_text() == "old route"
    assert all(path.read_text() == "old metadata" for path in generated_files)
    assert not backup.exists()


def test_atlas_globe_ports_route_heat_traces_and_interaction():
    globe = (APP / "src/components/globe/atlas-globe.tsx").read_text()
    atlas = (APP / "src/pages/atlas-page.tsx").read_text()

    assert 'from "three"' in globe
    assert "function routeToGlobeHeatPoints" in globe
    assert "function makeGlobeHeatLine" in globe
    assert "function syncLabelBounds" in globe
    assert "state.labelBounds" in globe
    assert "label.offsetWidth" not in globe[globe.find("function updateLabels"):]
    assert "new TubeGeometry" in globe
    assert "blending: AdditiveBlending" in globe
    assert "new TextureLoader().load" in globe
    assert "intersectObjects(state.anchors" in globe
    assert "cameraDistance + event.deltaY * 0.004" in globe
    assert "<AtlasGlobe" in atlas


def test_atlas_search_models_memory_search_states():
    search = (APP / "src/components/search/atlas-search.tsx").read_text()

    for state in (
        "initial",
        "typing",
        "loading",
        "grouped-results",
        "no-results",
        "selected-result",
        "unsupported-query",
    ):
        assert state in search

    assert "Planning queries belong in Finder" in search
    assert "Best in Earth" in search
    assert "function searchState" in search
    assert "selectedLabel" not in search
    assert "selectionActive: Boolean(selectedRegion)" in search
    assert "SelectedSearchResult" not in search


def test_replay_picker_pins_selected_route_and_avoids_mobile_nav_overlap():
    replay = (APP / "src/pages/replay-page.tsx").read_text()
    stage = (APP / "src/components/replay/earth-replay-stage.tsx").read_text()

    assert "const pickerRoutes = selectedSummary" in replay
    assert ".filter((route) => route.slug !== selectedSummary.slug)" in replay
    assert "Change route" in stage
    assert "max-h-64" in stage
    assert "overflow-y-auto" in stage
