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


# ── Publication OSError bodies for curation and annotation saves ──

import owner_publication as owner_publication_module  # noqa: E402

PUBLISH_PATHS = {
    "/api/curation/save": {"activity_id": "1", "curation": {}},
    "/api/annotations/save": {"activity_id": "1", "annotations": []},
}
RESTORED = "Publication failed; previous source and route data restored."
NOTHING_PUBLISHED = "Publication failed; no changes were published."
RECOVERY_REQUIRED = (
    "Publication recovery is required; the owner publication journal was kept."
)


def journal(admin):
    return admin.QUESTS / owner_publication_module.JOURNAL_NAME


def fail_inside_the_publication(admin, monkeypatch):
    """Raise OSError after the journal is ready, as a full disk would."""
    def disk_full(*args, **kwargs):
        assert (journal(admin) / "ready").exists()
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(admin, "publish_curation", disk_full)
    monkeypatch.setattr(admin, "publish_annotations", disk_full)


@pytest.mark.parametrize("path", PUBLISH_PATHS)
def test_an_error_inside_the_publication_reports_the_restore(admin, served, monkeypatch, path):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    before = stored(admin)
    fail_inside_the_publication(admin, monkeypatch)
    code, body = request(f"{served}{path}", "POST", PUBLISH_PATHS[path])
    assert code == 500
    assert body == {"error": RESTORED, "detail": "[Errno 28] No space left on device"}
    assert stored(admin) == before
    assert not journal(admin).exists()


@pytest.mark.parametrize("path", PUBLISH_PATHS)
def test_an_error_before_anything_was_written_says_nothing_was_published(
    admin, served, monkeypatch, path
):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    before = stored(admin)

    def unwritable(root):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(owner_publication_module, "_settle_generator_backup", unwritable)
    code, body = request(f"{served}{path}", "POST", PUBLISH_PATHS[path])
    assert code == 500
    assert body == {"error": NOTHING_PUBLISHED, "detail": "[Errno 13] Permission denied"}
    assert stored(admin) == before
    assert not journal(admin).exists()


@pytest.mark.parametrize("path", PUBLISH_PATHS)
def test_an_error_during_recovery_that_keeps_the_journal_requires_recovery(
    admin, served, path
):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    before = stored(admin)
    # An abandoned journal whose owner record is missing: recovery cannot read it.
    journal(admin).mkdir()
    (journal(admin) / "lock").write_bytes(b"")
    code, body = request(f"{served}{path}", "POST", PUBLISH_PATHS[path])
    assert code == 503
    assert body["error"] == RECOVERY_REQUIRED
    assert "owner.json" in body["detail"]
    assert stored(admin) == before
    assert journal(admin).exists()


@pytest.mark.parametrize("path", PUBLISH_PATHS)
def test_a_failed_restore_keeps_its_existing_503(admin, served, monkeypatch, path):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    fail_inside_the_publication(admin, monkeypatch)

    def restore_fails(root, kept):
        raise OSError(5, "Input/output error")

    monkeypatch.setattr(owner_publication_module, "_restore", restore_fails)
    code, body = request(f"{served}{path}", "POST", PUBLISH_PATHS[path])
    assert code == 503
    assert body == {"error": (
        f"publication recovery failed; retain {journal(admin)} and retry recovery"
    )}
    assert journal(admin).exists()


@pytest.mark.parametrize("path", PUBLISH_PATHS)
def test_a_successful_publication_keeps_its_200(admin, served, monkeypatch, path):
    write_routes(admin, [{"activity_id": "1", "status": "approved"}])
    monkeypatch.setattr(admin, "publish_curation", lambda *args: None)
    monkeypatch.setattr(admin, "publish_annotations", lambda *args: [])
    code, body = request(f"{served}{path}", "POST", PUBLISH_PATHS[path])
    assert code == 200
    assert body["ok"] is True
    assert not journal(admin).exists()
