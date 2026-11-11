import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from test_admin_classify_run import load_admin

BUSY = "another owner mutation is in progress"


@pytest.fixture
def admin(tmp_path, monkeypatch):
    return load_admin(tmp_path, monkeypatch)


@pytest.fixture
def served(admin):
    server = ThreadingHTTPServer(("127.0.0.1", 0), admin.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def request(url, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


# ── Characterization: what the status endpoint and busy responses already say ──


def test_status_keeps_its_existing_fields(admin, served):
    status, body = request(f"{served}/api/admin/status")
    assert status == 200
    assert body["writer_available"] is True
    assert body["mode"] == "local-owner"
    assert body["generation_status"] == "missing"
    assert body["generated_at"] is None


def test_status_reports_ready_generation_from_the_manifest(admin, served):
    manifest = admin.QUESTS / "app" / "src" / "data" / "generated" / "routes.manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text('{"routes": []}')
    status, body = request(f"{served}/api/admin/status")
    assert status == 200
    assert body["generation_status"] == "ready"
    assert isinstance(body["generated_at"], str)


@pytest.mark.parametrize(
    "path, payload",
    [
        ("/api/save", {"routes": []}),
        ("/api/curation/save", {"activity_id": "1", "curation": {}}),
        ("/api/annotations/save", {"activity_id": "1", "annotations": []}),
        ("/api/rebuild", {}),
    ],
)
def test_a_held_mutation_lock_refuses_with_409_and_the_existing_error(
    admin, served, path, payload
):
    assert admin.OWNER_MUTATION_LOCK.acquire(blocking=False)
    try:
        status, body = request(f"{served}{path}", "POST", payload)
    finally:
        admin.OWNER_MUTATION_LOCK.release()
    assert status == 409
    assert body["error"] == BUSY
