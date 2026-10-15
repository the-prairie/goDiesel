import json
import importlib.util
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import pytest

from curation_publish import generated_paths, publish_annotations, publish_curation
from owner_publication import JOURNAL_NAME, recover_owner_publication


ROOT = Path(__file__).resolve().parent
NEW_CURATION = {"vibe": "New guide", "review_status": "draft"}
ANNOTATIONS = [{"id": "gate", "at_distance_m": 100, "kind": "note",
                "evidence": "hypothesis", "body": "A gate"}]


def publication_fixture(root):
    curation = {"vibe": "Old guide", "review_status": "draft"}
    route = {
        "slug": "one",
        "route": [{"d": 0}, {"d": 1000}],
        "curation": curation,
        "annotations": [],
        "lifecycle": "completed",
    }
    paths = generated_paths(root)
    paths["detail"].mkdir(parents=True)
    paths["manifest"].parent.mkdir(parents=True)
    (paths["detail"] / "one.json").write_text(json.dumps(route))
    (paths["detail"] / "other.json").write_text('{"slug":"other"}')
    paths["payload"].write_text(json.dumps({"generated_at": "old", "routes": [route]}))
    paths["manifest"].write_text(json.dumps({
        "generated_at": "old", "routes": [{"slug": "one", "guide_preview": curation}],
    }))
    (paths["manifest"].parent / "route-stats.json").write_text('{"route_count":2}')
    (root / "quests.json").write_text(json.dumps({"routes": [
        {"activity_id": "one", "status": "approved", "curation": curation},
        {"activity_id": "other", "status": "pending"},
    ]}))
    return paths


def published_bytes(root):
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)
    }


def test_second_generated_replacement_restores_previous_files(tmp_path):
    paths = publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    replace = os.replace
    failed = False

    def fail_once(source, destination):
        nonlocal failed
        if Path(destination) == paths["manifest"] and not failed:
            failed = True
            raise OSError("injected second replacement failure")
        return replace(source, destination)

    with patch("curation_publish.os.replace", side_effect=fail_once):
        with pytest.raises(OSError, match="injected second replacement failure"):
            publish_curation(tmp_path, "one", {"vibe": "New guide", "review_status": "draft"})

    assert failed
    assert published_bytes(tmp_path) == before


@pytest.mark.parametrize("publish,value", [(publish_curation, NEW_CURATION),
                                         (publish_annotations, ANNOTATIONS)])
@pytest.mark.parametrize("artifact", ["detail", "manifest", "payload"])
@pytest.mark.parametrize("failure", ["stage", "replace"])
def test_each_generated_write_failure_restores_every_artifact(tmp_path, publish, value, artifact, failure):
    paths = publication_fixture(tmp_path)
    target = paths[artifact] / "one.json" if artifact == "detail" else paths[artifact]
    before = published_bytes(tmp_path)
    real_replace, real_write = os.replace, Path.write_text
    fired = False

    def replace(source, destination):
        nonlocal fired
        if failure == "replace" and Path(destination) == target and not fired:
            fired = True
            raise OSError("injected generated failure")
        return real_replace(source, destination)

    def write(path, content, *args, **kwargs):
        nonlocal fired
        if failure == "stage" and path == target.with_name(f".{target.name}.tmp") and not fired:
            fired = True
            real_write(path, "partial")
            raise OSError("injected generated failure")
        return real_write(path, content, *args, **kwargs)

    with patch("os.replace", replace), patch.object(Path, "write_text", write):
        with pytest.raises(OSError, match="injected generated failure"):
            publish(tmp_path, "one", value)
    assert fired
    assert published_bytes(tmp_path) == before
    assert not (tmp_path / JOURNAL_NAME).exists()
    assert not list(tmp_path.rglob("*.tmp"))


