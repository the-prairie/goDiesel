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
import math
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import gpxpy
import pandas as pd

try:
    import fitparse
except ImportError:
    fitparse = None

QUESTS = Path('/Users/laurenzary/Desktop/goDiesel')
DD = Path('/Users/laurenzary/Desktop/DieselDiaries')
ACTIVITY_DIR = DD / 'strava_export' / 'activities'
GEO_CACHE_PATH = QUESTS / '.geo_cache.json'
GEOCODE_BUCKETS_PATH = QUESTS / '.geocode_buckets.json'
PORT = 8766
TEAL = '#00F19F'
CURATION_TEXT_FIELDS = ('title', 'theme', 'difficulty', 'blurb', 'completion_rule')
CURATION_VISIBILITIES = ('public', 'hidden')

# Nominatim fair-use: max 1 req/sec, descriptive User-Agent required.
NOMINATIM_USER_AGENT = 'QuestsAdmin/1.0 (personal use; lauren@purposemed.com)'
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
GEOCODE_BUCKET_DEG = 0.05  # ~5 km cells — nearby rides share a single API call

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

# Bounding boxes for auto-region detection. Same data as build.py's region() —
# extend here when you travel somewhere new and the auto-label says "53.1°, -106.6°".
REGIONS = [
    (28, 30, -16, -13, 'Canary Islands'),
    (35, 36.5, 23, 26, 'Crete, Greece'),
    (37, 39.5, 22, 25, 'Mainland Greece'),
    (-9, -8, 115, 115.7, 'Bali, Indonesia'),
    (34.5, 35.5, 135.5, 136, 'Kyoto, Japan'),
    (34, 40, 135, 141, 'Japan'),
    (41.5, 43, 2, 3.5, 'Costa Brava, Spain'),
    (40, 41, -4, -3, 'Madrid, Spain'),
    (48, 49.4, -124.2, -123, 'Victoria, BC'),
    (49, 50, -124, -122.5, 'Vancouver, BC'),
    (49, 50, -126, -125, 'Tofino, BC'),
    (50.5, 51.8, -116, -115, 'Banff/Kananaskis'),
    (50.7, 51.3, -114.4, -113.7, 'Calgary, AB'),
    (51.5, 53, -107, -106, 'Saskatoon, SK'),
    (32.5, 34, -118, -117, 'San Diego, CA'),
    (37.5, 38.5, -123, -122, 'Bay Area, CA'),
]


def classify_region(lat, lng):
    for lo_lat, hi_lat, lo_lng, hi_lng, name in REGIONS:
        if lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng:
            return name
    return f'{lat:.1f}°, {lng:.1f}°'


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
    cache = {}
    if GEO_CACHE_PATH.exists():
        try:
            cache = json.loads(GEO_CACHE_PATH.read_text())
        except Exception:
            cache = {}
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
    GEO_CACHE_PATH.write_text(json.dumps(cache))
    print(f'  Cached: {GEO_CACHE_PATH.name}')
    return cache


print('Loading geo cache…')
geo_cache = build_geo_cache()
print(f'  {sum(1 for v in geo_cache.values() if v.get("region")):,} routes geo-tagged.')


# ── Reverse-geocoding (Nominatim, rate-limited, persistent bucket cache) ──

def _load_geocode_buckets():
    if not GEOCODE_BUCKETS_PATH.exists():
        return {}
    try:
        raw = json.loads(GEOCODE_BUCKETS_PATH.read_text())
        return {tuple(float(x) for x in k.split(',')): v for k, v in raw.items()}
    except Exception:
        return {}


def _save_geocode_buckets():
    serial = {f'{k[0]:.4f},{k[1]:.4f}': v for k, v in geocode_buckets.items()}
    GEOCODE_BUCKETS_PATH.write_text(json.dumps(serial, indent=2, sort_keys=True))


def _bucket_for(lat, lng):
    g = GEOCODE_BUCKET_DEG
    return (round(lat / g) * g, round(lng / g) * g)


