"""Quests admin server — visual approval flow.

Run via ./admin.sh.

Endpoints:
  GET  /                    → admin.html
  GET  /api/routes          → all routes with metadata (no polylines, fast)
  GET  /api/polyline/<id>   → SVG polyline preview for one route (lazy, cached)
  POST /api/save            → persist status/region/metadata changes to quests.json
  POST /api/rebuild         → spawn build.py in background
"""
import gzip
import json
import os
import math
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import gpxpy
import pandas as pd

from admin_classify import initial_classify_state, public_classify_state, reduce_classify
from admin_rebuild import (
    initial_rebuild_state,
    public_rebuild_state,
    reduce_rebuild,
    stderr_tail,
)
from admin_geocode import (
    DEFAULT_NOMINATIM_USER_AGENT,
    GeocodeBucketCache,
    NominatimClient,
    load_json_object,
    outcome_label,
    write_json_atomic,
)
from admin_curation import curation_readiness, save_curation_and_rebuild, write_atomic
from route_regions import classify_region
import hashlib
import tempfile
import uuid

from curation_publish import (
    CurationPublishError,
    publish_annotations,
    publish_curation,
)
from owner_publication import (
    JOURNAL_NAME,
    PublicationRecoveryError,
    owner_publication,
    owner_publication_subprocess_options,
    recover_owner_publication,
)
from quest_meta import normalize_route_status, validate_route_status
from route_imports import route_metadata
from route_media import (
    match_photo_to_route,
    publish_photo,
    read_photo_metadata,
)

try:
    import fitparse
except ImportError:
    fitparse = None

QUESTS = Path(
    os.environ.get("GODIESEL_CHECKOUT_ROOT", Path(__file__).resolve().parent)
).resolve()
recover_owner_publication(QUESTS)
DD = Path(
    os.environ.get("GODIESEL_DIESEL_DIARIES_ROOT", Path(__file__).resolve().parent.parent / "DieselDiaries")
).resolve()
ACTIVITY_DIR = DD / 'strava_export' / 'activities'
GEO_CACHE_PATH = QUESTS / '.geo_cache.json'
GEOCODE_BUCKETS_PATH = QUESTS / '.geocode_buckets.json'
PORT = int(os.environ.get("GODIESEL_ADMIN_PORT", "8766"))
CONFIGURED_APP_ORIGINS = frozenset(
    origin.strip()
    for origin in os.environ.get(
        "GODIESEL_APP_ORIGINS",
        "http://localhost:8787,http://127.0.0.1:8787",
    ).split(",")
    if origin.strip()
)
ALLOWED_ORIGINS = CONFIGURED_APP_ORIGINS | {
    f'http://localhost:{PORT}',
    f'http://127.0.0.1:{PORT}',
}
MAX_POST_BYTES = 1024 * 1024
# A photograph is far larger than a JSON body, and HEIC from a recent iPhone can
# be several megabytes. This cap applies only to the media upload path.
MAX_MEDIA_BYTES = 25 * 1024 * 1024
SLUG_PATTERN = re.compile(r'^[A-Za-z0-9._-]+$')
MEDIA_ROOT = QUESTS / 'app' / 'public' / 'media'
OWNER_MUTATION_LOCK = threading.Lock()
TEAL = '#00F19F'
CURATION_TEXT_FIELDS = ('title', 'theme', 'effort_tier', 'blurb', 'completion_rule')
CURATION_VISIBILITIES = ('public', 'hidden')

# Nominatim fair-use: max 1 req/sec, descriptive User-Agent required.
NOMINATIM_USER_AGENT = os.environ.get(
    'GODIESEL_NOMINATIM_USER_AGENT',
    DEFAULT_NOMINATIM_USER_AGENT,
)

def parse_strava_date(s):
    if not isinstance(s, str):
        return None
    months = {'Jan': 'January', 'Feb': 'February', 'Mar': 'March', 'Apr': 'April',
              'May': 'May', 'Jun': 'June', 'Jul': 'July', 'Aug': 'August',
              'Sep': 'September', 'Oct': 'October', 'Nov': 'November', 'Dec': 'December'}
    dp = s.rsplit(', ', 1)[0].strip()
    for a, f in months.items():
        if dp.startswith(a + ' '):
            dp = f + dp[len(a):]
            break
    try:
        return datetime.strptime(dp, '%B %d, %Y')
    except ValueError:
        return None


