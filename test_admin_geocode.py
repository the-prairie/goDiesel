import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request

import pytest

import admin_geocode
from admin_geocode import (
    BUCKET_DEG,
    GeocodeBucketCache,
    NominatimClient,
    bucket_key,
    load_json_object,
    no_place,
    outcome_from_nominatim,
    outcome_label,
    transient,
    write_json_atomic,
)

STAMP = 1_800_000_000.0  # a fixed clock for corrupt-file names


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("a test tried to reach the network")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)


def label(text):
    return {"kind": "label", "label": text}


# ── Bucket keys survive a save and a restart ──

POINTS = [
    (34.4012, 132.4499),
    (29.52, -98.49),
    (-33.8688, 151.2093),
    (0.01, -0.01),
    (-0.03, 0.03),
    (51.0447, -114.0719),
    (40.70, -73.95),
    (36.95, -122.1),
    (89.99, 179.99),
]


def test_bucket_key_is_a_stable_string_shared_by_nearby_points():
    assert bucket_key(29.52, -98.49) == "29.5000,-98.5000"
    assert bucket_key(29.51, -98.51) == bucket_key(29.52, -98.49)
    assert bucket_key(0.01, -0.01) == "0.0000,0.0000"
    assert bucket_key(-0.03, 0.03) == "-0.0500,0.0500"
    assert BUCKET_DEG == 0.05


def test_every_bucket_written_is_found_again_after_a_round_trip(tmp_path):
    path = tmp_path / ".geocode_buckets.json"
    cache = GeocodeBucketCache.load(path)
    for index, (lat, lng) in enumerate(POINTS):
        cache.record(lat, lng, label(f"Place {index}"))
    cache.record(10.0, 10.0, no_place())
    cache.save()

    restarted = GeocodeBucketCache.load(path)
    for index, (lat, lng) in enumerate(POINTS):
        assert restarted.lookup(lat, lng) == label(f"Place {index}")
    assert restarted.lookup(10.01, 9.99) == no_place()
    assert restarted.dropped == 0


def test_the_existing_on_disk_format_loads_without_losing_entries(tmp_path):
    # Shape of the file the previous admin.py wrote: "%.4f,%.4f" bucket keys
    # computed from float buckets, mapped to a label.
    legacy = {
        f"{round(lat / BUCKET_DEG) * BUCKET_DEG:.4f},{round(lng / BUCKET_DEG) * BUCKET_DEG:.4f}": f"Place {index}"
        for index, (lat, lng) in enumerate(POINTS)
    }
    path = tmp_path / ".geocode_buckets.json"
    path.write_text(json.dumps(legacy, indent=2, sort_keys=True))

    cache = GeocodeBucketCache.load(path)
    assert len(cache) == len(legacy)
    for index, (lat, lng) in enumerate(POINTS):
        assert cache.lookup(lat, lng) == label(f"Place {index}")
    cache.save()
    assert json.loads(path.read_text()) == legacy


def test_the_previous_float_keyed_loader_missed_buckets_this_one_finds(tmp_path):
    # Characterizes the defect: the old loader parsed keys back to floats that
    # rarely equal round(x / 0.05) * 0.05, so most of the cache missed.
    saved = {f"{round(lat / BUCKET_DEG) * BUCKET_DEG:.4f},{round(lng / BUCKET_DEG) * BUCKET_DEG:.4f}" for lat, lng in POINTS}
    reloaded = {tuple(float(x) for x in key.split(",")) for key in saved}
    old_hits = [
        (round(lat / BUCKET_DEG) * BUCKET_DEG, round(lng / BUCKET_DEG) * BUCKET_DEG) in reloaded
        for lat, lng in POINTS
    ]
    assert not all(old_hits)
    path = tmp_path / "b.json"
    path.write_text(json.dumps({key: "X" for key in saved}))
    cache = GeocodeBucketCache.load(path)
    assert all(cache.lookup(lat, lng) == label("X") for lat, lng in POINTS)


