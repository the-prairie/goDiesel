"""Deployment and route-share guards.

Every test runs the real script against stubbed tools on PATH. Nothing here
contacts Cloudflare: `npx`, `curl`, `node`, and the build are fakes that record
how they were called.
"""

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).parent
PRODUCTION_DEPLOY_COMMAND = (
    "npx wrangler pages deploy dist --project-name=godiesel --branch=production"
)


def executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_printed_production_deploy_command_targets_the_production_branch():
    lines = (ROOT / "make-dist.sh").read_text(encoding="utf-8").splitlines()
    printed = [line.strip() for line in lines if "Deploy with: npx wrangler pages deploy dist" in line]

    assert len(printed) == 1
    assert PRODUCTION_DEPLOY_COMMAND in printed[0]


def run_provider_key_check(tmp_path: Path, require: str | None):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    checker = scripts / "check-provider-key.mjs"
    shutil.copy2(ROOT / "scripts" / "check-provider-key.mjs", checker)
    environment = os.environ.copy()
    for name in ("GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_API_KEY", "GODIESEL_REQUIRE_PROVIDER_KEY"):
        environment.pop(name, None)
    if require is not None:
        environment["GODIESEL_REQUIRE_PROVIDER_KEY"] = require
    return subprocess.run(
        ["node", str(checker)], cwd=tmp_path, env=environment,
        capture_output=True, text=True, check=False,
    )


def test_required_provider_key_rejects_a_keyless_build(tmp_path: Path):
    result = run_provider_key_check(tmp_path, "1")

    assert result.returncode != 0
    assert "a Google Maps key is required" in result.stderr


def test_local_keyless_build_is_still_allowed(tmp_path: Path):
    result = run_provider_key_check(tmp_path, None)

    assert result.returncode == 0
    assert "skipped" in result.stdout


class PublishHarness:
    """A copy of the publish script in a fake checkout with recording stubs."""

    def __init__(self, tmp_path: Path, public_status: str = "404", curl_exit: int = 0):
        self.root = tmp_path / "checkout"
        scripts = self.root / "scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(ROOT / "scripts" / "publish-route-microsite.sh", scripts / "publish-route-microsite.sh")
        (self.root / "app").mkdir()
        # The repository root holds Pages Functions and a wrangler.toml. A
        # share must never be deployed from a directory that can see them.
        (self.root / "functions" / "api").mkdir(parents=True)
        (self.root / "functions" / "api" / "courses.ts").write_text("export {}\n", encoding="utf-8")
        (self.root / "wrangler.toml").write_text('name = "godiesel"\n', encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid",
             "commit", "-q", "--allow-empty", "-m", "fixture"],
            cwd=self.root, check=True,
        )

        self.calls = tmp_path / "calls.log"
        executable(
            self.root / "make-dist.sh",
            f"""#!/bin/bash
printf 'make-dist require_key=%s slug=%s\\n' "$GODIESEL_REQUIRE_PROVIDER_KEY" "$GODIESEL_SINGLE_ROUTE_SLUG" >> {self.calls}
mkdir -p dist && printf '<html></html>' > dist/index.html
""",
        )
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        executable(bin_dir / "node", f"#!/bin/bash\nprintf 'node %s\\n' \"$*\" >> {self.calls}\n")
        executable(
            bin_dir / "curl",
            f"#!/bin/bash\nprintf 'curl %s\\n' \"$*\" >> {self.calls}\nprintf '{public_status}'\nexit {curl_exit}\n",
        )
        executable(
            bin_dir / "npx",
            f"""#!/bin/bash
printf 'npx %s\\n' "$*" >> {self.calls}
if [[ "$1" == "wrangler" ]]; then
  printf 'wrangler-cwd-entries=%s\\n' "$(ls -A | tr '\\n' ' ')" >> {self.calls}
fi
""",
        )
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{bin_dir}:{self.environment['PATH']}"

    def run(self, *arguments: str):
        return subprocess.run(
            [str(self.root / "scripts" / "publish-route-microsite.sh"), *arguments],
            cwd=self.root, env=self.environment, capture_output=True, text=True, check=False,
        )

    def recorded(self) -> str:
        return self.calls.read_text(encoding="utf-8") if self.calls.exists() else ""


def test_publish_refuses_an_existing_share_without_explicit_replacement(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="200")

    result = harness.run("17654151284", "kyoto-hills")

    assert result.returncode != 0
    assert "Refusing to replace existing share share-kyoto-hills" in result.stderr
    assert "wrangler" not in harness.recorded()
    assert "--location" not in harness.recorded()


