"""Deployment and route-share guards.

Every test runs the real script against stubbed tools on PATH. Nothing here
contacts Cloudflare: `npx`, `curl`, `node`, and the build are fakes that record
how they were called.
"""

import json
import os
import signal
import shutil
import stat
import subprocess
import time
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

    def __init__(
        self,
        tmp_path: Path,
        public_status: str = "404",
        curl_exit: int = 0,
        write_manifest: bool = True,
        manifest_slug: str | None = None,
        etag: str | None = None,
    ):
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
        copy_manifest_tool(self.root)
        manifest_write = (
            'node scripts/dist-manifest.mjs write --scope single-route '
            f'--slug "{manifest_slug or "$GODIESEL_SINGLE_ROUTE_SLUG"}" --git-sha fixture --dirty false'
            if write_manifest else ":"
        )
        executable(
            self.root / "make-dist.sh",
            f"""#!/bin/bash
printf 'make-dist require_key=%s slug=%s\\n' "$GODIESEL_REQUIRE_PROVIDER_KEY" "$GODIESEL_SINGLE_ROUTE_SLUG" >> {self.calls}
rm -f .dist-manifest.json
mkdir -p dist && printf '<html></html>' > dist/index.html
{manifest_write}
""",
        )
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        executable(
            bin_dir / "node",
            node_stub(self.calls) + """
if [[ -n "${STUB_STAGE_TAMPER:-}" && "$2" == "17654151284" && "$3" == "stage" ]]; then
  printf 'tampered' >> "$4/dist/index.html"
fi
if [[ "$1" == "scripts/smoke-single-route-microsite.mjs" ]]; then
  exit "${STUB_SMOKE_EXIT:-0}"
fi
""",
        )
        etag_header = f"etag: {etag}\\r\\n" if etag else ""
        executable(
            bin_dir / "curl",
            f"""#!/bin/bash
printf 'curl %s\\n' "$*" >> {self.calls}
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--dump-header" ]]; then
    printf 'HTTP/2 {public_status}\\r\\n{etag_header}\\r\\n' > "$2"
  fi
  shift
done
printf '{public_status}'
exit {curl_exit}
""",
        )
        executable(
            bin_dir / "npx",
            f"""#!/bin/bash
printf 'npx %s\\n' "$*" >> {self.calls}
if [[ "$1" == "wrangler" ]]; then
  printf 'wrangler-cwd-entries=%s\\n' "$(ls -A | tr '\\n' ' ')" >> {self.calls}
  exit "${{STUB_WRANGLER_EXIT:-0}}"
fi
""",
        )
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{bin_dir}:{self.environment['PATH']}"

    def run(self, *arguments: str, **extra: str):
        return subprocess.run(
            [str(self.root / "scripts" / "publish-route-microsite.sh"), *arguments],
            cwd=self.root, env=dict(self.environment, **extra),
            capture_output=True, text=True, check=False,
        )

    def receipts(self) -> list[Path]:
        return sorted((self.root / ".route-share" / "publish").glob("*.json"))

    def receipt(self) -> dict:
        (only,) = self.receipts()
        return json.loads(only.read_text(encoding="utf-8"))

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


# --- dist identity (.dist-manifest.json) -----------------------------------

REAL_NODE = shutil.which("node")
GUARDED_PRODUCTION_DEPLOY_COMMAND = (
    "node scripts/dist-manifest.mjs check --scope full && " + PRODUCTION_DEPLOY_COMMAND
)


def copy_manifest_tool(checkout: Path) -> None:
    source = ROOT / "scripts" / "dist-manifest.mjs"
    if source.exists():
        (checkout / "scripts").mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, checkout / "scripts" / "dist-manifest.mjs")


def node_stub(calls: Path) -> str:
    """Record every node call; run the real manifest tool; fail on request."""
    return f"""#!/bin/bash
if [[ "$1" == "scripts/dist-manifest.mjs" ]]; then
  exec {REAL_NODE} "$@"
fi
printf 'node %s\\n' "$*" >> {calls}
if [[ -n "${{STUB_NODE_FAIL:-}}" && "$*" == *"$STUB_NODE_FAIL"* ]]; then
  exit 1
fi
"""


