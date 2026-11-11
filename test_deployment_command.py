"""Deployment and route-share guards.

Every test runs the real script against stubbed tools on PATH. Nothing here
contacts Cloudflare: `npx`, `curl`, `node`, and the build are fakes that record
how they were called.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path


ROOT = Path(__file__).parent
PRODUCTION_DEPLOY_COMMAND = (
    "npx wrangler pages deploy dist --project-name=godiesel --branch=production"
)


def executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


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
