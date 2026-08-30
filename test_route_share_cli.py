import json
import os
from pathlib import Path
import shutil
import subprocess

from route_create import apply_proposal, propose_request


ROOT = Path(__file__).parent


def executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def test_route_cli_proposes_an_existing_route_as_json(tmp_path: Path):
    request = tmp_path / "request.json"
    request.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "existing_slug": "3519505225411091950",
                "proposed_share_name": "appian-way-review",
            }
        ),
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["./scripts/route.sh", "propose", "--request", str(request)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    proposal = json.loads(completed.stdout)
    assert proposal["operation"] == "update"
    assert proposal["route_spec"]["activity_id"] == "3519505225411091950"
    assert proposal["proposed_share_name"] == "appian-way-review"


def test_preview_runs_the_route_only_dry_run_before_starting_static_server(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts/route-preview.sh", scripts / "route-preview.sh")
    (scripts / "route-preview.sh").chmod(0o755)
    calls = tmp_path / "calls.log"
    executable(
        scripts / "publish-route-microsite.sh",
        f"#!/bin/bash\nprintf 'publish %s\\n' \"$*\" >> {calls}\n",
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    executable(bin_dir / "python3", "#!/bin/bash\nexit 0\n")
    executable(bin_dir / "node", f"#!/bin/bash\nprintf 'node args=%s\\n' \"$*\" >> {calls}\n")
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"

    completed = subprocess.run(
        [str(scripts / "route-preview.sh"), "gpx-preview"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )

    recorded = calls.read_text(encoding="utf-8")
    assert "publish gpx-preview check-only --dry-run" in recorded
    assert "node args=scripts/serve-route-preview.mjs dist 127.0.0.1" in recorded
    assert "wrangler" not in recorded
    assert "#/routes/gpx-preview" in completed.stdout
    assert "#/replay/gpx-preview" in completed.stdout


def test_preview_refuses_blocked_source_health_before_starting_server(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts/route-preview.sh", scripts / "route-preview.sh")
    (scripts / "route-preview.sh").chmod(0o755)
    executable(scripts / "publish-route-microsite.sh", "#!/bin/bash\nexit 0\n")
    calls = tmp_path / "calls.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    executable(bin_dir / "python3", "#!/bin/bash\nexit 1\n")
    executable(bin_dir / "node", f"#!/bin/bash\nprintf 'node called\\n' >> {calls}\n")
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"

    completed = subprocess.run(
        [str(scripts / "route-preview.sh"), "gpx-preview"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert completed.returncode != 0
    assert "durable source or generated route health is blocked" in completed.stderr
    assert not calls.exists()


def test_publish_refuses_an_existing_share_without_explicit_replacement(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(
        ROOT / "scripts/publish-route-microsite.sh",
        scripts / "publish-route-microsite.sh",
    )
    (scripts / "publish-route-microsite.sh").chmod(0o755)
    executable(tmp_path / "make-dist.sh", "#!/bin/bash\nexit 0\n")
    (tmp_path / "app").mkdir()
    calls = tmp_path / "calls.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    executable(bin_dir / "node", "#!/bin/bash\nexit 0\n")
    executable(bin_dir / "curl", "#!/bin/bash\nprintf '200'\n")
    executable(
        bin_dir / "npx",
        f"""#!/bin/bash
printf '%s\n' "$*" >> {calls}
if [[ "$*" == *"wrangler pages deployment list"* ]]; then
  printf '[{{"Branch":"share-existing"}}]\n'
fi
exit 0
""",
    )
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"

    completed = subprocess.run(
        [str(scripts / "publish-route-microsite.sh"), "gpx-preview", "existing"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert completed.returncode != 0
    assert "Refusing to replace existing share" in completed.stderr
    assert "wrangler pages deploy dist" not in calls.read_text(encoding="utf-8")


def test_microsite_validator_redacts_checkout_paths():
    completed = subprocess.run(
        ["node", "scripts/validate-route-microsite.mjs", "gpx-not-present", "source"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert completed.returncode != 0
    assert "gpx-not-present.json" in completed.stderr
    assert str(ROOT) not in completed.stderr


def test_route_microsite_scoping_keeps_only_referenced_media(tmp_path: Path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(
        ROOT / "scripts/scope-route-microsite.mjs",
        scripts / "scope-route-microsite.mjs",
    )
    route_file = tmp_path / "dist/data/routes/gpx-preview.json"
    route_file.parent.mkdir(parents=True)
    route_file.write_text(
        json.dumps(
            {
                "slug": "gpx-preview",
                "annotations": [
                    {
                        "media": {
                            "url": "media/gpx-preview/keep.jpg",
                            "thumb_url": "media/gpx-preview/keep-thumb.jpg",
                        }
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    for relative in (
        "media/gpx-preview/keep.jpg",
        "media/gpx-preview/keep-thumb.jpg",
        "media/unrelated/private.jpg",
    ):
        app_file = tmp_path / "app/dist" / relative
        app_file.parent.mkdir(parents=True, exist_ok=True)
        app_file.write_bytes(relative.encode())
        dist_file = tmp_path / "dist" / relative
        dist_file.parent.mkdir(parents=True, exist_ok=True)
        dist_file.write_bytes(relative.encode())

    subprocess.run(
        ["node", str(scripts / "scope-route-microsite.mjs"), "gpx-preview"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )

    built_media = sorted(
        path.relative_to(tmp_path / "dist").as_posix()
        for path in (tmp_path / "dist/media").rglob("*")
        if path.is_file()
    )
    assert built_media == [
        "media/gpx-preview/keep-thumb.jpg",
        "media/gpx-preview/keep.jpg",
    ]


def test_prompt_to_preview_workflow_is_repeatable_and_never_publishes(tmp_path: Path):
    (tmp_path / "quests.json").write_text('{"routes": []}\n', encoding="utf-8")
    proposal = propose_request(
        {
            "schema_version": 1,
            "gpx_path": str(ROOT / "tests/fixtures/routes/timed-ridge.gpx"),
            "activity_type": "Run",
            "route_name": "Acceptance Ridge",
            "region": "Kananaskis, Alberta",
            "source_description": "A route fixture for the complete workflow.",
            "desired_route_id": "gpx-acceptance-ridge",
        },
        tmp_path,
    )
    first = apply_proposal(
        proposal,
        tmp_path,
        rebuild=lambda: {"publishable": True},
    )
    second = apply_proposal(
        proposal,
        tmp_path,
        rebuild=lambda: {"publishable": True},
    )

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(ROOT / "scripts/route-preview.sh", scripts / "route-preview.sh")
    (scripts / "route-preview.sh").chmod(0o755)
    calls = tmp_path / "calls.log"
    executable(
        scripts / "publish-route-microsite.sh",
        f"#!/bin/bash\nprintf 'publish %s\\n' \"$*\" >> {calls}\n",
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    executable(bin_dir / "python3", "#!/bin/bash\nexit 0\n")
    executable(
        bin_dir / "node",
        f"#!/bin/bash\nprintf 'node %s\\n' \"$*\" >> {calls}\n",
    )
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"
    preview = subprocess.run(
        [str(scripts / "route-preview.sh"), "gpx-acceptance-ridge"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )

    config = json.loads((tmp_path / "quests.json").read_text(encoding="utf-8"))
    recorded = calls.read_text(encoding="utf-8")
    assert first["result"] == "created"
    assert second["result"] == "already_applied"
    assert len(config["routes"]) == 1
    assert "publish gpx-acceptance-ridge check-only --dry-run" in recorded
    assert "wrangler" not in recorded
    assert "#/routes/gpx-acceptance-ridge" in preview.stdout