def test_publish_refuses_when_the_share_cannot_be_checked(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="000", curl_exit=6)

    result = harness.run("17654151284", "kyoto-hills", "--replace-existing")

    assert result.returncode != 0
    assert "refusing to publish" in result.stderr
    assert "wrangler" not in harness.recorded()


def test_publish_replaces_an_existing_share_only_when_asked(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="200")

    result = harness.run("17654151284", "kyoto-hills", "--replace-existing")

    assert result.returncode == 0, result.stderr
    assert "npx wrangler pages deploy dist --project-name=godiesel --branch=share-kyoto-hills" in harness.recorded()


def test_publish_deploys_static_files_only_from_a_clean_stage(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="404")

    result = harness.run("17654151284", "kyoto-hills")

    assert result.returncode == 0, result.stderr
    recorded = harness.recorded()
    assert "wrangler-cwd-entries=dist \n" in recorded
    assert "validate-route-microsite.mjs 17654151284 stage " in recorded


def test_public_publish_requires_the_provider_key_and_a_dry_run_does_not(tmp_path: Path):
    published = PublishHarness(tmp_path / "publish")
    assert published.run("17654151284", "kyoto-hills").returncode == 0
    assert "make-dist require_key=1 slug=17654151284" in published.recorded()

    dry = PublishHarness(tmp_path / "dry")
    result = dry.run("17654151284", "kyoto-hills", "--dry-run")
    assert result.returncode == 0, result.stderr
    assert "make-dist require_key=0 slug=17654151284" in dry.recorded()
    assert "curl" not in dry.recorded()
    assert "wrangler" not in dry.recorded()


def route_cli_harness(tmp_path: Path):
    checkout = tmp_path / "checkout"
    scripts = checkout / "scripts"
    scripts.mkdir(parents=True)
    shutil.copy2(ROOT / "scripts" / "route.sh", scripts / "route.sh")
    calls = tmp_path / "calls.log"
    executable(
        scripts / "publish-route-microsite.sh",
        f"#!/bin/bash\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done > {calls}\n",
    )
    # A stand-in for route_status.py: always publishable, records the slug.
    (checkout / "route_status.py").write_text(
        "import sys\n"
        "def route_status(root, slug):\n"
        "    return {'publishable': True}\n"
        "if __name__ == '__main__':\n"
        "    print('status', sys.argv[1:])\n",
        encoding="utf-8",
    )
    return checkout, calls


def test_publish_slug_is_never_executed_as_python(tmp_path: Path):
    checkout, calls = route_cli_harness(tmp_path)
    marker = checkout / "INJECTED"
    # Harmless payload: if the slug were spliced into Python source it would
    # close the string literal and create a marker file.
    slug = "x'); open('INJECTED', 'w').write('1'); ('"

    subprocess.run(
        [str(checkout / "scripts" / "route.sh"), "publish", slug, "kyoto-hills"],
        cwd=checkout, capture_output=True, text=True, check=False,
    )

    assert not marker.exists()
    assert calls.read_text(encoding="utf-8").splitlines()[0] == slug


def test_route_publish_passes_replacement_approval_through(tmp_path: Path):
    checkout, calls = route_cli_harness(tmp_path)

    result = subprocess.run(
        [str(checkout / "scripts" / "route.sh"), "publish", "17654151284", "kyoto-hills", "--replace-existing"],
        cwd=checkout, capture_output=True, text=True, check=False,
    )

    assert result.returncode == 0, result.stderr
    assert calls.read_text(encoding="utf-8").splitlines() == [
        "17654151284", "kyoto-hills", "--replace-existing",
    ]


# The share validator and the app's strict detail parser
# (app/src/domain/route/detail-parse.ts) must agree on elevation: a share the
# app can open must validate, and one it would reject must not. The date rule
# is a publication rule and deliberately stricter than the parser, which takes
# any string: a real calendar day, or "" on a discovered route only.
def synthetic_route(**overrides):
    points = [
        {"lat": 49.0, "lng": -114.0, "elev": 1200.0, "d": 0.0},
        {"lat": 49.001, "lng": -114.0, "elev": 1210.0, "d": 500.0},
        {"lat": 49.002, "lng": -114.0, "elev": 1220.0, "d": 1000.0},
    ]
    route = {
        "slug": "900000001",
        "activity_id": "900000001",
        "lifecycle": "completed",
        "name": "Synthetic Ridge",
        "subtitle": "Synthetic ridge run",
        "activity_name": "Synthetic ridge run",
        "region": "Synthetic Region",
        "date": "2026-05-04",
        "type": "Run",
        "description": "A synthetic route used only by tests.",
        "completion_rule": "Complete a 1.0 km run in Synthetic Region.",
        "effort_tier": "Easy",
        "theme": "Wander Run",
        "xp": 60,
        "distance_km": 1.0,
        "elevation_gain_m": 20,
        "center_lat": 49.001,
        "center_lng": -114.0,
        "mid_idx": 1,
        "route": points,
        "replay": {
            "replay_eligible": True,
            "best_in_earth": False,
            "geometry_status": "ready",
            "mode": "atlas",
            "point_count": len(points),
        },
    }
    route.update(overrides)
    return route


