"""The admin route list and /api/save against a synthetic checkout."""

import json
import threading
import urllib.error
import urllib.request
from datetime import datetime
from http.server import ThreadingHTTPServer

import pytest

from test_admin_classify_run import load_admin


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


def write_routes(admin, routes):
    """Store routes in quests.json, each with a synthetic export row."""
    (admin.QUESTS / "quests.json").write_text(json.dumps({"routes": routes}, indent=2) + "\n")
    admin.acts_by_id = {
        route["activity_id"]: {
            "Activity Name": f"Route {route['activity_id']}",
            "Activity Type": "Run",
            "date": datetime(2026, 1, int(route["activity_id"])),
            "Distance": 5.0,
        }
        for route in routes
    }


def listed_statuses(served):
    status, body = request(f"{served}/api/routes")
    assert status == 200
    return {route["activity_id"]: route["status"] for route in body}


# ── Read path: /api/routes lists one of the three statuses ──


def test_the_list_keeps_todays_statuses(admin, served):
    write_routes(admin, [
        {"activity_id": "1", "status": "pending"},
        {"activity_id": "2", "status": "approved"},
        {"activity_id": "3", "status": "archived"},
    ])
    assert listed_statuses(served) == {"1": "pending", "2": "approved", "3": "archived"}


def test_the_list_shows_legacy_rejected_as_archived(admin, served):
    write_routes(admin, [{"activity_id": "1", "status": "rejected"}])
    assert listed_statuses(served) == {"1": "archived"}


def test_the_list_shows_a_missing_status_as_pending(admin, served):
    write_routes(admin, [{"activity_id": "1"}])
    assert listed_statuses(served) == {"1": "pending"}


@pytest.mark.parametrize("stored", ["bogus", None, 3, ""])
def test_the_list_shows_an_unknown_status_as_pending(admin, served, stored):
    write_routes(admin, [{"activity_id": "1", "status": stored}])
    assert listed_statuses(served) == {"1": "pending"}


# ── Write path: /api/save accepts only the three statuses ──

STATUS_ERROR = {"error": "status must be one of: pending, approved, archived"}


def stored(admin):
    return (admin.QUESTS / "quests.json").read_bytes()


@pytest.mark.parametrize("status", ["pending", "approved", "archived"])
def test_save_persists_each_valid_status(admin, served, status):
    write_routes(admin, [{"activity_id": "1", "status": "pending"}, {"activity_id": "2"}])
    code, body = request(f"{served}/api/save", "POST", {"routes": [
        {"activity_id": "1", "status": status},
        {"activity_id": "2", "status": status},
    ]})
    assert (code, body) == (200, {"ok": True, "updated": 2})
    routes = json.loads(stored(admin))["routes"]
    assert [route["status"] for route in routes] == [status, status]
    assert listed_statuses(served) == {"1": status, "2": status}


@pytest.mark.parametrize("status", ["bogus", "rejected", "", None, 3, ["archived"]])
def test_save_refuses_an_invalid_status_and_writes_nothing(admin, served, status):
    write_routes(admin, [{"activity_id": "1", "status": "pending"}])
    before = stored(admin)
    code, body = request(f"{served}/api/save", "POST", {"routes": [
        {"activity_id": "1", "status": status},
    ]})
    assert (code, body) == (400, STATUS_ERROR)
    assert stored(admin) == before


def test_one_invalid_status_refuses_the_whole_request(admin, served):
    write_routes(admin, [
        {"activity_id": "1", "status": "pending"},
        {"activity_id": "2", "status": "pending"},
    ])
    before = stored(admin)
    code, body = request(f"{served}/api/save", "POST", {"routes": [
        {"activity_id": "1", "status": "approved", "region": "Calgary", "title": "First"},
        {"activity_id": "2", "status": "nope"},
    ]})
    assert (code, body) == (400, STATUS_ERROR)
    assert stored(admin) == before
    assert listed_statuses(served) == {"1": "pending", "2": "pending"}


def test_an_invalid_status_for_an_unknown_route_is_still_refused(admin, served):
    write_routes(admin, [{"activity_id": "1", "status": "pending"}])
    before = stored(admin)
    code, body = request(f"{served}/api/save", "POST", {"routes": [
        {"activity_id": "1", "status": "approved"},
        {"activity_id": "999", "status": "bogus"},
    ]})
    assert (code, body) == (400, STATUS_ERROR)
    assert stored(admin) == before


def test_a_save_without_status_leaves_the_stored_status_alone(admin, served):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    code, body = request(f"{served}/api/save", "POST", {"routes": [
        {"activity_id": "1", "region": "Calgary"},
    ]})
    assert (code, body) == (200, {"ok": True, "updated": 1})
    route = json.loads(stored(admin))["routes"][0]
    assert route == {"activity_id": "1", "status": "approved", "region": "Calgary"}
