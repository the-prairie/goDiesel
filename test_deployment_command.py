import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).parent
PRODUCTION_DEPLOY_COMMAND = (
    "npx wrangler pages deploy dist --project-name=godiesel --branch=production"
)


def test_canonical_pages_deploy_targets_the_production_branch():
    readme_lines = (ROOT / "README.md").read_text(encoding="utf-8").splitlines()
    packaging_lines = (ROOT / "make-dist.sh").read_text(encoding="utf-8").splitlines()

    documented_commands = [
        line.strip()
        for line in readme_lines
        if line.strip().startswith("npx wrangler pages deploy dist")
    ]
    printed_commands = [
        line.strip()
        for line in packaging_lines
        if "Deploy with: npx wrangler pages deploy dist" in line
    ]

    assert documented_commands == [PRODUCTION_DEPLOY_COMMAND]
    assert len(printed_commands) == 1
    assert PRODUCTION_DEPLOY_COMMAND in printed_commands[0]


def test_required_provider_key_rejects_a_keyless_build(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    checker = scripts / "check-provider-key.mjs"
    shutil.copy2(ROOT / "scripts" / "check-provider-key.mjs", checker)
    environment = os.environ.copy()
    environment.pop("GOOGLE_MAPS_API_KEY", None)
    environment.pop("VITE_GOOGLE_MAPS_API_KEY", None)
    environment["GODIESEL_REQUIRE_PROVIDER_KEY"] = "1"

    result = subprocess.run(
        ["node", str(checker)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "a Google Maps key is required" in result.stderr


def test_public_route_publish_requires_the_provider_key():
    publish_script = (ROOT / "scripts" / "publish-route-microsite.sh").read_text(
        encoding="utf-8"
    )

    assert 'REQUIRE_PROVIDER_KEY=1' in publish_script
    assert 'REQUIRE_PROVIDER_KEY=0' in publish_script
    assert 'GODIESEL_REQUIRE_PROVIDER_KEY="$REQUIRE_PROVIDER_KEY"' in publish_script
