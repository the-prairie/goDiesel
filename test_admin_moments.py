"""Her planted moments through the loopback owner writer (ADR-0010).

The catalog and placements are her private content: they live with her clips
in the gitignored app/public/moments/ folder and are written only through the
writer, only when valid, and atomically.
"""

import http.client
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from admin_moments import validate_moments
from test_admin_classify_run import load_admin


def moments(**overrides):
    data = {
        "catalog": [{"id": "tv-a", "kind": "tv-wall", "title": "A", "clip": "/moments/a.mp4", "caption": "a line", "public": True}],
        "placements": [{"id": "p1", "entryId": "tv-a", "at": {"lng": 135.77, "lat": 35.0}, "facingDeg": 185, "frontM": 31}],
    }
    data.update(overrides)
    return data


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


def call(url, method="GET", body=None, headers=None, raw=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_a_well_formed_catalog_and_placements_pass():
    assert validate_moments(moments()) == moments()
    assert validate_moments({"catalog": [], "placements": []}) == {"catalog": [], "placements": []}


@pytest.mark.parametrize(
    "broken",
    [
        {"catalog": "nope", "placements": []},
        moments(extra=1),
        moments(catalog=[{"id": "x", "kind": "billboard", "title": "X", "clip": None}]),
        moments(catalog=[{"id": "x y", "kind": "tv-wall", "title": "X", "clip": None}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "", "clip": None}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "X", "clip": "https://elsewhere/x.mp4"}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "X", "clip": "/moments/../secret.mp4"}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "X", "clip": None, "public": "yes"}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "X", "clip": None, "script": "<x>"}]),
        moments(catalog=[{"id": "x", "kind": "tv-wall", "title": "X", "clip": None}, {"id": "x", "kind": "tv-wall", "title": "Y", "clip": None}]),
        moments(placements=[{"id": "p1", "entryId": "gone", "at": {"lng": 1, "lat": 1}, "facingDeg": 0}]),
        moments(placements=[{"id": "p1", "entryId": "tv-a", "at": {"lng": 200, "lat": 1}, "facingDeg": 0}]),
        moments(placements=[{"id": "p1", "entryId": "tv-a", "at": {"lng": 1, "lat": 1}, "facingDeg": 360}]),
        moments(placements=[{"id": "p1", "entryId": "tv-a", "at": {"lng": 1, "lat": 1}, "facingDeg": True}]),
    ],
)
def test_anything_else_is_refused(broken):
    with pytest.raises(ValueError):
        validate_moments(broken)


def test_an_empty_place_is_allowed():
    data = moments(placements=[{"id": "p1", "entryId": None, "at": {"lng": 1, "lat": 1}, "facingDeg": 90}])
    assert validate_moments(data)["placements"][0]["entryId"] is None


def test_get_says_when_she_has_no_file_yet(served):
    assert call(f"{served}/api/admin/moments") == (200, {"moments": None})


def test_put_writes_her_file_and_get_reads_it_back(admin, served):
    status, body = call(f"{served}/api/admin/moments", "PUT", moments())
    assert status == 200 and body["ok"] is True
    written = admin.QUESTS / "app" / "public" / "moments" / "moments.json"
    assert json.loads(written.read_text()) == moments()
    assert call(f"{served}/api/admin/moments") == (200, {"moments": moments()})


def test_a_refused_write_leaves_her_file_as_it_was(admin, served):
    assert call(f"{served}/api/admin/moments", "PUT", moments())[0] == 200
    written = admin.QUESTS / "app" / "public" / "moments" / "moments.json"
    before = written.read_bytes()
    status, _ = call(f"{served}/api/admin/moments", "PUT", {"catalog": "nope", "placements": []})
    assert status == 400
    assert call(f"{served}/api/admin/moments", "PUT", raw=b"{not json")[0] == 400
    assert written.read_bytes() == before
    assert not [p for p in written.parent.iterdir() if p.name != "moments.json"]


def test_cross_origin_oversize_and_busy_writes_are_refused(admin, served):
    assert call(f"{served}/api/admin/moments", "PUT", moments(), headers={"Origin": "https://evil.example"})[0] == 403
    assert call(f"{served}/api/admin/moments", headers={"Origin": "https://evil.example"})[0] == 403
    # Refused on its declared size, before a byte of it is read.
    host, port = served.removeprefix("http://").split(":")
    connection = http.client.HTTPConnection(host, int(port), timeout=5)
    connection.putrequest("PUT", "/api/admin/moments")
    connection.putheader("Content-Length", str(admin.MAX_POST_BYTES + 1))
    connection.putheader("Content-Type", "application/json")
    connection.endheaders()
    assert connection.getresponse().status == 413
    connection.close()
    admin.OWNER_MUTATION_LOCK.acquire()
    try:
        assert call(f"{served}/api/admin/moments", "PUT", moments())[0] == 409
    finally:
        admin.OWNER_MUTATION_LOCK.release()


def test_preflight_allows_put_from_the_app(admin, served):
    req = urllib.request.Request(f"{served}/api/admin/moments", method="OPTIONS", headers={"Origin": "http://127.0.0.1:8787", "Access-Control-Request-Method": "PUT"})
    with urllib.request.urlopen(req, timeout=5) as response:
        assert response.status == 204
        assert "PUT" in response.headers["Access-Control-Allow-Methods"]
