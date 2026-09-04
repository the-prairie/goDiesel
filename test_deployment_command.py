import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).parent


def test_canonical_production_deploy_is_not_exposed_before_phase_five():
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

    assert documented_commands == []
    assert printed_commands == []
    assert "Phase 5 release capability" in "\n".join(readme_lines)
    assert "Phase 5 release capability" in "\n".join(packaging_lines)


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


def test_live_pipeline_requires_independent_stable_alias_authority():
    pipeline = (ROOT / "scripts/verify-live-pipeline.sh").read_text(encoding="utf-8")

    assert "GODIESEL_PIPELINE_TARGET_AUTHORITY" in pipeline
    assert "GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY" in pipeline
    assert "./scripts/publish-live-pipeline-proof.sh" in pipeline


def test_live_pipeline_repeated_target_requires_explicit_replacement_intent(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    wrapper = scripts / "publish-live-pipeline-proof.sh"
    shutil.copy2(ROOT / "scripts/publish-live-pipeline-proof.sh", wrapper)
    wrapper.chmod(0o755)
    publisher = scripts / "publish-route-microsite.sh"
    publisher.write_text(
        '#!/bin/bash\nprintf "%s\\n" "$@" > "$GODIESEL_TEST_CAPTURE"\n',
        encoding="utf-8",
    )
    publisher.chmod(0o755)
    environment = os.environ.copy()
    environment.update(
        {
            "GODIESEL_PIPELINE_SHARE_NAME": "pipeline-proof",
            "GODIESEL_PIPELINE_TARGET_AUTHORITY": "pipeline-proof",
            "GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY": "pipeline-proof",
            "GODIESEL_TEST_CAPTURE": str(tmp_path / "arguments.txt"),
        }
    )

    missing_intent = subprocess.run(
        [str(wrapper)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    publisher_was_not_called = not (tmp_path / "arguments.txt").exists()
    environment["GODIESEL_PIPELINE_REPLACE_EXISTING"] = "1"
    repeated = subprocess.run(
        [str(wrapper)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    repeated_arguments = (
        (tmp_path / "arguments.txt").read_text(encoding="utf-8").splitlines()
    )

    assert missing_intent.returncode == 2
    assert publisher_was_not_called
    assert repeated.returncode == 0
    assert repeated_arguments[-1] == "--replace-existing"
    assert repeated_arguments[:6] == [
        "3519505225411091950",
        "pipeline-proof",
        "--authorize-target",
        "pipeline-proof",
        "--authorize-replacement",
        "pipeline-proof",
    ]