def without_elevation(**overrides):
    route = synthetic_route(elevation_status="unavailable", elevation_gain_m=None)
    route["route"] = [{**point, "elev": None} for point in route["route"]]
    route.update(overrides)
    return route


def validate_source(tmp_path: Path, route: dict):
    checkout = tmp_path / "checkout"
    (checkout / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        ROOT / "scripts" / "validate-route-microsite.mjs",
        checkout / "scripts" / "validate-route-microsite.mjs",
    )
    routes = checkout / "app" / "public" / "data" / "routes"
    routes.mkdir(parents=True, exist_ok=True)
    (routes / f"{route['slug']}.json").write_text(json.dumps(route), encoding="utf-8")
    return subprocess.run(
        ["node", str(checkout / "scripts" / "validate-route-microsite.mjs"), route["slug"], "source"],
        cwd=checkout, capture_output=True, text=True, check=False,
    )


def null_elevation_at_point(index: int, **overrides):
    route = synthetic_route(**overrides)
    route["route"][index] = {**route["route"][index], "elev": None}
    return route


ACCEPTED_SHARES = {
    "recorded route without a status field": synthetic_route(),
    "explicitly recorded elevation": synthetic_route(elevation_status="recorded"),
    "route whose source has no elevation": without_elevation(),
    # The parser keeps a finite point elevation on an unavailable route; only
    # a null one is coerced. The gain is still required to be null.
    "unavailable route with finite point elevations": without_elevation(
        route=synthetic_route()["route"]),
    "discovered route with no date": synthetic_route(lifecycle="discovered", date=""),
    "discovered route with no date or elevation": without_elevation(lifecycle="discovered", date=""),
}

REJECTED_SHARES = {
    "numeric gain on an unavailable route": (
        without_elevation(elevation_gain_m=0), "elevation_gain_m"),
    "missing gain on an unavailable route": (
        {k: v for k, v in without_elevation().items() if k != "elevation_gain_m"}, "elevation_gain_m"),
    "null gain on a recorded route": (synthetic_route(elevation_gain_m=None), "elevation_gain_m"),
    "missing gain on a recorded route": (
        {k: v for k, v in synthetic_route().items() if k != "elevation_gain_m"}, "elevation_gain_m"),
    "negative gain on a recorded route": (synthetic_route(elevation_gain_m=-1), "elevation_gain_m"),
    "string gain on a recorded route": (synthetic_route(elevation_gain_m="20"), "elevation_gain_m"),
    "unknown elevation status": (synthetic_route(elevation_status="estimated"), "elevation_status"),
    "null elev on a recorded route": (null_elevation_at_point(1), "route point 1"),
    "null elev on an explicitly recorded route": (
        null_elevation_at_point(0, elevation_status="recorded"), "route point 0"),
    "string elev on an unavailable route": (
        {**without_elevation(), "route": [{**p, "elev": "?"} for p in without_elevation()["route"]]},
        "route point 0"),
    "completed route with no date": (synthetic_route(date=""), "date"),
    "impossible calendar date": (synthetic_route(date="2026-02-30"), "date"),
    "unparsed date text": (synthetic_route(lifecycle="discovered", date="spring"), "date"),
}


@pytest.mark.parametrize("label", ACCEPTED_SHARES)
def test_validator_accepts_a_share_the_app_can_open(tmp_path: Path, label: str):
    route = ACCEPTED_SHARES[label]
    result = validate_source(tmp_path, route)

    assert result.returncode == 0, result.stderr
    assert f"Validated {route['slug']} (source)." in result.stdout


@pytest.mark.parametrize("label", REJECTED_SHARES)
def test_validator_rejects_elevation_and_dates_the_app_cannot_trust(tmp_path: Path, label: str):
    route, reason = REJECTED_SHARES[label]
    result = validate_source(tmp_path, route)

    assert result.returncode != 0, f"{label} was accepted"
    assert reason in result.stderr, result.stderr