class DistHarness:
    """The real make-dist.sh in a throwaway checkout, with npm and node stubbed."""

    def __init__(self, tmp_path: Path):
        self.root = tmp_path / "checkout"
        (self.root / "scripts").mkdir(parents=True)
        (self.root / "app").mkdir()
        shutil.copy2(ROOT / "make-dist.sh", self.root / "make-dist.sh")
        copy_manifest_tool(self.root)
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        (self.root / ".gitignore").write_text("dist/\napp/dist/\n.dist-manifest.json\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid",
             "commit", "-q", "-m", "fixture"],
            cwd=self.root, check=True,
        )
        self.calls = tmp_path / "calls.log"
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        executable(
            bin_dir / "npm",
            f"""#!/bin/bash
printf 'npm %s\\n' "$*" >> {self.calls}
if [[ "$*" == "--prefix app run build" ]]; then
  rm -rf app/dist
  mkdir -p app/dist/assets app/dist/data/routes
  printf '<html></html>' > app/dist/index.html
  printf 'console.log(1)' > app/dist/assets/index.js
  printf '{{}}' > app/dist/data/routes/17654151284.json
  printf '{{}}' > app/dist/data/routes/999.json
  printf '{{}}' > app/dist/data/routes-index.json
fi
if [[ "$*" == "--prefix app run test:bundle" && -n "${{STUB_BUNDLE_HANG:-}}" ]]; then
  touch "$STUB_BUNDLE_HANG"
  sleep 30
fi
""",
        )
        executable(bin_dir / "node", node_stub(self.calls))
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{bin_dir}:{self.environment['PATH']}"
        self.environment.pop("GODIESEL_SINGLE_ROUTE_SLUG", None)

    @property
    def manifest_path(self) -> Path:
        return self.root / ".dist-manifest.json"

    def manifest(self) -> dict:
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def build(self, slug: str | None = None, **extra: str):
        environment = dict(self.environment, **extra)
        if slug:
            environment["GODIESEL_SINGLE_ROUTE_SLUG"] = slug
        return subprocess.run(
            [str(self.root / "make-dist.sh")], cwd=self.root, env=environment,
            capture_output=True, text=True, check=False,
        )

    def check(self, *arguments: str):
        return subprocess.run(
            [REAL_NODE, "scripts/dist-manifest.mjs", "check", *arguments],
            cwd=self.root, capture_output=True, text=True, check=False,
        )


def test_printed_production_deploy_command_is_guarded_by_the_manifest_check():
    lines = (ROOT / "make-dist.sh").read_text(encoding="utf-8").splitlines()
    guarded = [line.strip() for line in lines if GUARDED_PRODUCTION_DEPLOY_COMMAND in line]

    assert len(guarded) == 1
    assert guarded[0].startswith('echo "  node scripts/dist-manifest.mjs check')


def test_full_build_records_its_identity_outside_dist(tmp_path: Path):
    harness = DistHarness(tmp_path)

    result = harness.build()

    assert result.returncode == 0, result.stderr
    manifest = harness.manifest()
    assert manifest["scope"] == "full"
    assert manifest["slug"] is None
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=harness.root,
                          capture_output=True, text=True, check=True).stdout.strip()
    assert manifest["git_sha"] == head
    assert manifest["dirty"] is False
    assert manifest["file_count"] == sum(1 for p in (harness.root / "dist").rglob("*") if p.is_file())
    assert manifest["content_digest"].startswith("sha256:")
    assert manifest["built_at"].endswith("Z")
    assert not list((harness.root / "dist").rglob("*manifest*"))
    assert GUARDED_PRODUCTION_DEPLOY_COMMAND in result.stdout
    assert harness.check("--scope", "full").returncode == 0