geocode_buckets = _load_geocode_buckets()
_geocode_lock = threading.Lock()
_last_geocode_at = 0.0


def reverse_geocode(lat, lng):
    """Hit Nominatim, return 'City, ST' / 'City, Country' / None. Honors 1 req/sec rate limit."""
    global _last_geocode_at
    with _geocode_lock:
        elapsed = time.time() - _last_geocode_at
        if elapsed < 1.05:
            time.sleep(1.05 - elapsed)
        _last_geocode_at = time.time()
    url = NOMINATIM_URL + '?' + urllib.parse.urlencode({
        'lat': f'{lat:.5f}',
        'lon': f'{lng:.5f}',
        'format': 'jsonv2',
        'zoom': 10,
        'addressdetails': 1,
        'accept-language': 'en',
    })
    req = urllib.request.Request(url, headers={
        'User-Agent': NOMINATIM_USER_AGENT,
        'Accept-Language': 'en',
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception:
        return None
    addr = data.get('address') or {}
    city = (addr.get('city') or addr.get('town') or addr.get('village')
            or addr.get('hamlet') or addr.get('municipality')
            or addr.get('county') or addr.get('state_district'))
    state = addr.get('state')
    country_code = (addr.get('country_code') or '').upper()
    country = addr.get('country')
    if not city:
        if state and country_code in ('US', 'CA'):
            return f'{STATE_ABBREV.get(state, state)}'
        if country:
            return country
        return None
    if country_code in ('US', 'CA') and state:
        return f'{city}, {STATE_ABBREV.get(state, state)}'
    if country:
        return f'{city}, {country}'
    return city


def cached_reverse_geocode(lat, lng):
    b = _bucket_for(lat, lng)
    if b in geocode_buckets:
        return geocode_buckets[b]
    label = reverse_geocode(lat, lng)
    geocode_buckets[b] = label  # cache even None — avoids repeated failures
    return label


# ── Background classify worker ──

classify_state = {
    'running': False, 'done': 0, 'total': 0, 'updated': 0,
    'last_label': '', 'finished_at': None,
}


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


def classify_unmapped_worker():
    candidates = _unmapped_route_ids()
    classify_state.update({
        'running': True, 'done': 0, 'updated': 0,
        'total': len(candidates), 'last_label': '', 'finished_at': None,
    })
    if not candidates:
        classify_state['running'] = False
        classify_state['finished_at'] = time.time()
        return
    print(f'[classify] starting: {len(candidates)} unmapped routes')
    save_every = 25
    for i, (aid, lat, lng) in enumerate(candidates):
        label = cached_reverse_geocode(lat, lng)
        if label:
            geo_cache[aid]['region'] = label
            classify_state['updated'] += 1
            classify_state['last_label'] = label
        classify_state['done'] = i + 1
        if (i + 1) % save_every == 0:
            try:
                GEO_CACHE_PATH.write_text(json.dumps(geo_cache))
                _save_geocode_buckets()
            except Exception:
                pass
    try:
        GEO_CACHE_PATH.write_text(json.dumps(geo_cache))
        _save_geocode_buckets()
    except Exception:
        pass
    classify_state['running'] = False
    classify_state['finished_at'] = time.time()
    print(f'[classify] done: {classify_state["updated"]} labels added')


def start_classify_if_needed():
    if classify_state['running']:
        return False
    if not _unmapped_route_ids():
        return False
    t = threading.Thread(target=classify_unmapped_worker, daemon=True)
    t.start()
    return True


# Kick off auto-classify on startup if there's work to do
if start_classify_if_needed():
    print(f'  Background classifier started ({classify_state["total"]} unmapped routes).')


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
    # Downsample for preview rendering
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


def routes_summary():
    cfg = json.loads((QUESTS / 'quests.json').read_text())
    out = []
    for r in cfg.get('routes', []):
        aid = r['activity_id']
        act = acts_by_id.get(aid)
        if act is None:
            continue
        name_raw = act.get('Activity Name')
        name = name_raw if isinstance(name_raw, str) and name_raw.strip() else '(unnamed)'
        date_obj = act['date']
        date = date_obj.strftime('%Y-%m-%d') if date_obj is not None else ''
        typ = act.get('Activity Type') or ''
        try:
            km = float(act.get('Distance') or 0)
        except (TypeError, ValueError):
            km = 0.0
        desc_raw = act.get('Activity Description', '')
        desc = str(desc_raw) if desc_raw and str(desc_raw) != 'nan' else ''
        status = r.get('status', 'pending')
        # Treat legacy 'rejected' as 'archived' (same concept, friendlier name)
        if status == 'rejected':
            status = 'archived'
        auto_region = (geo_cache.get(aid) or {}).get('region') or ''
        item = {
            'activity_id': aid,
            'status': status,
            'region': r.get('region') or '',
            'auto_region': auto_region,
            'name': name,
            'date': date,
            'type': typ,
            'distance_km': round(km, 1),
            'description': desc[:240],
            'visibility': r.get('visibility') or 'public',
        }
        for field in CURATION_TEXT_FIELDS:
            item[field] = r.get(field) or ''
        out.append(item)
    # Sort newest first within each status
    out.sort(key=lambda r: r['date'] or '', reverse=True)
    return out


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
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/admin.html'):
            html = (QUESTS / 'admin.html').read_text()
            self._send(200, html, 'text/html; charset=utf-8')
            return
        if path == '/api/routes':
            self._send(200, routes_summary())
            return
        if path.startswith('/api/polyline/'):
            aid = path.rsplit('/', 1)[1]
            svg = polyline_svg(aid)
            self._send(200, svg or '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
                       'image/svg+xml')
            return
        if path == '/api/classify-status':
            unmapped_now = len(_unmapped_route_ids())
            self._send(200, {**classify_state, 'unmapped': unmapped_now})
            return
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode('utf-8') if n else ''
        if path == '/api/save':
            data = json.loads(body)
            updates = data.get('routes', [])
            cfg = json.loads((QUESTS / 'quests.json').read_text())
            by_id = {r['activity_id']: r for r in cfg['routes']}
            for u in updates:
                aid = u['activity_id']
                if aid not in by_id:
                    continue
                if 'status' in u:
                    by_id[aid]['status'] = u['status']
                if 'region' in u:
                    by_id[aid]['region'] = u['region'] or None
                for field in CURATION_TEXT_FIELDS:
                    if field in u:
                        value = str(u[field]).strip()
                        if value:
                            by_id[aid][field] = value
                        else:
                            by_id[aid].pop(field, None)
                if 'visibility' in u:
                    value = str(u['visibility']).strip()
                    if value and value not in CURATION_VISIBILITIES:
                        self._send(400, {
                            'error': f'visibility must be one of: {", ".join(CURATION_VISIBILITIES)}'
                        })
                        return
                    if value and value != 'public':
                        by_id[aid]['visibility'] = value
                    else:
                        by_id[aid].pop('visibility', None)
            cfg['routes'] = list(by_id.values())
            (QUESTS / 'quests.json').write_text(json.dumps(cfg, indent=2))
            self._send(200, {'ok': True, 'updated': len(updates)})
            return
        if path == '/api/rebuild':
            subprocess.Popen([sys.executable, str(QUESTS / 'build.py')],
                             cwd=str(QUESTS),
                             stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            self._send(200, {'ok': True, 'msg': 'Rebuild started in background.'})
            return
        if path == '/api/auto-classify':
            if classify_state['running']:
                self._send(200, {'ok': True, 'msg': 'Already running.', **classify_state})
                return
            started = start_classify_if_needed()
            self._send(200, {
                'ok': True,
                'msg': 'Started.' if started else 'Nothing to classify.',
                **classify_state,
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
