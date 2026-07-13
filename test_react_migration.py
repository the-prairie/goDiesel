import json
from pathlib import Path


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
    assert 'routeDetailPath(decodeURIComponent(match[1]))' in navigation
    assert 'path: "routes/:routeSlug"' in router
    assert 'path: "replay/:routeSlug"' in router
    assert '<NavLink' in sidebar
    assert '<Outlet />' in shell
    assert "React migration preview" not in shell


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
    assert "routes.manifest.json" in build
    assert "REACT_ROUTE_DETAILS" in build
    assert "simplify_route_for_manifest" in build
    assert "'lifecycle': 'completed'" in build
    assert "'replay': {" in build
    assert "react_route_payload" in build


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
    assert stats["completed_km"] == round(
        sum(route["distance_km"] for route in legacy["routes"]), 1
    )


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
    assert "route:${route.slug}" in search


def test_replay_picker_pins_selected_route_and_avoids_mobile_nav_overlap():
    replay = (APP / "src/pages/replay-page.tsx").read_text()

    assert "const pickerRoutes = selectedSummary" in replay
    assert ".filter((route) => route.slug !== selectedSummary.slug)" in replay
    assert "md:max-h-80 md:overflow-y-auto" in replay
    assert "grid max-h-80 gap-2 overflow-y-auto" not in replay