def test_single_route_build_cannot_pass_the_production_check(tmp_path: Path):
    harness = DistHarness(tmp_path)

    result = harness.build("17654151284")

    assert result.returncode == 0, result.stderr
    assert harness.manifest()["scope"] == "single-route"
    assert harness.manifest()["slug"] == "17654151284"
    assert "npx wrangler pages deploy" not in result.stdout
    assert "./scripts/publish-route-microsite.sh 17654151284 <share-name>" in result.stdout
    refused = harness.check("--scope", "full")
    assert refused.returncode != 0
    assert "single-route" in refused.stderr
    assert harness.check("--scope", "single-route", "--slug", "17654151284").returncode == 0
    assert harness.check("--scope", "single-route", "--slug", "999").returncode != 0


def test_failed_build_leaves_dist_without_a_manifest(tmp_path: Path):
    harness = DistHarness(tmp_path)
    assert harness.build().returncode == 0
    assert harness.manifest_path.exists()

    # Scoping fails after dist/ was replaced: a partial dist with no identity.
    result = harness.build("17654151284", STUB_NODE_FAIL="scope-route-microsite.mjs")

    assert result.returncode != 0
    assert (harness.root / "dist" / "index.html").exists()
    assert not harness.manifest_path.exists()
    refused = harness.check("--scope", "full")
    assert refused.returncode != 0
    assert "no dist manifest" in refused.stderr


