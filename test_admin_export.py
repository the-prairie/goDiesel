"""The owner writer with and without her Strava export (ADR-0010).

Route curation reads the export (DieselDiaries/activities.csv and its activity
files). Placing moments does not. The writer starts either way: with the export
it behaves exactly as before; without it, it serves status and moments and
refuses the curation routes with a plain message, with the same loopback bind,
origin check, size cap and lock.
"""

import importlib.util
import json
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from test_admin_moments import call, moments

ROOT = Path(__file__).resolve().parent
APP = "http://127.0.0.1:8787"
EXPORT_ROW = "Activity ID,Activity Date,Activity Name,Activity Type,Filename,Distance\n123,\"Mar 1, 2024, 7:00:00 AM\",Morning,Run,activities/123.gpx,5.0\n"


def load(tmp_path, monkeypatch, export=True, routes=()):
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    if export:
        (inputs / "activities.csv").write_text(EXPORT_ROW)
    (tmp_path / "quests.json").write_text(json.dumps({"routes": [{"activity_id": r} for r in routes]}))
    monkeypatch.setenv("GODIESEL_CHECKOUT_ROOT", str(tmp_path))
    monkeypatch.setenv("GODIESEL_DIESEL_DIARIES_ROOT", str(inputs))
    monkeypatch.setenv("GODIESEL_TRAVEL_ROOT", str(inputs))
    spec = importlib.util.spec_from_file_location(f"admin_export_{tmp_path.name}", ROOT / "admin.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def serve(admin):
    server = ThreadingHTTPServer(("127.0.0.1", 0), admin.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


@pytest.fixture
def with_export(tmp_path, monkeypatch):
    admin = load(tmp_path, monkeypatch, routes=["123"])
    server, url = serve(admin)
    yield admin, url, tmp_path
    server.shutdown()
    server.server_close()


@pytest.fixture
def without_export(tmp_path, monkeypatch):
    admin = load(tmp_path, monkeypatch, export=False, routes=["123"])
    server, url = serve(admin)
    yield admin, url, tmp_path
    server.shutdown()
    server.server_close()


# -- with the export: as before ------------------------------------------------

def test_with_the_export_its_activities_are_indexed_by_id(with_export):
    admin, _, _ = with_export
    assert list(admin.acts_by_id) == ["123"]


def test_with_the_export_the_geo_cache_is_built_for_every_route(with_export):
    _, _, root = with_export
    assert json.loads((root / ".geo_cache.json").read_text()) == {"123": {"lat": None, "lng": None, "region": None}}


def test_with_the_export_the_curation_routes_answer(with_export):
    _, url, _ = with_export
    status, routes = call(f"{url}/api/routes")
    assert status == 200 and isinstance(routes, list)
    assert call(f"{url}/api/classify-status")[0] == 200
    # A malformed save reaches the save handler itself.
    assert call(f"{url}/api/save", "POST", raw=b"{", headers={"Origin": APP, "Content-Type": "application/json"})[0] == 400


def test_with_the_export_status_says_so(with_export):
    _, url, _ = with_export
    status, body = call(f"{url}/api/admin/status")
    assert status == 200 and body["writer_available"] is True and body["strava_export"] is True


# -- without the export: moments only, curation refused plainly -----------------

def test_without_the_export_the_writer_starts_and_says_what_is_missing(tmp_path, monkeypatch, capsys):
    admin = load(tmp_path, monkeypatch, export=False)
    assert admin.acts_by_id == {}
    assert "activities.csv" in capsys.readouterr().out


def test_without_the_export_it_writes_no_geo_cache(without_export):
    _, _, root = without_export
    assert not (root / ".geo_cache.json").exists()


def test_without_the_export_status_and_moments_work(without_export):
    _, url, root = without_export
    status, body = call(f"{url}/api/admin/status")
    assert status == 200 and body["writer_available"] is True and body["strava_export"] is False
    headers = {"Origin": APP, "Content-Type": "application/json"}
    assert call(f"{url}/api/admin/moments", "PUT", moments(), headers)[0] == 200
    assert call(f"{url}/api/admin/moments", headers={"Origin": APP}) == (200, {"moments": moments()})
    assert json.loads((root / "app/public/moments/moments.json").read_text()) == moments()


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/routes"),
    ("GET", "/api/classify-status"),
    ("GET", "/api/polyline/123"),
    ("POST", "/api/save"),
    ("POST", "/api/curation/save"),
    ("POST", "/api/annotations/save"),
    ("POST", "/api/rebuild"),
    ("POST", "/api/auto-classify"),
    ("POST", "/api/media/upload"),
])
def test_without_the_export_curation_refuses_with_a_plain_message(without_export, method, path):
    _, url, _ = without_export
    status, body = call(f"{url}{path}", method, raw=b"{}" if method == "POST" else None, headers={"Origin": APP, "Content-Type": "application/json"})
    assert status == 503
    assert "activities.csv" in body["error"] and "Placing moments still works" in body["error"]


def test_without_the_export_the_guards_are_unchanged(without_export):
    _, url, _ = without_export
    hostile = {"Origin": "https://attacker.invalid", "Content-Type": "application/json"}
    assert call(f"{url}/api/save", "POST", raw=b"{}", headers=hostile)[0] == 403
    assert call(f"{url}/api/admin/moments", "PUT", moments(), hostile)[0] == 403
    assert call(f"{url}/api/admin/moments", "PUT", raw=b"{", headers={"Origin": APP, "Content-Type": "application/json"})[0] == 400