def test_legacy_null_entries_are_retried_and_unreadable_keys_are_counted(tmp_path):
    path = tmp_path / "b.json"
    path.write_text(json.dumps({"29.5000,-98.5000": None, "not a key": "X", "40.7000,-73.9500": "New York, NY"}))
    cache = GeocodeBucketCache.load(path)
    # A legacy null may have been a cached network failure, so it is asked again.
    assert cache.lookup(29.5, -98.5) is None
    assert cache.lookup(40.7, -73.95) == label("New York, NY")
    assert cache.dropped == 2


# ── Outcomes: a transient failure is never cached ──


def test_a_transient_outcome_is_never_cached(tmp_path):
    path = tmp_path / "b.json"
    cache = GeocodeBucketCache.load(path)
    calls = []

    def fetch(lat, lng):
        calls.append((lat, lng))
        return transient("HTTP 429") if len(calls) == 1 else label("Calgary, AB")

    assert cache.resolve(51.04, -114.07, fetch) == transient("HTTP 429")
    assert cache.lookup(51.04, -114.07) is None
    cache.save()
    assert json.loads(path.read_text()) == {}
    assert cache.resolve(51.04, -114.07, fetch) == label("Calgary, AB")
    assert cache.resolve(51.05, -114.06, fetch) == label("Calgary, AB")
    assert len(calls) == 2


def test_no_place_is_cached_and_answers_without_a_label(tmp_path):
    cache = GeocodeBucketCache.load(tmp_path / "b.json")
    calls = []

    def fetch(lat, lng):
        calls.append(1)
        return no_place()

    assert cache.resolve(0.0, -30.0, fetch) == no_place()
    assert cache.resolve(0.0, -30.0, fetch) == no_place()
    assert len(calls) == 1
    assert outcome_label(no_place()) is None
    assert outcome_label(transient("x")) is None
    assert outcome_label(label("Rome, Italy")) == "Rome, Italy"


def test_nominatim_addresses_become_the_same_labels_as_before():
    assert outcome_from_nominatim({"address": {"city": "Calgary", "state": "Alberta", "country_code": "ca", "country": "Canada"}}) == label("Calgary, AB")
    assert outcome_from_nominatim({"address": {"town": "Tamano", "country_code": "jp", "country": "Japan"}}) == label("Tamano, Japan")
    assert outcome_from_nominatim({"address": {"state": "Texas", "country_code": "us"}}) == label("TX")
    assert outcome_from_nominatim({"address": {"country": "Greece", "country_code": "gr"}}) == label("Greece")
    assert outcome_from_nominatim({"address": {"village": "Nowhere"}}) == label("Nowhere")
    assert outcome_from_nominatim({"error": "Unable to geocode"}) == no_place()
    assert outcome_from_nominatim({}) == no_place()


# ── The Nominatim client keeps its rate limit and User-Agent ──


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Clock:
    def __init__(self, now):
        self.now = now
        self.slept = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def client_with(responder, clock=None):
    clock = clock or Clock(1000.0)
    requests = []

    def urlopen(request, timeout):
        requests.append((request, timeout))
        return responder(request)

    client = NominatimClient("goDieselOwnerAdmin/1.0", urlopen=urlopen, clock=clock, sleep=clock.sleep)
    return client, requests, clock


def test_the_request_keeps_its_user_agent_parameters_and_timeout():
    body = json.dumps({"address": {"city": "Rome", "country": "Italy", "country_code": "it"}}).encode()
    client, requests, _ = client_with(lambda request: FakeResponse(body))
    assert client.reverse(41.9, 12.45) == label("Rome, Italy")
    request, timeout = requests[0]
    assert timeout == 15
    assert request.get_header("User-agent") == "goDieselOwnerAdmin/1.0"
    assert request.get_header("Accept-language") == "en"
    url = urllib.parse.urlparse(request.full_url)
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://nominatim.openstreetmap.org/reverse"
    assert urllib.parse.parse_qs(url.query) == {
        "lat": ["41.90000"],
        "lon": ["12.45000"],
        "format": ["jsonv2"],
        "zoom": ["10"],
        "addressdetails": ["1"],
        "accept-language": ["en"],
    }


