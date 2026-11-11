"""Reverse geocoding for the owner admin: Nominatim client, outcome, and caches.

A lookup has three outcomes. `label` and `no_place` are answers and are
cached. `transient` (an HTTP error, a 429, a timeout, an unreadable body) is
not an answer, so it is never cached and the next classify run asks again.

Bucket keys are strings, so a key written to `.geocode_buckets.json` is the
same key looked up after a restart. Cache files are replaced atomically, and a
file that cannot be read is moved aside and reported, never silently reset.
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Literal, TypedDict

# Nominatim fair-use: max 1 req/sec, descriptive User-Agent required.
DEFAULT_NOMINATIM_USER_AGENT = 'goDieselOwnerAdmin/1.0'
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
NOMINATIM_MIN_INTERVAL = 1.05
NOMINATIM_TIMEOUT = 15
BUCKET_DEG = 0.05  # ~5 km cells — nearby rides share a single API call

# State / province abbreviations for clean "City, ST" labels.
STATE_ABBREV = {
    'Alberta': 'AB', 'British Columbia': 'BC', 'Saskatchewan': 'SK',
    'Manitoba': 'MB', 'Ontario': 'ON', 'Quebec': 'QC', 'Québec': 'QC',
    'Nova Scotia': 'NS', 'New Brunswick': 'NB',
    'Newfoundland and Labrador': 'NL', 'Prince Edward Island': 'PE',
    'Yukon': 'YT', 'Northwest Territories': 'NT', 'Nunavut': 'NU',
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
    'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
    'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
    'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
}


class Label(TypedDict):
    kind: Literal["label"]
    label: str


class NoPlace(TypedDict):
    kind: Literal["no_place"]


class Transient(TypedDict):
    kind: Literal["transient"]
    reason: str


GeocodeOutcome = Label | NoPlace | Transient


def label(text: str) -> Label:
    return {"kind": "label", "label": text}


def no_place() -> NoPlace:
    return {"kind": "no_place"}


def transient(reason: str) -> Transient:
    return {"kind": "transient", "reason": reason}


def outcome_label(outcome: GeocodeOutcome) -> str | None:
    return outcome["label"] if outcome["kind"] == "label" else None


def bucket_key(lat: float, lng: float) -> str:
    """The ~5 km cell for a point, as the string stored on disk."""
    return f'{round(lat / BUCKET_DEG) * BUCKET_DEG:.4f},{round(lng / BUCKET_DEG) * BUCKET_DEG:.4f}'


def _canonical_key(stored: str) -> str | None:
    """Map a key read from disk to `bucket_key` form, or None if it is not a key."""
    try:
        lat, lng = (float(part) for part in stored.split(','))
    except (AttributeError, ValueError):
        return None
    return bucket_key(lat, lng)


def outcome_from_nominatim(data: dict) -> Label | NoPlace:
    """'City, ST' / 'City, Country' / region or country, else no place."""
    addr = data.get('address') or {}
    city = (addr.get('city') or addr.get('town') or addr.get('village')
            or addr.get('hamlet') or addr.get('municipality')
            or addr.get('county') or addr.get('state_district'))
    state = addr.get('state')
    country_code = (addr.get('country_code') or '').upper()
    country = addr.get('country')
    if not city:
        if state and country_code in ('US', 'CA'):
            return label(f'{STATE_ABBREV.get(state, state)}')
        if country:
            return label(country)
        return no_place()
    if country_code in ('US', 'CA') and state:
        return label(f'{city}, {STATE_ABBREV.get(state, state)}')
    if country:
        return label(f'{city}, {country}')
    return label(city)


class NominatimClient:
    """Reverse geocoder that keeps requests at least 1.05 s apart."""

    def __init__(
        self,
        user_agent: str,
        *,
        urlopen: Callable | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.user_agent = user_agent
        self._urlopen = urlopen
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._last_request_at = 0.0

    def reverse(self, lat: float, lng: float) -> GeocodeOutcome:
        with self._lock:
            elapsed = self._clock() - self._last_request_at
            if elapsed < NOMINATIM_MIN_INTERVAL:
                self._sleep(NOMINATIM_MIN_INTERVAL - elapsed)
            self._last_request_at = self._clock()
        url = NOMINATIM_URL + '?' + urllib.parse.urlencode({
            'lat': f'{lat:.5f}',
            'lon': f'{lng:.5f}',
            'format': 'jsonv2',
            'zoom': 10,
            'addressdetails': 1,
            'accept-language': 'en',
        })
        request = urllib.request.Request(url, headers={
            'User-Agent': self.user_agent,
            'Accept-Language': 'en',
        })
        try:
            urlopen = self._urlopen or urllib.request.urlopen
            with urlopen(request, timeout=NOMINATIM_TIMEOUT) as response:
                data = json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            return transient(f'HTTP {error.code}')
        except (urllib.error.URLError, OSError) as error:
            return transient(f'{type(error).__name__}: {error}')
        except ValueError as error:  # JSONDecodeError and UnicodeDecodeError
            return transient(f'unreadable response: {error}')
        if not isinstance(data, dict):
            return transient('unreadable response: not an object')
        return outcome_from_nominatim(data)


def write_json_atomic(path: Path, data, **dumps_options) -> None:
    """Replace `path` with `data` as JSON via a temp file and os.replace. Raises on failure."""
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(json.dumps(data, **dumps_options))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def load_json_object(path: Path, *, now: float) -> tuple[dict, Path | None]:
    """Read a JSON object cache. A missing file is empty.

    An unreadable file is moved to `<name>.corrupt-<timestamp>` and its new
    path is returned so the caller can report it. Moving it aside raises
    rather than letting the next save overwrite it.
    """
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}, None
    except ValueError:
        data = None
    if isinstance(data, dict):
        return data, None
    stamp = time.strftime('%Y%m%dT%H%M%S', time.localtime(now))
    moved = path.with_name(f'{path.name}.corrupt-{stamp}')
    os.replace(path, moved)
    return {}, moved


class GeocodeBucketCache:
    """Bucket key → label, or "" for a bucket Nominatim says has no place."""

    def __init__(self, path: Path, entries: dict[str, str], *, dropped: int = 0, corrupt_moved_to: Path | None = None):
        self.path = Path(path)
        self._entries = entries
        self._lock = threading.Lock()
        self.dropped = dropped
        self.corrupt_moved_to = corrupt_moved_to

    @classmethod
    def load(cls, path: Path, *, now: Callable[[], float] = time.time) -> 'GeocodeBucketCache':
        raw, moved = load_json_object(path, now=now())
        entries: dict[str, str] = {}
        dropped = 0
        for stored, value in raw.items():
            key = _canonical_key(stored)
            # A legacy null may be a cached network failure, so it is retried.
            if key is None or not isinstance(value, str):
                dropped += 1
                continue
            entries[key] = value
        return cls(path, entries, dropped=dropped, corrupt_moved_to=moved)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def lookup(self, lat: float, lng: float) -> Label | NoPlace | None:
        with self._lock:
            value = self._entries.get(bucket_key(lat, lng))
        if value is None:
            return None
        return label(value) if value else no_place()

    def record(self, lat: float, lng: float, outcome: GeocodeOutcome) -> None:
        if outcome['kind'] == 'transient':
            return
        with self._lock:
            self._entries[bucket_key(lat, lng)] = outcome_label(outcome) or ''

    def resolve(self, lat: float, lng: float, fetch: Callable[[float, float], GeocodeOutcome]) -> GeocodeOutcome:
        cached = self.lookup(lat, lng)
        if cached is not None:
            return cached
        outcome = fetch(lat, lng)
        self.record(lat, lng, outcome)
        return outcome

    def save(self) -> None:
        with self._lock:
            snapshot = dict(self._entries)
        write_json_atomic(self.path, snapshot, indent=2, sort_keys=True)