def test_interrupted_build_removes_the_old_manifest_first(tmp_path: Path):
    harness = DistHarness(tmp_path)
    assert harness.build().returncode == 0
    assert harness.manifest_path.exists()
    started = tmp_path / "bundle-started"
    environment = dict(harness.environment, STUB_BUNDLE_HANG=str(started))

    process = subprocess.Popen(
        [str(harness.root / "make-dist.sh")], cwd=harness.root, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    deadline = time.monotonic() + 10
    while not started.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert started.exists()
    os.killpg(process.pid, signal.SIGINT)
    process.wait(timeout=10)

    assert process.returncode != 0
    assert not harness.manifest_path.exists()
    assert harness.check("--scope", "full").returncode != 0


def test_tampering_with_dist_after_the_build_is_detected(tmp_path: Path):
    harness = DistHarness(tmp_path)
    assert harness.build().returncode == 0

    # Same size, different bytes.
    (harness.root / "dist" / "index.html").write_text("<html></htm!>", encoding="utf-8")
    changed = harness.check("--scope", "full")
    assert changed.returncode != 0
    assert "does not match" in changed.stderr

    assert harness.build().returncode == 0
    (harness.root / "dist" / "extra.txt").write_text("x", encoding="utf-8")
    added = harness.check("--scope", "full")
    assert added.returncode != 0
    assert "does not match" in added.stderr


def test_manifest_check_can_verify_a_copied_tree(tmp_path: Path):
    harness = DistHarness(tmp_path)
    assert harness.build("17654151284").returncode == 0
    stage = tmp_path / "stage"
    shutil.copytree(harness.root / "dist", stage / "dist")

    assert harness.check("--scope", "single-route", "--slug", "17654151284",
                         "--dist", str(stage / "dist")).returncode == 0
    (stage / "dist" / "robots.txt").unlink()
    assert harness.check("--scope", "single-route", "--slug", "17654151284",
                         "--dist", str(stage / "dist")).returncode != 0


# --- publish: manifest guard and receipts -----------------------------------


def test_publish_refuses_a_dist_without_a_manifest(tmp_path: Path):
    harness = PublishHarness(tmp_path, write_manifest=False)

    result = harness.run("17654151284", "kyoto-hills")

    assert result.returncode != 0
    assert "no dist manifest" in result.stderr
    assert "wrangler" not in harness.recorded()
    assert harness.receipts() == []


def test_publish_refuses_a_dist_built_for_another_route(tmp_path: Path):
    harness = PublishHarness(tmp_path, manifest_slug="999")

    result = harness.run("17654151284", "kyoto-hills")

    assert result.returncode != 0
    assert "built for route 999" in result.stderr
    assert "wrangler" not in harness.recorded()


def test_publish_refuses_a_stage_that_differs_from_the_manifest(tmp_path: Path):
    harness = PublishHarness(tmp_path)

    result = harness.run("17654151284", "kyoto-hills", STUB_STAGE_TAMPER="1")

    assert result.returncode != 0
    assert "does not match its manifest" in result.stderr
    assert "wrangler" not in harness.recorded()


def test_dry_run_writes_no_publish_receipt(tmp_path: Path):
    harness = PublishHarness(tmp_path)

    assert harness.run("17654151284", "kyoto-hills", "--dry-run").returncode == 0
    assert harness.receipts() == []


def test_publish_receipt_follows_a_new_share_to_a_passing_smoke(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="404")

    result = harness.run("17654151284", "kyoto-hills")

    assert result.returncode == 0, result.stderr
    (path,) = harness.receipts()
    assert path.name.startswith("kyoto-hills-") and path.name.endswith("Z.json")
    receipt = harness.receipt()
    assert receipt["phase"] == "smoke-passed"
    assert [entry["phase"] for entry in receipt["phases"]] == ["validated", "deployed", "smoke-passed"]
    assert all(entry["at"].endswith("Z") for entry in receipt["phases"])
    assert receipt["share_name"] == "kyoto-hills"
    assert receipt["branch"] == "share-kyoto-hills"
    assert receipt["public_url"] == "https://share-kyoto-hills.godiesel.pages.dev/"
    assert receipt["route_slug"] == "17654151284"
    manifest = json.loads((harness.root / ".dist-manifest.json").read_text(encoding="utf-8"))
    assert receipt["dist_content_digest"] == manifest["content_digest"]
    assert receipt["replaced"] is None
    assert str(path.relative_to(harness.root)) in result.stdout


def test_publish_receipt_records_what_a_replacement_replaced(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="200", etag='W/"abc-1"')

    result = harness.run("17654151284", "kyoto-hills", "--replace-existing")

    assert result.returncode == 0, result.stderr
    replaced = harness.receipt()["replaced"]
    assert replaced["alias"] == "share-kyoto-hills"
    assert replaced["public_url"] == "https://share-kyoto-hills.godiesel.pages.dev/"
    assert replaced["previous_http_status"] == "200"
    assert replaced["previous_etag"] == 'W/"abc-1"'
    assert replaced["previous_deployment_id"] is None
    assert "not observable" in replaced["previous_deployment_note"]
    assert replaced["previous_observed_at"].endswith("Z")


def test_failed_smoke_names_the_receipt_and_the_broken_live_share(tmp_path: Path):
    harness = PublishHarness(tmp_path, public_status="200", etag='"v1"')

    result = harness.run("17654151284", "kyoto-hills", "--replace-existing", STUB_SMOKE_EXIT="3")

    assert result.returncode != 0
    receipt = harness.receipt()
    assert receipt["phase"] == "smoke-failed"
    assert [entry["phase"] for entry in receipt["phases"]] == ["validated", "deployed", "smoke-failed"]
    assert receipt["smoke_exit_code"] == 3
    (path,) = harness.receipts()
    assert str(path.relative_to(harness.root)) in result.stderr
    assert "https://share-kyoto-hills.godiesel.pages.dev/ is now serving the failed bundle" in result.stderr
    assert "No automatic rollback" in result.stderr
    assert "Published route guide" not in result.stdout


def test_failed_deploy_is_recorded_in_the_receipt(tmp_path: Path):
    harness = PublishHarness(tmp_path)

    result = harness.run("17654151284", "kyoto-hills", STUB_WRANGLER_EXIT="1")

    assert result.returncode != 0
    receipt = harness.receipt()
    assert receipt["phase"] == "deploy-failed"
    assert receipt["deploy_exit_code"] == 1
    assert "smoke-single-route-microsite" not in harness.recorded()


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