def test_requests_are_spaced_at_least_1_05_seconds_apart():
    body = json.dumps({}).encode()
    client, requests, clock = client_with(lambda request: FakeResponse(body))
    client.reverse(1, 1)
    clock.now += 0.3
    client.reverse(1, 1)
    assert clock.slept == [pytest.approx(0.75)]
    clock.now += 5
    client.reverse(1, 1)
    assert len(clock.slept) == 1


def test_the_default_user_agent_is_unchanged(monkeypatch):
    assert admin_geocode.DEFAULT_NOMINATIM_USER_AGENT == "goDieselOwnerAdmin/1.0"
    assert admin_geocode.NOMINATIM_URL == "https://nominatim.openstreetmap.org/reverse"


@pytest.mark.parametrize(
    "failure",
    [
        urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None),
        urllib.error.HTTPError("u", 503, "Unavailable", {}, None),
        urllib.error.URLError("no route"),
        TimeoutError("timed out"),
        ConnectionResetError("reset"),
    ],
)
def test_network_failures_are_transient(failure):
    def responder(request):
        raise failure

    client, _, _ = client_with(responder)
    outcome = client.reverse(1, 1)
    assert outcome["kind"] == "transient"
    assert outcome["reason"]


def test_an_unreadable_response_is_transient():
    client, _, _ = client_with(lambda request: FakeResponse(b"<html>busy</html>"))
    assert client.reverse(1, 1)["kind"] == "transient"


# ── Files: atomic writes, and a corrupt file is moved aside and reported ──


def test_write_json_atomic_replaces_the_file_through_os_replace(tmp_path, monkeypatch):
    path = tmp_path / "cache.json"
    path.write_text('{"old": 1}')
    replaced = []
    real_replace = os.replace

    def spy(source, destination):
        replaced.append((os.path.dirname(source), destination))
        real_replace(source, destination)

    monkeypatch.setattr(admin_geocode.os, "replace", spy)
    write_json_atomic(path, {"new": 2})
    assert json.loads(path.read_text()) == {"new": 2}
    assert replaced == [(str(tmp_path), path)]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cache.json"]


def test_a_failed_write_leaves_the_previous_file_and_no_temp_and_raises(tmp_path, monkeypatch):
    path = tmp_path / "cache.json"
    path.write_text('{"old": 1}')

    def refuse(source, destination):
        raise OSError("disk full")

    monkeypatch.setattr(admin_geocode.os, "replace", refuse)
    with pytest.raises(OSError, match="disk full"):
        write_json_atomic(path, {"new": 2})
    assert path.read_text() == '{"old": 1}'
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cache.json"]


def test_a_missing_file_loads_empty(tmp_path):
    assert load_json_object(tmp_path / "absent.json", now=STAMP) == ({}, None)


@pytest.mark.parametrize("content", ['{"29.5000,-98.5000": "San', "[1, 2]", "\xff\xfe"])
def test_a_corrupt_file_is_moved_aside_not_silently_reset(tmp_path, content):
    path = tmp_path / ".geocode_buckets.json"
    path.write_bytes(content.encode("latin-1"))
    data, moved = load_json_object(path, now=STAMP)
    assert data == {}
    assert moved is not None
    assert moved.name.startswith(".geocode_buckets.json.corrupt-")
    assert moved.read_bytes() == content.encode("latin-1")
    assert not path.exists()


def test_the_bucket_cache_reports_a_corrupt_file(tmp_path):
    path = tmp_path / ".geocode_buckets.json"
    path.write_text("{not json")
    cache = GeocodeBucketCache.load(path, now=lambda: STAMP)
    assert len(cache) == 0
    assert cache.corrupt_moved_to is not None
    assert cache.corrupt_moved_to.read_text() == "{not json"


