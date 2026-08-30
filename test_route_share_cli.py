import json
import os
from pathlib import Path
import shutil
import subprocess


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


def test_preview_runs_the_route_only_dry_run_before_starting_vite(tmp_path: Path):
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
    executable(
        bin_dir / "npm",
        f"#!/bin/bash\nprintf 'npm slug=%s args=%s\\n' \"$VITE_SINGLE_ROUTE_SLUG\" \"$*\" >> {calls}\n",
    )
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
    assert "npm slug=gpx-preview" in recorded
    assert "wrangler" not in recorded
    assert "#/routes/gpx-preview" in completed.stdout
    assert "#/replay/gpx-preview" in completed.stdout


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