print('Loading activities.csv…')
df = pd.read_csv(DD / 'activities.csv', low_memory=False)
df['date'] = df['Activity Date'].apply(parse_strava_date)
df['act_id'] = df['Filename'].fillna('').astype(str).apply(
    lambda s: re.match(r'.*?/(\d+)', s).group(1) if re.match(r'.*?/(\d+)', s) else None
)
acts_by_id = {r['act_id']: r for _, r in df.iterrows() if r['act_id']}
print(f'  {len(acts_by_id)} activities indexed.')


def find_activity_file_early(aid):
    """Module-level shadow of find_activity_file used during startup geo-cache build."""
    for ext in ('.gpx', '.fit.gz', '.fit'):
        fp = ACTIVITY_DIR / f'{aid}{ext}'
        if fp.exists():
            return fp
    return None


def first_point(fp):
    """Extract first GPS coord without full file parse. ~1ms per GPX, fast for FIT via early-break."""
    try:
        if str(fp).endswith('.gpx'):
            with open(fp, 'r', errors='ignore') as f:
                data = f.read(80000)
            m = re.search(r'<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"', data)
            if m:
                return (float(m.group(1)), float(m.group(2)))
        elif str(fp).endswith('.fit.gz') and fitparse:
            with gzip.open(fp, 'rb') as f:
                ff = fitparse.FitFile(f)
                for msg in ff.get_messages('record'):
                    fields = {x.name: x.value for x in msg}
                    lat = fields.get('position_lat')
                    lng = fields.get('position_long')
                    if lat is not None and lng is not None:
                        if isinstance(lat, int):
                            lat = lat * (180 / 2**31)
                            lng = lng * (180 / 2**31)
                        return (lat, lng)
    except Exception:
        return None
    return None


def build_geo_cache():
    """One-time pass: extract starting GPS point for every route + classify region.
    Cached to .geo_cache.json so subsequent admin launches are instant."""
    cache, moved = load_json_object(GEO_CACHE_PATH, now=time.time())
    if moved is not None:
        print(f'WARNING: {GEO_CACHE_PATH.name} was corrupt; moved aside to {moved.name}',
              file=sys.stderr)
    cfg = json.loads((QUESTS / 'quests.json').read_text())
    all_ids = [r['activity_id'] for r in cfg.get('routes', [])]
    todo = [aid for aid in all_ids if aid not in cache]
    if not todo:
        return cache
    print(f'Building geo cache for {len(todo)} routes (one-time, ~15s)…')
    import time as _t
    t0 = _t.time()
    for i, aid in enumerate(todo):
        if (i + 1) % 200 == 0:
            elapsed = _t.time() - t0
            print(f'  {i+1}/{len(todo)} ({elapsed:.1f}s)')
        fp = find_activity_file_early(aid)
        if fp is None:
            cache[aid] = {'lat': None, 'lng': None, 'region': None}
            continue
        pt = first_point(fp)
        if pt is None:
            cache[aid] = {'lat': None, 'lng': None, 'region': None}
        else:
            cache[aid] = {
                'lat': round(pt[0], 4),
                'lng': round(pt[1], 4),
                'region': classify_region(pt[0], pt[1]),
            }
    write_json_atomic(GEO_CACHE_PATH, cache)
    print(f'  Cached: {GEO_CACHE_PATH.name}')
    return cache


print('Loading geo cache…')
geo_cache = build_geo_cache()
print(f'  {sum(1 for v in geo_cache.values() if v.get("region")):,} routes geo-tagged.')


# ── Reverse-geocoding (Nominatim, rate-limited, persistent bucket cache) ──

nominatim = NominatimClient(NOMINATIM_USER_AGENT)
geocode_cache = GeocodeBucketCache.load(GEOCODE_BUCKETS_PATH)
if geocode_cache.corrupt_moved_to is not None:
    print(f'WARNING: {GEOCODE_BUCKETS_PATH.name} was corrupt; moved aside to '
          f'{geocode_cache.corrupt_moved_to.name}', file=sys.stderr)