# ── Adapter: admin.py uses the caches and reports what it cannot read or write ──

from test_admin_classify_run import load_admin  # noqa: E402


def load_admin_with(tmp_path, monkeypatch, files):
    for name, content in files.items():
        (tmp_path / name).write_text(content)
    return load_admin(tmp_path, monkeypatch)


def test_admin_moves_a_corrupt_bucket_cache_aside_and_reports_it(tmp_path, monkeypatch, capsys):
    admin = load_admin_with(tmp_path, monkeypatch, {".geocode_buckets.json": "{broken"})
    moved = list(tmp_path.glob(".geocode_buckets.json.corrupt-*"))
    assert len(moved) == 1 and moved[0].read_text() == "{broken"
    assert "corrupt" in capsys.readouterr().err
    assert len(admin.geocode_cache) == 0


def test_admin_moves_a_corrupt_geo_cache_aside_and_reports_it(tmp_path, monkeypatch, capsys):
    load_admin_with(tmp_path, monkeypatch, {".geo_cache.json": "{broken"})
    moved = list(tmp_path.glob(".geo_cache.json.corrupt-*"))
    assert len(moved) == 1 and moved[0].read_text() == "{broken"
    assert "corrupt" in capsys.readouterr().err


def test_admin_does_not_cache_a_transient_failure(tmp_path, monkeypatch):
    admin = load_admin(tmp_path, monkeypatch)
    answers = [transient("HTTP 429"), {"kind": "label", "label": "Calgary, AB"}]
    monkeypatch.setattr(admin.nominatim, "reverse", lambda lat, lng: answers.pop(0))
    assert admin.cached_reverse_geocode(51.04, -114.07) is None
    assert admin.cached_reverse_geocode(51.04, -114.07) == "Calgary, AB"
    assert admin.cached_reverse_geocode(51.04, -114.07) == "Calgary, AB"
    assert answers == []


def admin_with_one_unmapped_route(tmp_path, monkeypatch):
    # Added after import, so the startup classifier has nothing to start.
    admin = load_admin(tmp_path, monkeypatch)
    admin.geo_cache["r1"] = {"lat": 51.04, "lng": -114.07, "region": None}
    return admin


def test_a_classify_run_saves_both_caches_and_restarts_find_them(tmp_path, monkeypatch):
    admin = admin_with_one_unmapped_route(tmp_path, monkeypatch)
    monkeypatch.setattr(
        admin.nominatim, "reverse", lambda lat, lng: {"kind": "label", "label": "Calgary, AB"}
    )
    admin._classify_state = admin.reduce_classify(admin.initial_classify_state(), {"type": "start", "total": 1})
    admin.classify_unmapped_worker([("r1", 51.04, -114.07)])
    assert admin._classify_snapshot()["phase"] == "finished"
    assert json.loads((tmp_path / ".geo_cache.json").read_text())["r1"]["region"] == "Calgary, AB"
    restarted = GeocodeBucketCache.load(tmp_path / ".geocode_buckets.json")
    assert restarted.lookup(51.04, -114.07) == label("Calgary, AB")


def test_a_cache_write_error_is_reported_not_swallowed(tmp_path, monkeypatch, capsys):
    admin = admin_with_one_unmapped_route(tmp_path, monkeypatch)
    monkeypatch.setattr(admin.nominatim, "reverse", lambda lat, lng: no_place())

    def refuse(*args, **kwargs):
        raise OSError("read-only file system")

    monkeypatch.setattr(admin, "write_json_atomic", refuse)
    admin._classify_state = admin.reduce_classify(admin.initial_classify_state(), {"type": "start", "total": 1})
    admin.classify_unmapped_worker([("r1", 51.04, -114.07)])
    assert admin._classify_snapshot()["phase"] == "finished"
    assert "read-only file system" in capsys.readouterr().err
