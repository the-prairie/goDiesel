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
    assert "Open existing admin" in shell


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