if geocode_cache.dropped:
    print(f'  {geocode_cache.dropped} unusable geocode bucket entries will be asked again.')


def _save_geocode_buckets():
    geocode_cache.save()


def cached_reverse_geocode(lat, lng):
    """'City, ST' / 'City, Country', or None. A transient failure is not cached."""
    return outcome_label(geocode_cache.resolve(lat, lng, nominatim.reverse))


def _save_classify_caches():
    try:
        write_json_atomic(GEO_CACHE_PATH, geo_cache)
        _save_geocode_buckets()
    except OSError as error:
        print(f'[classify] could not save geocode caches: {error}', file=sys.stderr)


# ── Background classify worker ──

_classify_state = initial_classify_state()
_classify_lock = threading.Lock()


def _classify_snapshot():
    with _classify_lock:
        return public_classify_state(_classify_state)


def _transition_classify(event):
    global _classify_state
    with _classify_lock:
        _classify_state = reduce_classify(_classify_state, event)
        return public_classify_state(_classify_state)


def _unmapped_route_ids():
    """Routes that have GPS coords but no friendly region (still a raw 'lat°, lng°' string or None)."""
    out = []
    for aid, info in geo_cache.items():
        lat = info.get('lat')
        lng = info.get('lng')
        region = info.get('region')
        if lat is None or lng is None:
            continue
        if not region or '°' in region:
            out.append((aid, lat, lng))
    return out


def _abandon_classify_if_running():
    global _classify_state
    with _classify_lock:
        if _classify_state['phase'] == 'running':
            _classify_state = reduce_classify(_classify_state, {'type': 'fail'})


def classify_unmapped_worker(candidates):
    try:
        print(f'[classify] starting: {len(candidates)} unmapped routes')
        save_every = 25
        for i, (aid, lat, lng) in enumerate(candidates):
            label = cached_reverse_geocode(lat, lng)
            if label:
                geo_cache[aid]['region'] = label
            _transition_classify({'type': 'progress', 'done': i + 1, 'label': label or ''})
            if (i + 1) % save_every == 0:
                _save_classify_caches()
        _save_classify_caches()
        snapshot = _transition_classify({'type': 'finish', 'finished_at': time.time()})
        print(f'[classify] done: {snapshot["updated"]} labels added')
    finally:
        _abandon_classify_if_running()


def start_classify_if_needed():
    global _classify_state
    with _classify_lock:
        if _classify_state['phase'] == 'running':
            return 'running'
        candidates = _unmapped_route_ids()
        if not candidates:
            return 'idle'
        _classify_state = reduce_classify(
            _classify_state, {'type': 'start', 'total': len(candidates)},
        )
        captured = list(candidates)
    try:
        threading.Thread(target=classify_unmapped_worker, args=(captured,), daemon=True).start()
    except BaseException:
        # Without a worker nothing would ever leave `running`, and every later
        # start would answer "Already running." forever.
        _abandon_classify_if_running()
        raise
    return 'started'


# Kick off auto-classify on startup if there's work to do
if start_classify_if_needed() == 'started':
    print(f'  Background classifier started ({_classify_snapshot()["total"]} unmapped routes).')


# ── Background rebuild ──

_rebuild_state = initial_rebuild_state()
_rebuild_lock = threading.Lock()
OWNER_MUTATION_BUSY = 'another owner mutation is in progress'


def _rebuild_snapshot():
    with _rebuild_lock:
        return public_rebuild_state(_rebuild_state)


def _mutation_busy_body():
    """The 409 body for a held mutation lock, naming a running rebuild."""
    body = {'error': OWNER_MUTATION_BUSY}
    rebuild = _rebuild_snapshot()
    if rebuild['phase'] == 'running':
        body['reason'] = (
            f"rebuild {rebuild['id']} is running; saves and rebuilds are refused until it finishes"
        )
    return body


