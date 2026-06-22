import json
from pathlib import Path


ROOT = Path(__file__).parent
APP = ROOT / "app"


def test_shadcn_project_config_exists():
    config = json.loads((APP / "components.json").read_text())

    assert config["tsx"] is True
    assert config["aliases"]["ui"] == "@/components/ui"
    assert config["tailwind"]["css"] == "src/index.css"


def test_app_shell_defines_expected_navigation_and_hash_route_support():
    shell = (APP / "src/components/app-shell.tsx").read_text()
    sidebar = (APP / "src/components/app-sidebar.tsx").read_text()

    for label in ("Atlas", "Finder", "Routes", "Replay", "Admin"):
      assert label in sidebar

    assert "window.location.hash.match(/^#quest" in shell
    assert "routeHash(route)" in shell
    assert "Select a route before entering replay" in shell
    assert "Existing admin runs separately from the React app" in shell
    assert "../admin.html" not in shell


def test_route_domain_models_completed_planned_and_discovered_states():
    lifecycle = (APP / "src/domain/route-lifecycle.ts").read_text()
    routes = (APP / "src/domain/routes.ts").read_text()

    assert '"completed" | "planned" | "discovered"' in lifecycle
    assert 'RouteGeometryStatus = "ready" | "missing"' in routes
    assert "normalizeRouteLifecycle(input.lifecycle ?? input.status)" in routes
    assert "route.length > 1 ? \"ready\" : \"missing\"" in routes


def test_build_pipeline_emits_react_route_artifact():
    build = (ROOT / "build.py").read_text()

    assert "quests.generated.json" in build
    assert "'lifecycle': 'completed'" in build
    assert "'replay': {" in build
    assert "react_route_payload" in build


def test_atlas_globe_ports_route_heat_traces_and_interaction():
    globe = (APP / "src/components/globe/atlas-globe.tsx").read_text()
    atlas = (APP / "src/pages/atlas-page.tsx").read_text()

    assert "import * as THREE from \"three\"" in globe
    assert "function routeToGlobeHeatPoints" in globe
    assert "function makeGlobeHeatLine" in globe
    assert "new THREE.TubeGeometry" in globe
    assert "THREE.AdditiveBlending" in globe
    assert "new THREE.TextureLoader().load" in globe
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


def test_replay_picker_pins_selected_route_and_avoids_mobile_nav_overlap():
    shell = (APP / "src/components/app-shell.tsx").read_text()

    assert "const pickerRoutes = selectedRoute" in shell
    assert ".filter((route) => route.slug !== selectedRoute.slug)" in shell
    assert "md:max-h-80 md:overflow-y-auto" in shell
    assert "grid max-h-80 gap-2 overflow-y-auto" not in shell