@pytest.fixture
def admin_server(tmp_path, monkeypatch, request):
    publication_fixture(tmp_path)
    inputs = tmp_path / "synthetic-inputs"
    inputs.mkdir()
    (inputs / "activities.csv").write_text("Activity Date,Filename,Distance\n")
    (tmp_path / ".geo_cache.json").write_text(json.dumps({
        "one": {"lat": None}, "other": {"lat": None},
    }))
    monkeypatch.setenv("GODIESEL_CHECKOUT_ROOT", str(tmp_path))
    monkeypatch.setenv("GODIESEL_DIESEL_DIARIES_ROOT", str(inputs))
    monkeypatch.setenv("GODIESEL_TRAVEL_ROOT", str(inputs))
    if getattr(request, "param", False):
        result = interrupt_publication(tmp_path, '''with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("interrupted invalid source")
    os._exit(19)''')
        assert result.returncode == 19, result.stderr
    spec = importlib.util.spec_from_file_location("isolated_owner_admin", ROOT / "admin.py")
    admin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(admin)
    server = ThreadingHTTPServer(("127.0.0.1", 0), admin.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield tmp_path, admin, f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def save_request(url, kind, value):
    request = urllib.request.Request(
        f"{url}/api/{kind}/save",
        data=json.dumps({"activity_id": "one", kind: value}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response)


@pytest.mark.parametrize("kind,value", [("curation", NEW_CURATION), ("annotations", ANNOTATIONS)])
@pytest.mark.parametrize("failure", ["write", "replace", "generated"])
def test_real_admin_failure_restores_source_and_generated_data(admin_server, kind, value, failure):
    root, admin, url = admin_server
    before = published_bytes(root)
    real_replace, real_write = os.replace, Path.write_text
    fired = False

    def replace(source, destination):
        nonlocal fired
        target = root / "quests.json" if failure == "replace" else generated_paths(root)["payload"]
        if failure != "write" and Path(destination) == target and not fired:
            fired = True
            raise OSError("injected Admin failure")
        return real_replace(source, destination)

    def write(path, content, *args, **kwargs):
        nonlocal fired
        if failure == "write" and path == root / "quests.json.tmp" and not fired:
            fired = True
            real_write(path, "partial")
            raise OSError("injected Admin failure")
        return real_write(path, content, *args, **kwargs)

    with patch("os.replace", replace), patch.object(Path, "write_text", write):
        status, body = save_request(url, kind, value)
    assert status == 500, body
    assert fired
    assert published_bytes(root) == before
    assert not admin.OWNER_MUTATION_LOCK.locked()
    assert not (root / JOURNAL_NAME).exists()


@pytest.mark.parametrize("kind,value", [("curation", NEW_CURATION), ("annotations", ANNOTATIONS)])
def test_real_admin_success_preserves_unrelated_routes(admin_server, kind, value):
    root, _, url = admin_server
    other_detail = (generated_paths(root)["detail"] / "other.json").read_bytes()
    other_source = json.loads((root / "quests.json").read_text())["routes"][1]
    status, body = save_request(url, kind, value)
    assert status == 200, body
    source = json.loads((root / "quests.json").read_text())["routes"]
    detail = json.loads((generated_paths(root)["detail"] / "one.json").read_text())
    payload = json.loads(generated_paths(root)["payload"].read_text())
    manifest = json.loads(generated_paths(root)["manifest"].read_text())
    assert source[0][kind] == detail[kind] == payload["routes"][0][kind] == body[kind]
    assert source[1] == other_source
    assert (generated_paths(root)["detail"] / "other.json").read_bytes() == other_detail
    assert payload["generated_at"] == manifest["generated_at"]
    assert not (root / JOURNAL_NAME).exists()


def test_late_full_rebuild_failure_restores_entire_dataset(admin_server, monkeypatch):
    root, admin, url = admin_server
    paths = generated_paths(root)
    (paths["detail"] / "one.json").unlink()
    before = published_bytes(root)

    def fail_build(command, **options):
        from owner_publication import TOKEN_ENV

        recover_owner_publication(root, inherited_token=options["env"][TOKEN_ENV])
        assert json.loads((root / "quests.json").read_text())["routes"][0]["curation"] == NEW_CURATION
        (paths["detail"] / "other.json").unlink()
        (paths["detail"] / "new.json").write_text("new data")
        paths["payload"].write_text("new payload")
        (paths["manifest"].parent / "route-stats.json").write_text("new stats")
        backup = root / "app/public/data/.route-generation-backup"
        backup.mkdir()
        (backup / "ready").touch()
        raise subprocess.CalledProcessError(1, command, stderr="late generator failure")

    monkeypatch.setattr(admin.subprocess, "run", fail_build)
    status, body = save_request(url, "curation", NEW_CURATION)
    assert status == 500, body
    assert published_bytes(root) == before
    assert not (root / "app/public/data/.route-generation-backup").exists()


def interrupt_publication(root, body):
    script = "\n".join([
        "import os, sys, pathlib",
        "from owner_publication import owner_publication, PublicationRecoveryError",
        "root=pathlib.Path(sys.argv[1])",
        body,
    ])
    return subprocess.run([sys.executable, "-c", script, str(root)], cwd=ROOT,
                          capture_output=True, text=True, check=False)


def test_interrupted_save_restores_source_files_existence_and_inner_backup(tmp_path):
    paths = publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    result = interrupt_publication(tmp_path, '''with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("partial source")
    (root / "app/public/data/routes/other.json").unlink()
    (root / "app/public/data/routes/new.json").write_text("partial generated data")
    backup=root / "app/public/data/.route-generation-backup"
    backup.mkdir()
    (backup / "ready").touch()
    os._exit(19)''')
    assert result.returncode == 19, result.stderr
    recover_owner_publication(tmp_path)
    assert published_bytes(tmp_path) == before
    assert not (tmp_path / JOURNAL_NAME).exists()
    assert not (tmp_path / "app/public/data/.route-generation-backup").exists()


def test_failed_recovery_retains_backup_and_can_be_retried(tmp_path):
    paths = publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    result = interrupt_publication(tmp_path, '''with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("partial source")
    os._exit(19)''')
    assert result.returncode == 19, result.stderr
    real_replace = os.replace

    def fail(source, destination):
        if Path(destination) == paths["payload"]:
            raise OSError("injected recovery failure")
        return real_replace(source, destination)

    with patch("os.replace", fail):
        with pytest.raises(OSError, match="injected recovery failure"):
            recover_owner_publication(tmp_path)
    assert (tmp_path / JOURNAL_NAME / "ready").exists()
    recover_owner_publication(tmp_path)
    assert published_bytes(tmp_path) == before


def test_committed_save_survives_interrupted_cleanup(tmp_path):
    publication_fixture(tmp_path)
    result = interrupt_publication(tmp_path, '''real_rename=pathlib.Path.rename
def fail(path, target):
    if pathlib.Path(path).name == ".owner-publication-backup" and (path / "committed").exists():
        os._exit(19)
    return real_rename(path, target)
pathlib.Path.rename=fail
with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("committed source")''')
    assert result.returncode == 19, result.stderr
    recover_owner_publication(tmp_path)
    assert (tmp_path / "quests.json").read_text() == "committed source"
    assert not (tmp_path / JOURNAL_NAME).exists()


def prepare_build_fixture(root):
    for source in ROOT.glob("*.py"):
        if not source.name.startswith("test_"):
            shutil.copy2(source, root / source.name)
    source_dir = root / "route_sources"
    source_dir.mkdir()
    (source_dir / "one.gpx").write_text('''<gpx version="1.1" creator="test"><trk><trkseg>
<trkpt lat="51" lon="-114"><ele>1000</ele></trkpt>
<trkpt lat="51.01" lon="-114"><ele>1010</ele></trkpt></trkseg></trk></gpx>''')
    config = json.loads((root / "quests.json").read_text())
    config["routes"][0].update({"source_gpx": "route_sources/one.gpx",
                                "activity_name": "Synthetic route", "activity_type": "Run",
                                "date": "2026-01-01", "region": "Calgary, AB"})
    (root / "quests.json").write_text(json.dumps(config))
    return config


def test_real_admin_full_rebuild_fallback(admin_server):
    root, _, url = admin_server
    prepare_build_fixture(root)
    (generated_paths(root)["detail"] / "one.json").unlink()
    status, body = save_request(url, "curation", NEW_CURATION)
    assert status == 200, body
    detail = json.loads((generated_paths(root)["detail"] / "one.json").read_text())
    assert detail["curation"] == NEW_CURATION
    assert detail["route"][-1]["d"] > 1000
    assert not (root / JOURNAL_NAME).exists()


@pytest.mark.parametrize("admin_server", [True], indirect=True)
def test_admin_startup_recovers_before_reading_source(admin_server):
    root, _, url = admin_server
    assert json.loads((root / "quests.json").read_text())["routes"][0]["curation"]["vibe"] == "Old guide"
    assert not (root / JOURNAL_NAME).exists()
    status, body = save_request(url, "curation", NEW_CURATION)
    assert status == 200, body


def test_standalone_generator_recovers_before_reading_source(tmp_path):
    publication_fixture(tmp_path)
    prepare_build_fixture(tmp_path)
    inputs = tmp_path / "synthetic-inputs"
    inputs.mkdir()
    (inputs / "activities.csv").write_text("Activity Date,Filename,Distance\n")
    source = (tmp_path / "quests.json").read_bytes()
    result = interrupt_publication(tmp_path, '''with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("interrupted invalid source")
    os._exit(19)''')
    assert result.returncode == 19, result.stderr
    build = subprocess.run([sys.executable, str(tmp_path / "build.py")], cwd=tmp_path,
                           env={**os.environ, "GODIESEL_DIESEL_DIARIES_ROOT": str(inputs),
                                "GODIESEL_TRAVEL_ROOT": str(inputs)},
                           capture_output=True, text=True, check=False)
    assert build.returncode == 0, build.stderr
    assert (tmp_path / "quests.json").read_bytes() == source
    detail = json.loads((generated_paths(tmp_path)["detail"] / "one.json").read_text())
    assert detail["curation"]["vibe"] == "Old guide"
    assert not (tmp_path / JOURNAL_NAME).exists()


def test_incomplete_snapshot_never_mutates_published_data(tmp_path):
    publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    result = interrupt_publication(tmp_path, '''import shutil
def stop(*args, **kwargs):
    os._exit(19)
shutil.copy2=stop
with owner_publication(root, include_source=True):
    raise AssertionError("must not reach publication")''')
    assert result.returncode == 19, result.stderr
    assert not (tmp_path / JOURNAL_NAME / "ready").exists()
    recover_owner_publication(tmp_path)
    assert published_bytes(tmp_path) == before


def test_cleanup_error_keeps_committed_data_and_retryable_journal(tmp_path):
    from owner_publication import owner_publication

    publication_fixture(tmp_path)
    rename = Path.rename

    def fail(path, target):
        if path.name == JOURNAL_NAME and (path / "committed").exists():
            raise OSError("injected cleanup failure")
        return rename(path, target)

    with patch.object(Path, "rename", fail):
        with owner_publication(tmp_path, include_source=True):
            (tmp_path / "quests.json").write_text("committed source")
    assert (tmp_path / JOURNAL_NAME / "committed").exists()
    recover_owner_publication(tmp_path)
    assert (tmp_path / "quests.json").read_text() == "committed source"


def test_existing_generator_recovery_blocks_a_new_owner_save(tmp_path):
    from owner_publication import owner_publication, PublicationRecoveryError

    publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    backup = tmp_path / "app/public/data/.route-generation-backup"
    backup.mkdir()
    (backup / "ready").touch()
    with pytest.raises(PublicationRecoveryError, match="generator recovery"):
        with owner_publication(tmp_path, include_source=True):
            raise AssertionError("must not start a new save")
    assert published_bytes(tmp_path) == before
    assert (backup / "ready").exists()


def test_nested_publication_cannot_silently_add_source_protection(tmp_path):
    from owner_publication import owner_publication

    publication_fixture(tmp_path)
    with owner_publication(tmp_path):
        with pytest.raises(RuntimeError, match="cannot add source protection"):
            with owner_publication(tmp_path, include_source=True):
                raise AssertionError("must not enter unprotected source save")


@pytest.mark.parametrize("endpoint", ["save", "rebuild"])
def test_retained_recovery_blocks_other_admin_mutations(admin_server, endpoint):
    root, _, url = admin_server
    real_replace = os.replace

    def fail(source, destination):
        if Path(destination) == generated_paths(root)["payload"]:
            raise OSError("persistent publication and rollback failure")
        return real_replace(source, destination)

    with patch("os.replace", fail):
        status, body = save_request(url, "annotations", ANNOTATIONS)
    assert status == 503, body
    assert (root / JOURNAL_NAME / "ready").exists()
    source = (root / "quests.json").read_bytes()
    request = urllib.request.Request(f"{url}/api/{endpoint}",
                                    data=b'{"routes":[{"activity_id":"one","region":"New region"}]}',
                                    headers={"Content-Type": "application/json"})
    with patch("os.replace", fail):
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == 503, response.read().decode()
    assert (root / "quests.json").read_bytes() == source
    recover_owner_publication(root)
    assert not (root / JOURNAL_NAME).exists()


def test_surviving_generator_child_blocks_recovery_after_parent_exit(tmp_path):
    from owner_publication import PublicationRecoveryError

    publication_fixture(tmp_path)
    before = published_bytes(tmp_path)
    child = '''import os, pathlib, sys, time
from owner_publication import recover_owner_publication, TOKEN_ENV, FD_ENV
root=pathlib.Path(sys.argv[1])
recover_owner_publication(root, inherited_token=os.environ[TOKEN_ENV], inherited_fd=os.environ[FD_ENV])
(root / ".child-ready").touch()
deadline=time.monotonic()+10
while not (root / ".release-child").exists() and time.monotonic()<deadline:
    time.sleep(0.02)
(root / "app/src/data/quests.generated.json").write_text("child publication")
'''
    parent = '''import subprocess, time
from owner_publication import owner_publication_subprocess_options
with owner_publication(root, include_source=True):
    (root / "quests.json").write_text("new source")
    subprocess.Popen([sys.executable, "-c", CHILD, str(root)],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     **owner_publication_subprocess_options(root))
    deadline=time.monotonic()+5
    while not (root / ".child-ready").exists() and time.monotonic()<deadline:
        time.sleep(0.02)
    assert (root / ".child-ready").exists()
    os._exit(19)'''.replace("CHILD", repr(child))
    try:
        result = interrupt_publication(tmp_path, parent)
        assert result.returncode == 19, result.stderr
        with pytest.raises(PublicationRecoveryError, match="still active"):
            recover_owner_publication(tmp_path)
        assert (tmp_path / "quests.json").read_text() == "new source"
    finally:
        (tmp_path / ".release-child").touch()
    deadline = time.monotonic() + 5
    while True:
        try:
            recover_owner_publication(tmp_path)
            break
        except PublicationRecoveryError:
            assert time.monotonic() < deadline, "child did not release publication lock"
            time.sleep(0.02)
    assert published_bytes(tmp_path) == before