def _run_build():
    """Run build.py and return its exit code and stderr tail. Stdout is discarded."""
    with tempfile.TemporaryFile() as stderr:
        completed = subprocess.run(
            [sys.executable, str(QUESTS / 'build.py')],
            cwd=str(QUESTS),
            stdout=subprocess.DEVNULL,
            stderr=stderr,
            check=False,
        )
        size = stderr.seek(0, os.SEEK_END)
        stderr.seek(max(0, size - 4 * 1024))
        return completed.returncode, stderr_tail(stderr.read())


def _settle_rebuild(event):
    """Record the outcome and free the lock together, so no reader sees one without the other."""
    global _rebuild_state
    with _rebuild_lock:
        _rebuild_state = reduce_rebuild(_rebuild_state, event)
        OWNER_MUTATION_LOCK.release()


def _rebuild_worker(rebuild_id):
    event = {
        'type': 'fail', 'id': rebuild_id, 'exit_code': None,
        'stderr_tail': 'rebuild worker stopped unexpectedly',
    }
    try:
        try:
            exit_code, tail = _run_build()
        except Exception as error:
            exit_code, tail = None, stderr_tail(f'{type(error).__name__}: {error}'.encode())
        if exit_code == 0:
            event = {'type': 'succeed', 'id': rebuild_id}
        else:
            event = {'type': 'fail', 'id': rebuild_id, 'exit_code': exit_code, 'stderr_tail': tail}
            print(f'[rebuild] {rebuild_id} failed (exit {exit_code})', file=sys.stderr)
    finally:
        _settle_rebuild({**event, 'finished_at': time.time()})


def start_rebuild():
    """Start one background rebuild. Returns (HTTP status, body)."""
    global _rebuild_state
    rebuild_id = uuid.uuid4().hex[:12]
    # Taking the mutation lock and entering `running` happen together, so a
    # refused save always sees the rebuild that holds the lock.
    with _rebuild_lock:
        if not OWNER_MUTATION_LOCK.acquire(blocking=False):
            busy = True
        else:
            busy = False
            _rebuild_state = reduce_rebuild(
                _rebuild_state, {'type': 'start', 'id': rebuild_id, 'started_at': time.time()},
            )
            snapshot = public_rebuild_state(_rebuild_state)
    if busy:
        return 409, _mutation_busy_body()
    try:
        recover_owner_publication(QUESTS)
    except (PublicationRecoveryError, OSError) as error:
        _settle_rebuild({
            'type': 'fail', 'id': rebuild_id, 'finished_at': time.time(),
            'exit_code': None, 'stderr_tail': str(error),
        })
        return 503, {'error': str(error)}
    try:
        threading.Thread(target=_rebuild_worker, args=(rebuild_id,), daemon=True).start()
    except BaseException as error:
        _settle_rebuild({
            'type': 'fail', 'id': rebuild_id, 'finished_at': time.time(),
            'exit_code': None, 'stderr_tail': f'could not start rebuild thread: {error}',
        })
        return 500, {'error': 'Rebuild could not start.', 'detail': str(error)}
    return 200, {'ok': True, 'msg': 'Rebuild started in background.', 'rebuild': snapshot}


def find_activity_file(aid):
    for ext in ('.gpx', '.fit.gz', '.fit'):
        fp = ACTIVITY_DIR / f'{aid}{ext}'
        if fp.exists():
            return fp
    return None


def load_polyline_points(fp):
    pts = []
    if str(fp).endswith('.gpx'):
        with open(fp) as f:
            g = gpxpy.parse(f)
        for t in g.tracks:
            for seg in t.segments:
                for p in seg.points:
                    pts.append((p.latitude, p.longitude))
    elif str(fp).endswith('.fit.gz') and fitparse:
        with gzip.open(fp, 'rb') as f:
            ff = fitparse.FitFile(f)
            for msg in ff.get_messages('record'):
                fields = {x.name: x.value for x in msg}
                lat = fields.get('position_lat')
                lng = fields.get('position_long')
                if lat is not None and lng is not None:
                    if isinstance(lat, int):
                        lat = lat * (180 / 2**31)
                        lng = lng * (180 / 2**31)
                    pts.append((lat, lng))
    if len(pts) > 200:
        step = max(1, len(pts) // 200)
        pts = pts[::step] + [pts[-1]]
    return pts


def make_svg(pts, w=240, h=140):
    if len(pts) < 3:
        return ''
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    lat_min, lat_max = min(lats), max(lats)
    lng_min, lng_max = min(lngs), max(lngs)
    dlat = lat_max - lat_min or 1e-6
    dlng = lng_max - lng_min or 1e-6
    avg_lat = (lat_min + lat_max) / 2
    lng_scale = math.cos(math.radians(avg_lat))
    dlng_adj = dlng * lng_scale
    pad = 12
    scale = min((w - 2*pad) / dlng_adj, (h - 2*pad) / dlat)
    map_w = dlng_adj * scale
    map_h = dlat * scale
    off_x = (w - map_w) / 2
    off_y = (h - map_h) / 2
    coords = []
    for lat, lng in pts:
        x = off_x + (lng - lng_min) * lng_scale * scale
        y = off_y + (lat_max - lat) * scale
        coords.append(f'{x:.1f},{y:.1f}')
    return (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'
            f'<polyline points="{" ".join(coords)}" fill="none" stroke="{TEAL}" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')


polyline_cache = {}


def polyline_svg(aid):
    if aid in polyline_cache:
        return polyline_cache[aid]
    fp = find_activity_file(aid)
    if fp is None:
        polyline_cache[aid] = ''
        return ''
    try:
        pts = load_polyline_points(fp)
        svg = make_svg(pts) if pts else ''
    except Exception:
        svg = ''
    polyline_cache[aid] = svg
    return svg


def _summary_distance_km(activity_row, generated_route):
    """Distance for the Admin list.

    A Strava row carries Distance. An imported route does not, so fall back to
    the generated record, which derives distance from the recorded trace.
    """
    if activity_row is not None:
        try:
            return round(float(activity_row.get('Distance') or 0), 1)
        except (TypeError, ValueError):
            pass
    if generated_route:
        try:
            return round(float(generated_route.get('distance_km') or 0), 1)
        except (TypeError, ValueError):
            pass
    return 0.0


def routes_summary():
    cfg = json.loads((QUESTS / 'quests.json').read_text())
    manifest_path = QUESTS / 'app' / 'src' / 'data' / 'generated' / 'routes.manifest.json'
    try:
        generated_routes = {
            str(route['slug']): route
            for route in json.loads(manifest_path.read_text()).get('routes', [])
        }
    except (FileNotFoundError, KeyError, TypeError, json.JSONDecodeError):
        generated_routes = {}
    out = []
    for r in cfg.get('routes', []):
        aid = r['activity_id']
        act = acts_by_id.get(aid)
        # An imported route describes itself in quests.json and has no export
        # row. Resolve metadata through the shared adapter so both source kinds
        # reach the curator. Skipping here is what made an imported route
        # invisible in Admin, and therefore impossible to curate.
        meta = route_metadata(r, QUESTS, act)
        if meta is None:
            continue
        name = meta.name
        date = meta.date
        typ = meta.activity_type
        desc = meta.description
        km = _summary_distance_km(act, generated_routes.get(str(aid)))
        status = normalize_route_status(r.get('status'))
        auto_region = (geo_cache.get(aid) or {}).get('region') or ''
        item = {
            'activity_id': aid,
            'source_kind': meta.source_kind,
            'status': status,
            'region': r.get('region') or '',
            'auto_region': auto_region,
            'name': name,
            'date': date,
            'type': typ,
            'distance_km': km,
            'description': desc[:240],
            'visibility': r.get('visibility') or 'public',
            'curation': r.get('curation') or {'review_status': 'draft'},
            'curation_readiness': curation_readiness(r.get('curation') or {}),
        }
        generated = generated_routes.get(str(aid))
        replay = generated.get('replay', {}) if generated else {}
        item['geometry_status'] = replay.get('geometry_status', 'missing')
        item['replay_eligible'] = replay.get('replay_eligible', False)
        item['generation_status'] = 'ready' if generated else 'missing'
        for field in CURATION_TEXT_FIELDS:
            item[field] = r.get(field) or ''
        out.append(item)
    out.sort(key=lambda r: r['date'] or '', reverse=True)
    return out


def _publication_os_error(error, entered):
    """The response for an OSError that escaped an owner publication.

    owner_publication restores and re-raises only an error raised inside its
    block, and a failed restore raises PublicationRecoveryError instead. An
    OSError from its own recovery or preparation never reached the block.
    """
    if (QUESTS / JOURNAL_NAME).exists():
        return 503, {
            'error': 'Publication recovery is required; the owner publication journal was kept.',
            'detail': str(error),
        }
    if entered:
        return 500, {
            'error': 'Publication failed; previous source and route data restored.',
            'detail': str(error),
        }
    return 500, {
        'error': 'Publication failed; no changes were published.',
        'detail': str(error),
    }


ADMIN_ASSETS = {
    '/admin-assets/classifier-state.js': 'admin-ui/generated/classifier-state.js',
    '/admin-assets/mutation-state.js': 'admin-ui/generated/mutation-state.js',
    "/admin-assets/presentation.js": "admin-ui/generated/presentation.js",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return  # silent

    def _send(self, status, body, ctype='application/json'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body)
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        self.wfile.write(body)

    def _origin_allowed(self):
        origin = self.headers.get('Origin')
        return origin is None or origin in ALLOWED_ORIGINS

    def do_OPTIONS(self):
        origin = self.headers.get('Origin')
        if origin not in ALLOWED_ORIGINS:
            self._send(403, {'error': 'origin not allowed'})
            return
        self.send_response(204)
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/admin.html'):
            html = (QUESTS / 'admin.html').read_text()
            self._send(200, html, 'text/html; charset=utf-8')
            return
        if path in ADMIN_ASSETS:
            asset = (QUESTS / ADMIN_ASSETS[path]).read_bytes()
            self._send(200, asset, 'text/javascript; charset=utf-8')
            return
        if path == '/api/routes':
            self._send(200, routes_summary())
            return
        if path == '/api/admin/status':
            manifest_path = QUESTS / 'app' / 'src' / 'data' / 'generated' / 'routes.manifest.json'
            self._send(200, {
                'writer_available': True,
                'mode': 'local-owner',
                'generation_status': 'ready' if manifest_path.exists() else 'missing',
                'generated_at': (
                    datetime.fromtimestamp(manifest_path.stat().st_mtime).isoformat()
                    if manifest_path.exists() else None
                ),
                'rebuild': _rebuild_snapshot(),
                'checkout_root': str(QUESTS),
                'pid': os.getpid(),
            })
            return
        if path.startswith('/api/polyline/'):
            aid = path.rsplit('/', 1)[1]
            svg = polyline_svg(aid)
            self._send(200, svg or '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
                       'image/svg+xml')
            return
        if path == '/api/classify-status':
            unmapped_now = len(_unmapped_route_ids())
            self._send(200, {**_classify_snapshot(), 'unmapped': unmapped_now})
            return
        self._send(404, {'error': 'not found'})

    def _handle_media_upload(self):
        """Accept one dropped photograph and propose where it belongs.

        The browser cannot decode HEIC and cannot read EXIF, so the file arrives
        here as raw bytes. This endpoint reads the position and the clock,
        proposes an anchor, and publishes a stripped copy. It does not create an
        annotation. A curator accepts a proposal through /api/annotations/save.
        """
        slug = self.headers.get('X-Route-Slug', '')
        if not SLUG_PATTERN.match(slug or ''):
            self._send(400, {'error': 'X-Route-Slug is missing or malformed'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self._send(400, {'error': 'invalid Content-Length'})
            return
        if length <= 0:
            self._send(400, {'error': 'empty upload'})
            return
        if length > MAX_MEDIA_BYTES:
            self._send(413, {'error': 'image too large'})
            return

        detail_path = QUESTS / 'app' / 'public' / 'data' / 'routes' / f'{slug}.json'
        if not detail_path.is_file():
            self._send(404, {'error': f'route {slug} has no generated record'})
            return
        detail = json.loads(detail_path.read_text(encoding='utf-8'))
        temporal = detail.get('provenance', {}).get('temporal', {})

        payload = self.rfile.read(length)
        digest = hashlib.sha256(payload).hexdigest()[:16]
        with tempfile.NamedTemporaryFile(delete=False) as staged:
            staged.write(payload)
            staged_path = Path(staged.name)
        try:
            try:
                photo = read_photo_metadata(
                    staged_path, fallback_time_zone=temporal.get('time_zone')
                )
            except Exception:
                self._send(400, {'error': 'the upload is not a readable image'})
                return
            proposal = match_photo_to_route(
                photo,
                detail.get('route') or [],
                temporal,
                detail.get('provenance', {}).get('discontinuities'),
            )
            media = publish_photo(staged_path, MEDIA_ROOT / slug, slug, digest)
        finally:
            staged_path.unlink(missing_ok=True)

        self._send(200, {
            'ok': True,
            'digest': digest,
            'media': media,
            'match': proposal,
            'had_position': photo.get('lat') is not None,
            'had_time': photo.get('taken_utc') is not None,
        })

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._origin_allowed():
            self._send(403, {'error': 'origin not allowed'})
            return
        # Media arrives as raw bytes, so it is handled before the UTF-8 decode
        # that every JSON endpoint depends on.
        if path == '/api/media/upload':
            if not OWNER_MUTATION_LOCK.acquire(blocking=False):
                self._send(409, _mutation_busy_body())
                return
            try:
                recover_owner_publication(QUESTS)
                self._handle_media_upload()
            except (PublicationRecoveryError, OSError) as error:
                self._send(503, {'error': str(error)})
            finally:
                OWNER_MUTATION_LOCK.release()
            return
        try:
            n = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self._send(400, {'error': 'invalid Content-Length'})
            return
        if n < 0:
            self._send(400, {'error': 'invalid Content-Length'})
            return
        if n > MAX_POST_BYTES:
            self._send(413, {'error': 'request body too large'})
            return
        try:
            body = self.rfile.read(n).decode('utf-8') if n else ''
        except UnicodeDecodeError:
            self._send(400, {'error': 'request body must be UTF-8'})
            return
        if path == '/api/save':
            if not OWNER_MUTATION_LOCK.acquire(blocking=False):
                self._send(409, _mutation_busy_body())
                return
            try:
                recover_owner_publication(QUESTS)
                data = json.loads(body)
                if not isinstance(data, dict) or not isinstance(data.get('routes', []), list):
                    raise ValueError('request must contain a routes list')
                updates = data.get('routes', [])
                if any(not isinstance(update, dict) or 'activity_id' not in update for update in updates):
                    raise ValueError('every route update must contain an activity_id')
                # Validate every status before changing any route, so a bad
                # status refuses the whole request.
                for update in updates:
                    if 'status' in update:
                        validate_route_status(update['status'])
                config_path = QUESTS / 'quests.json'
                cfg = json.loads(config_path.read_text(encoding='utf-8'))
                routes = cfg.get('routes')
                if not isinstance(routes, list):
                    raise ValueError('quests.json must contain a routes list')
                route_ids = [route.get('activity_id') for route in routes]
                if len(route_ids) != len(set(route_ids)):
                    raise ValueError('quests.json contains duplicate activity ids')
                by_id = {route['activity_id']: route for route in routes}
                updated = 0
                for update in updates:
                    aid = update['activity_id']
                    if aid not in by_id:
                        continue
                    if 'status' in update:
                        by_id[aid]['status'] = update['status']
                    if 'region' in update:
                        by_id[aid]['region'] = update['region'] or None
                    for field in CURATION_TEXT_FIELDS:
                        if field in update:
                            value = str(update[field]).strip()
                            if value:
                                by_id[aid][field] = value
                            else:
                                by_id[aid].pop(field, None)
                    if 'visibility' in update:
                        value = str(update['visibility']).strip()
                        if value and value not in CURATION_VISIBILITIES:
                            raise ValueError(
                                f'visibility must be one of: {", ".join(CURATION_VISIBILITIES)}'
                            )
                        if value and value != 'public':
                            by_id[aid]['visibility'] = value
                        else:
                            by_id[aid].pop('visibility', None)
                    updated += 1
                cfg['routes'] = list(by_id.values())
                write_atomic(config_path, json.dumps(cfg, indent=2) + '\n')
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self._send(400, {'error': str(error)})
                return
            except (PublicationRecoveryError, OSError) as error:
                self._send(503, {'error': str(error)})
                return
            finally:
                OWNER_MUTATION_LOCK.release()
            self._send(200, {'ok': True, 'updated': updated})
            return
        if path == '/api/curation/save':
            if not OWNER_MUTATION_LOCK.acquire(blocking=False):
                self._send(409, _mutation_busy_body())
                return
            entered = False
            try:
                data = json.loads(body)
                activity_id = str(data['activity_id'])
                curation = data['curation']

                def rebuild():
                    # A curation edit changes no geometry, so republish only the
                    # artifacts that carry curation. test_curation_publish.py
                    # asserts this equals a full rebuild byte for byte. A route
                    # with no generated record yet still needs the full path.
                    try:
                        publish_curation(QUESTS, activity_id, curation)
                    except CurationPublishError:
                        subprocess.run(
                            [sys.executable, str(QUESTS / 'build.py')],
                            cwd=str(QUESTS),
                            check=True,
                            capture_output=True,
                            text=True,
                            **owner_publication_subprocess_options(QUESTS),
                        )

                with owner_publication(QUESTS, include_source=True):
                    entered = True
                    route = save_curation_and_rebuild(
                        QUESTS / 'quests.json', activity_id, curation, rebuild
                    )
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self._send(400, {'error': str(error)})
                return
            except subprocess.CalledProcessError as error:
                self._send(500, {
                    'error': 'Route generation failed; the curation source was rolled back.',
                    'detail': error.stderr[-1000:] if error.stderr else '',
                })
                return
            except PublicationRecoveryError as error:
                self._send(503, {'error': str(error)})
                return
            except OSError as error:
                self._send(*_publication_os_error(error, entered))
                return
            finally:
                OWNER_MUTATION_LOCK.release()
            self._send(200, {
                'ok': True,
                'activity_id': activity_id,
                'curation': route['curation'],
                'generation_status': 'ready',
            })
            return
        if path == '/api/annotations/save':
            if not OWNER_MUTATION_LOCK.acquire(blocking=False):
                self._send(409, _mutation_busy_body())
                return
            entered = False
            try:
                data = json.loads(body)
                activity_id = str(data['activity_id'])
                annotations = data['annotations']
                with owner_publication(QUESTS, include_source=True):
                    entered = True
                    config_path = QUESTS / 'quests.json'
                    config = json.loads(config_path.read_text(encoding='utf-8'))
                    matching = [
                        route for route in config.get('routes', [])
                        if str(route.get('activity_id')) == activity_id
                    ]
                    if len(matching) != 1:
                        raise ValueError(f'route {activity_id} was not found')
                    published = publish_annotations(QUESTS, activity_id, annotations)
                    matching[0]['annotations'] = published
                    write_atomic(config_path, json.dumps(config, indent=2) + '\n')
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                self._send(400, {'error': str(error)})
                return
            except CurationPublishError as error:
                self._send(409, {'error': str(error)})
                return
            except PublicationRecoveryError as error:
                self._send(503, {'error': str(error)})
                return
            except OSError as error:
                self._send(*_publication_os_error(error, entered))
                return
            finally:
                OWNER_MUTATION_LOCK.release()
            self._send(200, {
                'ok': True,
                'activity_id': activity_id,
                'annotations': published,
            })
            return
        if path == '/api/rebuild':
            self._send(*start_rebuild())
            return
        if path == '/api/auto-classify':
            outcome = start_classify_if_needed()
            self._send(200, {
                'ok': True,
                'msg': {
                    'started': 'Started.',
                    'running': 'Already running.',
                    'idle': 'Nothing to classify.',
                }[outcome],
                **_classify_snapshot(),
            })
            return
        self._send(404, {'error': 'not found'})


def main():
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'\n✓ Admin server running: http://localhost:{PORT}')
    print('  Press Ctrl+C to stop.\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
