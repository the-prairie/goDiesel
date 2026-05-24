"""Build the standalone Quests app from curated routes.

Reads:    /Users/laurenzary/Desktop/goDiesel/quests.json
Writes:   /Users/laurenzary/Desktop/goDiesel/index.html
          /Users/laurenzary/Desktop/goDiesel/cards/<slug>.png   (one share card per quest)

Edit quests.json to add/remove routes. Re-run this script (or rebuild.sh).
"""
import base64, gzip, io, json, math, re, textwrap
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pillow_heif; pillow_heif.register_heif_opener()
import gpxpy
import pandas as pd

from quest_meta import build_quest_meta, elevation_gain_m

try: import fitparse
except ImportError: fitparse = None
try: import imagehash
except ImportError: imagehash = None

# ── Paths ──
DD = Path('/Users/laurenzary/Desktop/DieselDiaries')
TRAVEL = Path('/Users/laurenzary/Desktop/Travel')
QUESTS = Path('/Users/laurenzary/Desktop/goDiesel')
CARDS = QUESTS / 'cards'
CARDS.mkdir(exist_ok=True)

TEAL = '#00F19F'; STRAIN = '#0093E7'; SLEEP = '#7BA1BB'
BG = (16, 21, 24); BG_HEX = '#101518'

# ── API key ──
print('[1/5] Map provider: MapLibre GL JS + public terrain tiles')

# ── Load quests.json ──
config = json.loads((QUESTS / 'quests.json').read_text())
# Schema: {routes: [{activity_id, status, region, optional curation fields}]}.
# Only build approved public routes.
all_routes = config.get('routes', config.get('quests', []))
quest_specs = [
    r for r in all_routes
    if r.get('status', 'approved') == 'approved'
    and r.get('visibility', 'public') != 'hidden'
]
pending_n = sum(1 for r in all_routes if r.get('status') == 'pending')
rejected_n = sum(1 for r in all_routes if r.get('status') == 'rejected')
print(f'[2/5] Curation: {len(quest_specs)} approved · {pending_n} pending · {rejected_n} rejected')

# ── Load Strava activities ──
def parse_strava_date(s):
    if not isinstance(s, str): return None
    MM = {'Jan':'January','Feb':'February','Mar':'March','Apr':'April','May':'May',
          'Jun':'June','Jul':'July','Aug':'August','Sep':'September','Oct':'October',
          'Nov':'November','Dec':'December'}
    dp = s.rsplit(', ', 1)[0].strip()
    for a, f in MM.items():
        if dp.startswith(a + ' '): dp = f + dp[len(a):]; break
    try: return datetime.strptime(dp, '%B %d, %Y')
    except: return None

df = pd.read_csv(DD / 'activities.csv')
df['date'] = df['Activity Date'].apply(parse_strava_date)
df['km'] = pd.to_numeric(df['Distance'], errors='coerce').fillna(0)
df['act_id'] = df['Filename'].fillna('').astype(str).apply(
    lambda s: re.match(r'.*?/(\d+)', s).group(1) if re.match(r'.*?/(\d+)', s) else None)
acts_by_id = {r['act_id']: r for _, r in df.iterrows() if r['act_id']}

def hav_m(lat1, lng1, lat2, lng2):
    R = 6371000
    dLat = math.radians(lat2-lat1); dLng = math.radians(lng2-lng1)
    a = math.sin(dLat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dLng/2)**2
    return 2*R*math.asin(math.sqrt(a))

def load_polyline(fp):
    pts = []
    if str(fp).endswith('.gpx'):
        with open(fp) as f:
            g = gpxpy.parse(f)
        for t in g.tracks:
            for s in t.segments:
                for p in s.points:
                    pts.append((p.latitude, p.longitude,
                                p.elevation if p.elevation else 0))
    elif str(fp).endswith('.fit.gz') and fitparse:
        with gzip.open(fp, 'rb') as f:
            ff = fitparse.FitFile(f)
            for msg in ff.get_messages('record'):
                fields = {x.name: x.value for x in msg}
                lat = fields.get('position_lat'); lng = fields.get('position_long')
                alt = fields.get('enhanced_altitude') or fields.get('altitude')
                if lat is not None and lng is not None:
                    if isinstance(lat, int):
                        lat = lat * (180 / 2**31); lng = lng * (180 / 2**31)
                    pts.append((lat, lng, float(alt) if alt else 0))
    if not pts: return []
    route = [(pts[0][0], pts[0][1], pts[0][2], 0.0)]
    cum = 0
    for i in range(1, len(pts)):
        d = hav_m(pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1])
        cum += d
        if cum - route[-1][3] >= 50:
            route.append((pts[i][0], pts[i][1], pts[i][2], cum))
    last = pts[-1]
    route.append((last[0], last[1], last[2], cum))
    return route

def find_activity_file(activity_id):
    base = DD / 'strava_export/activities'
    for ext in ('.gpx', '.fit.gz', '.fit'):
        fp = base / f'{activity_id}{ext}'
        if fp.exists(): return fp
    return None

def dms_to_deg(dms, ref):
    deg = float(dms[0]) + float(dms[1])/60 + float(dms[2])/3600
    if ref in ('S','W'): deg = -deg
    return deg

def read_exif_and_hash(path):
    try:
        im = Image.open(path)
        exif = im.getexif()
        if not exif: return None
        gps = exif.get_ifd(0x8825)
        if not gps or 2 not in gps or 4 not in gps: return None
        lat = dms_to_deg(gps[2], gps.get(1, 'N'))
        lng = dms_to_deg(gps[4], gps.get(3, 'E'))
        dt_str = None
        exif_ifd = exif.get_ifd(0x8769)
        if exif_ifd and 0x9003 in exif_ifd: dt_str = exif_ifd[0x9003]
        ts = None
        if dt_str:
            try: ts = datetime.strptime(dt_str, '%Y:%m:%d %H:%M:%S')
            except: pass
        ph = imagehash.phash(im.convert('RGB'), hash_size=8) if imagehash else None
        return {'lat': lat, 'lng': lng, 'dt': ts, 'phash': ph}
    except: return None

# ── Scan iPhone photos + dedup once ──
print('[3/5] Scanning iPhone photos…')
all_photos = []
for sub in TRAVEL.rglob('*'):
    if not sub.is_file(): continue
    if sub.suffix.lower() not in ('.heic','.jpg','.jpeg','.png'): continue
    e = read_exif_and_hash(sub)
    if not e: continue
    all_photos.append({'path': sub, **e})
print(f'    With GPS: {len(all_photos)}')
if imagehash and all_photos:
    all_photos.sort(key=lambda p: (p['dt'] or datetime(2099,1,1)))
    kept = []
    for p in all_photos:
        if not any(p['phash'] - k['phash'] <= 6 for k in kept):
            kept.append(p)
    print(f'    Deduped: {len(kept)}')
else:
    kept = all_photos

def encode_image(path, max_size):
    """Legacy base64 encoder. Kept for user-uploaded photos that need inline form."""
    with Image.open(path) as im:
        im = im.convert('RGB')
        im.thumbnail((max_size, max_size), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=80, optimize=True)
        return base64.b64encode(buf.getvalue()).decode()


def write_resized_jpeg(src_path, out_path, max_size, quality=80):
    """Resize source image to fit max_size and write as JPEG. Returns final (w, h)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src_path) as im:
        im = im.convert('RGB')
        im.thumbnail((max_size, max_size), Image.LANCZOS)
        im.save(out_path, 'JPEG', quality=quality, optimize=True, progressive=True)
        return im.size


PHOTOS_ROOT = QUESTS / 'photos'

def route_svg(route_js, w=160, h=110, color=TEAL):
    if not route_js or len(route_js) < 3: return ''
    lats = [p['lat'] for p in route_js]; lngs = [p['lng'] for p in route_js]
    lat_min, lat_max = min(lats), max(lats)
    lng_min, lng_max = min(lngs), max(lngs)
    dlat = lat_max - lat_min or 1e-6
    dlng = lng_max - lng_min or 1e-6
    avg_lat = (lat_min + lat_max) / 2
    lng_scale = math.cos(math.radians(avg_lat))
    dlng_adj = dlng * lng_scale
    pad = 16
    scale = min((w - 2*pad) / dlng_adj, (h - 2*pad) / dlat)
    map_w = dlng_adj * scale; map_h = dlat * scale
    off_x = (w - map_w) / 2; off_y = (h - map_h) / 2
    pts = []
    for p in route_js:
        x = off_x + (p['lng'] - lng_min) * lng_scale * scale
        y = off_y + (lat_max - p['lat']) * scale
        pts.append(f'{x:.1f},{y:.1f}')
    return (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
            f'opacity="0.95"/></svg>')

# ── Share card generator (PIL, 1200×630) ──
FONT_DIR = Path('/System/Library/Fonts')
def load_font(name, size):
    candidates = [
        FONT_DIR / 'Supplemental' / name,
        FONT_DIR / name,
    ]
    for c in candidates:
        if c.exists():
            try: return ImageFont.truetype(str(c), size)
            except: pass
    return ImageFont.load_default()

FONT_BOLD = load_font('HelveticaNeue.ttc', 48)  # works for system fallback
FONT_BIG = load_font('Helvetica.ttc', 64) or FONT_BOLD
FONT_MED = load_font('Helvetica.ttc', 24) or FONT_BOLD
FONT_SMALL = load_font('Menlo.ttc', 14) or FONT_BOLD
FONT_ITALIC = load_font('HelveticaNeue.ttc', 26)

def draw_type_icon(d, x, y, activity_type, color, size=36, stroke=3):
    """Draw a small vector bike or runner icon at (x, y). PIL-only — no font needed."""
    s = size
    if activity_type == 'Ride':
        # Two wheels + frame (geometric bicycle)
        wheel_r = int(s * 0.20)
        rear_cx,  rear_cy  = x + int(s * 0.22), y + int(s * 0.72)
        front_cx, front_cy = x + int(s * 0.78), y + int(s * 0.72)
        d.ellipse([(rear_cx - wheel_r,  rear_cy - wheel_r),
                   (rear_cx + wheel_r,  rear_cy + wheel_r)],
                  outline=color, width=stroke)
        d.ellipse([(front_cx - wheel_r, front_cy - wheel_r),
                   (front_cx + wheel_r, front_cy + wheel_r)],
                  outline=color, width=stroke)
        # Frame: rear hub → top tube → front hub
        top     = (x + int(s * 0.50), y + int(s * 0.30))
        seat    = (x + int(s * 0.40), y + int(s * 0.18))
        handle  = (x + int(s * 0.70), y + int(s * 0.20))
        d.line([(rear_cx, rear_cy), top, (front_cx, front_cy)], fill=color, width=stroke)
        d.line([top, seat], fill=color, width=stroke)
        d.line([top, handle], fill=color, width=stroke)
    else:  # Run
        head_r = int(s * 0.10)
        hx, hy = x + int(s * 0.58), y + int(s * 0.16)
        d.ellipse([(hx - head_r, hy - head_r), (hx + head_r, hy + head_r)],
                  outline=color, width=stroke)
        shoulder = (x + int(s * 0.48), y + int(s * 0.36))
        hip      = (x + int(s * 0.56), y + int(s * 0.62))
        # Body
        d.line([shoulder, hip], fill=color, width=stroke)
        # Arms (one forward, one back)
        d.line([shoulder, (x + int(s * 0.76), y + int(s * 0.32))], fill=color, width=stroke)
        d.line([shoulder, (x + int(s * 0.28), y + int(s * 0.48))], fill=color, width=stroke)
        # Legs (running stance)
        d.line([hip, (x + int(s * 0.74), y + int(s * 0.90))], fill=color, width=stroke)
        d.line([hip, (x + int(s * 0.36), y + int(s * 0.88))], fill=color, width=stroke)


def render_share_card(quest, baseline_photos, out_path):
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    # Subtle vertical gradient
    for y in range(H):
        f = y / H
        col = tuple(int(BG[i] + (24 - BG[i]) * (1 - f) * 0.3) for i in range(3))
        d.line([(0,y),(W,y)], fill=col)

    # Brand kicker
    d.ellipse([(48, 60), (60, 72)], fill=TEAL)
    d.text((76, 56), 'godiesel · LAUREN ZARY', font=FONT_SMALL, fill='#CCCCCC')

    # Big title (uppercase, with letter spacing)
    title = quest['name'].upper()
    d.text((48, 130), title, font=FONT_BIG, fill='#FFFFFF')

    # Type chip — hand-drawn vector icon + text label (no emoji font dependency)
    type_color = STRAIN if quest['type'] == 'Ride' else TEAL
    draw_type_icon(d, 48, 214, quest['type'], type_color, size=36, stroke=3)
    type_str = f"{quest['type'].upper()}   ·   {quest['distance_km']:.1f} KM   ·   {quest['xp']} XP"
    d.text((96, 220), type_str, font=FONT_MED, fill=type_color)

    # Subtitle quote — PIL doesn't wrap, so trim word-by-word until it fits one line
    inner = quest['subtitle'] or ''
    max_quote_w = W - 96  # 48px padding each side
    def _text_w(s):
        try:
            return d.textlength(s, font=FONT_ITALIC)
        except AttributeError:
            bbox = d.textbbox((0, 0), s, font=FONT_ITALIC)
            return bbox[2] - bbox[0]
    quote = f'"{inner}"'
    if _text_w(quote) > max_quote_w:
        trimmed = inner
        while trimmed and _text_w(f'"{trimmed}…"') > max_quote_w:
            if ' ' in trimmed:
                trimmed = trimmed.rsplit(' ', 1)[0]
            else:
                trimmed = trimmed[:-1]
        quote = f'"{trimmed}…"' if trimmed else ''
    if quote:
        d.text((48, 268), quote, font=FONT_ITALIC, fill='#DDDDDD')

    # Quest rule at bottom (region already in the title — no need to repeat)
    footer = f"{quest['theme'].upper()} QUEST · {quest['difficulty'].upper()} · {quest['date'] or ''}"
    d.text((48, H - 64), footer, font=FONT_SMALL, fill='#7BA1BB')

    # Route silhouette — draw the polyline directly with PIL (left side, lower area)
    rt = quest['route']
    if rt and len(rt) >= 3:
        lats = [p['lat'] for p in rt]; lngs = [p['lng'] for p in rt]
        lat_min, lat_max = min(lats), max(lats)
        lng_min, lng_max = min(lngs), max(lngs)
        dlat = lat_max - lat_min or 1e-6
        dlng = lng_max - lng_min or 1e-6
        avg_lat = (lat_min + lat_max) / 2
        lng_scale = math.cos(math.radians(avg_lat))
        dlng_adj = dlng * lng_scale
        bx, by, bw, bh = 48, 330, 350, 240
        scale = min((bw - 30) / dlng_adj, (bh - 30) / dlat)
        map_w = dlng_adj * scale; map_h = dlat * scale
        off_x = bx + (bw - map_w) / 2
        off_y = by + (bh - map_h) / 2
        prev = None
        for p in rt:
            x = off_x + (p['lng'] - lng_min) * lng_scale * scale
            y = off_y + (lat_max - p['lat']) * scale
            if prev is not None:
                d.line([prev, (x, y)], fill=TEAL, width=3)
            prev = (x, y)

    # Photo collage (right side, 4-up grid where photos exist)
    box_x, box_y, box_w, box_h = 600, 330, 552, 240
    if baseline_photos:
        photos_to_show = baseline_photos[:4]
        cols = 2 if len(photos_to_show) >= 2 else 1
        rows = 2 if len(photos_to_show) > 2 else (1 if len(photos_to_show) >= 1 else 0)
        pw = (box_w - (cols-1)*8) // cols
        ph = (box_h - (rows-1)*8) // rows if rows else 0
        for i, p in enumerate(photos_to_show):
            r, c = divmod(i, cols)
            x = box_x + c * (pw + 8); y = box_y + r * (ph + 8)
            try:
                src = p.get('_full_path')
                if src:
                    pimg = Image.open(src)
                else:
                    # Back-compat: user-uploaded base64 photo
                    pimg = Image.open(io.BytesIO(base64.b64decode(p.get('full', ''))))
                pimg = pimg.convert('RGB')
                pimg = pimg.resize((pw, ph), Image.LANCZOS)
                # Round corners
                mask = Image.new('L', (pw, ph), 0)
                ImageDraw.Draw(mask).rounded_rectangle([(0,0),(pw,ph)], radius=10, fill=255)
                img.paste(pimg, (x, y), mask)
            except: pass
    else:
        # Empty state in the box
        d.rounded_rectangle([(box_x, box_y), (box_x+box_w, box_y+box_h)],
                            radius=10, outline='#2A3540', width=1)
        d.text((box_x + 30, box_y + box_h//2 - 14),
               'NO PHOTOS YET · DRAG ONTO ROUTE',
               font=FONT_SMALL, fill='#5A5A5A')

    img.save(out_path, 'PNG', optimize=True)

# ── Region auto-detect (for fallback) ──
def region(lat, lng):
    R = [(28,30,-16,-13,'Canary Islands'),(35,36.5,23,26,'Crete, Greece'),
         (37,39.5,22,25,'Mainland Greece'),(-9,-8,115,115.7,'Bali, Indonesia'),
         (34.5,35.5,135.5,136,'Kyoto, Japan'),(34,40,135,141,'Japan'),
         (41.5,43,2,3.5,'Costa Brava, Spain'),(40,41,-4,-3,'Madrid, Spain'),
         (48,49,-124,-123,'Victoria, BC'),(49,50,-124,-122.5,'Vancouver, BC'),
         (49,50,-126,-125,'Tofino, BC'),(50.5,51.8,-116,-115,'Banff/Kananaskis'),
         (51.5,53,-107,-106,'Saskatoon, SK'),(33,34,-118,-117,'San Diego, CA'),
         (37.5,38.5,-123,-122,'Bay Area, CA')]
    for lo_lat, hi_lat, lo_lng, hi_lng, name in R:
        if lo_lat <= lat <= hi_lat and lo_lng <= lng <= hi_lng:
            return name
    return f'{lat:.1f}°, {lng:.1f}°'

# ── Build each quest ──
print('[4/5] Building quests…')
routes_data = []
for spec in quest_specs:
    aid = spec['activity_id']
    act = acts_by_id.get(aid)
    if act is None:
        print(f'    ✗ {aid}: not found in activities.csv'); continue
    fp = find_activity_file(aid)
    if fp is None:
        print(f'    ✗ {aid}: no .gpx/.fit file'); continue
    route = load_polyline(fp)
    if not route:
        print(f'    ✗ {aid}: empty polyline'); continue
    distance_km = route[-1][3] / 1000

    # Auto-fill metadata from CSV
    name = (act['Activity Name'] if isinstance(act['Activity Name'], str) else '(unnamed)')
    date = act['date'].strftime('%Y-%m-%d') if act['date'] else ''
    typ = act['Activity Type']
    desc = act.get('Activity Description', '')
    desc = str(desc) if desc and str(desc) != 'nan' else ''

    # Auto-detect region if not specified
    region_label = spec.get('region') or region(route[0][0], route[0][1])

    # Slug from activity_id
    slug = aid

    # Match photos by proximity (500km)
    lats = [p[0] for p in route]; lngs = [p[1] for p in route]
    cx = (min(lats) + max(lats)) / 2; cy = (min(lngs) + max(lngs)) / 2
    # Photos: write resized JPEGs to photos/<slug>/ and reference by URL.
    # Each entry also carries an internal _full_path for the share-card renderer;
    # we strip that before serializing to JSON.
    quest_photo_dir = PHOTOS_ROOT / slug
    matched = [p for p in kept if hav_m(cx, cy, p['lat'], p['lng']) / 1000 <= 500]
    baseline_photos = []
    for idx, p in enumerate(matched):
        try:
            thumb_path = quest_photo_dir / f'{idx:02d}-thumb.jpg'
            full_path = quest_photo_dir / f'{idx:02d}.jpg'
            write_resized_jpeg(p['path'], thumb_path, 240)
            write_resized_jpeg(p['path'], full_path, 900)
            baseline_photos.append({
                'thumb_url': f'photos/{slug}/{idx:02d}-thumb.jpg',
                'full_url':  f'photos/{slug}/{idx:02d}.jpg',
                '_full_path': str(full_path),  # stripped before JSON
                'lat': p['lat'], 'lng': p['lng'],
                'dt': p['dt'].strftime('%b %d, %Y') if p['dt'] else '',
                'dt_full': p['dt'].strftime('%b %d %H:%M') if p['dt'] else '',
                'source': 'auto',
            })
        except Exception:
            pass
    baseline_photos.sort(key=lambda x: x['dt_full'])
    visual_source = {
        'kind': 'route_photos' if baseline_photos else 'generated_route',
        'label': 'Route photos' if baseline_photos else 'Generated route preview',
        'description': (
            'Matched photos from Lauren’s route archive.'
            if baseline_photos
            else 'Stable route art shown when no photo source is available.'
        ),
    }

    route_js = [{'lat': pt[0], 'lng': pt[1], 'elev': pt[2], 'd': pt[3]} for pt in route]
    quest_meta = build_quest_meta(
        activity_type=typ,
        distance_km=round(distance_km, 1),
        elevation_gain=elevation_gain_m(route_js),
        region_label=region_label,
        activity_name=name,
    )
    for _field, _target in (
        ('theme', 'theme'),
        ('difficulty', 'difficulty'),
        ('completion_rule', 'completion_rule'),
        ('blurb', 'quest_blurb'),
    ):
        if spec.get(_field):
            quest_meta[_target] = str(spec[_field]).strip()

    subtitle = str(spec.get('title') or name).strip()

    quest = {
        'slug': slug,
        'activity_id': aid,
        'name': region_label,
        'subtitle': subtitle,
        'activity_name': name,
        'region': region_label,
        'date': date,
        'distance_km': round(distance_km, 1),
        'type': typ,
        'description': desc,
        'route': route_js,
        'center_lat': cx, 'center_lng': cy,
        'mid_idx': len(route_js) // 2,
        'baseline_photos': baseline_photos,
        'visual_source': visual_source,
        'svg': route_svg(route_js),
        **quest_meta,
    }
    routes_data.append(quest)
    # Generate share card
    render_share_card(quest, baseline_photos, CARDS / f'{slug}.png')
    print(f'    ✓ {region_label:28s} {typ:5s} {distance_km:.1f}km · {len(baseline_photos)} photos · card saved')

# Sort routes by date (newest first feels right for a portfolio)
routes_data.sort(key=lambda r: r['date'], reverse=True)
print(f'\n[5/5] Generating index.html…')

# Stream the giant HTML template
# Strip server-side-only fields (e.g. _full_path used by share card generator)
# before serializing to the public HTML.
for r in routes_data:
    for ph in r.get('baseline_photos', []):
        ph.pop('_full_path', None)
data_json = json.dumps(routes_data)

# Build app HTML — same as previous version but with Share-card button
HTML_TEMPLATE_PATH = Path('/tmp/quests_template.html')
template_html = '''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B1014">
<meta name="description" content="Lauren&rsquo;s quest atlas — real runs and rides turned into repeatable adventure challenges.">
<title>godiesel quest atlas · Lauren Zary</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.css">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --teal: #00F19F; --strain: #0093E7; --sleep: #7BA1BB; --red: #FF0026;
  --bg: #0B1014; --bg-card: #141A1F; --bg-card-hover: #1A2227;
  --border: #2A3540; --text: #FFF; --text-dim: #888; --text-faint: #5A5A5A;
}
html, body { background: var(--bg); color: var(--text);
  font-family: 'Inter', sans-serif;
  -webkit-font-smoothing: antialiased; min-height: 100vh; }

header { position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 32px; background: rgba(11,16,20,0.92);
  backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 14px; }
.brand-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--teal);
             box-shadow: 0 0 12px rgba(0,241,159,0.7); }
.brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.16em; }
.brand-sub { font-family: 'JetBrains Mono', monospace; font-size: 10px;
            color: var(--text-faint); letter-spacing: 1.5px; text-transform: uppercase; }
.back-btn { display: none; align-items: center; gap: 8px;
  background: var(--bg-card); border: 1px solid var(--border);
  color: var(--text); padding: 8px 14px; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 10px;
  letter-spacing: 1.5px; text-transform: uppercase; cursor: pointer;
  transition: all 200ms ease; }
.back-btn:hover { border-color: var(--teal); color: var(--teal); }

.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
           gap: 18px; padding: 32px; }
.gallery-intro { grid-column: 1 / -1; max-width: 920px; margin-bottom: 10px; }
.atlas-kicker { font-family: 'JetBrains Mono', monospace; font-size: 10px;
                 color: var(--teal); letter-spacing: 1.8px; text-transform: uppercase;
                 margin-bottom: 8px; }
.gallery-intro h2 { font-size: 34px; font-weight: 800; letter-spacing: -0.4px; }
.gallery-intro p { color: var(--text-dim); font-size: 14px;
                   line-height: 1.7; margin-top: 8px; max-width: 640px; }
.gallery-intro b { color: #DDD; }
.gallery-count { font-family: 'JetBrains Mono', monospace; font-size: 11px;
                 color: var(--teal); letter-spacing: 1.5px; margin-top: 4px; }
.atlas-stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.atlas-stat { border: 1px solid var(--border); background: #10171B;
              border-radius: 8px; padding: 10px 12px; min-width: 116px; }
.atlas-stat b { display: block; font-size: 18px; color: #FFF; letter-spacing: -0.2px; }
.atlas-stat span { display: block; margin-top: 3px; font-family: 'JetBrains Mono', monospace;
                   font-size: 9px; color: var(--text-faint); letter-spacing: 1.3px;
                   text-transform: uppercase; }
.gallery-filters { grid-column: 1 / -1; display: flex; flex-wrap: wrap;
                   align-items: flex-end; gap: 10px; margin: 0 0 4px; }
.filter-field { display: flex; flex-direction: column; gap: 5px; min-width: 130px; }
.filter-field label { font-family: 'JetBrains Mono', monospace; font-size: 9px;
                      color: var(--text-faint); letter-spacing: 1.4px;
                      text-transform: uppercase; }
.filter-field select { appearance: none; background: #10171B; color: var(--text);
                       border: 1px solid var(--border); border-radius: 6px;
                       padding: 8px 30px 8px 10px;
                       font-family: 'JetBrains Mono', monospace; font-size: 10px;
                       letter-spacing: 1px; text-transform: uppercase; cursor: pointer;
                       background-image:
                         linear-gradient(45deg, transparent 50%, var(--text-dim) 50%),
                         linear-gradient(135deg, var(--text-dim) 50%, transparent 50%);
                       background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
                       background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.filter-field select:focus { outline: none; border-color: var(--teal);
                             box-shadow: 0 0 0 2px rgba(0,241,159,0.12); }
.filter-reset { background: transparent; color: var(--text-dim);
                border: 1px solid var(--border); border-radius: 6px;
                padding: 8px 12px; font-family: 'JetBrains Mono', monospace;
                font-size: 10px; letter-spacing: 1.3px; text-transform: uppercase;
                cursor: pointer; transition: all 200ms ease; }
.filter-reset:hover { border-color: var(--teal); color: var(--teal); }
.gallery-empty { grid-column: 1 / -1; border: 1px dashed var(--border);
                 border-radius: 10px; padding: 28px; text-align: center;
                 color: var(--text-dim); font-family: 'JetBrains Mono', monospace;
                 font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; }

.quest-card { background: var(--bg-card); border: 1px solid var(--border);
              border-radius: 14px; padding: 18px; cursor: pointer;
              transition: all 220ms ease;
              display: flex; flex-direction: column; gap: 12px; position: relative; }
.quest-card:hover { background: var(--bg-card-hover); border-color: var(--teal);
                    transform: translateY(-3px); box-shadow: 0 12px 36px rgba(0,241,159,0.12); }
.quest-svg { background: #0F1518; border-radius: 8px; padding: 10px; height: 130px;
             display: flex; align-items: center; justify-content: center; }
.quest-svg svg { max-width: 100%; max-height: 100%; }
.quest-row { display: flex; align-items: center; justify-content: space-between;
             gap: 10px; }
.quest-name { font-size: 15px; font-weight: 700; letter-spacing: -0.2px;
              text-transform: uppercase; }
.quest-meta { font-family: 'JetBrains Mono', monospace; font-size: 10px;
              color: var(--text-dim); letter-spacing: 1.2px; text-transform: uppercase;
              display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.quest-meta .dot { color: var(--text-faint); }
.quest-badges { display: flex; gap: 6px; flex-wrap: wrap; }
.quest-chip { font-family: 'JetBrains Mono', monospace; font-size: 9px;
              font-weight: 600; padding: 4px 8px; border-radius: 999px;
              letter-spacing: 1px; text-transform: uppercase;
              background: rgba(123,161,187,0.10); color: #AFC4D2; }
.quest-chip.xp { background: rgba(0,241,159,0.12); color: var(--teal); }
.quest-chip.theme { background: rgba(0,147,231,0.12); color: #83CFFF; }
.quest-type { font-family: 'JetBrains Mono', monospace; font-size: 9px;
              font-weight: 600; padding: 3px 8px; border-radius: 12px;
              letter-spacing: 1.2px; text-transform: uppercase; }
.quest-type.run  { background: rgba(0,241,159,0.12); color: var(--teal); }
.quest-type.ride { background: rgba(0,147,231,0.12); color: var(--strain); }
.quest-title { color: #DDD; font-style: italic; font-size: 13px;
               line-height: 1.5; min-height: 38px; }
.quest-goal { color: var(--text-dim); font-size: 12px; line-height: 1.5;
              border-top: 1px solid var(--border); padding-top: 10px; }
.quest-photo-badge { position: absolute; top: 14px; right: 14px;
                     font-family: 'JetBrains Mono', monospace; font-size: 9px;
                     background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 10px;
                     color: var(--teal); letter-spacing: 1px; }
.quest-photo-badge.empty { color: var(--text-faint); }

.detail { display: none; height: calc(100dvh - 67px); flex-direction: column; overflow: hidden; }
.detail.active { display: flex; }
.detail-header { display: grid; grid-template-columns: minmax(0, 1fr);
                 row-gap: 10px; padding: 12px 32px 11px;
                 border-bottom: 1px solid var(--border); background: #0A0F12; }
.detail-topline { display: grid; grid-template-columns: minmax(0, 1fr) auto;
                  align-items: start; gap: 18px; min-width: 0; }
.detail-identity { min-width: 0; }
.detail-name { font-size: 18px; font-weight: 800; letter-spacing: 0.10em;
               text-transform: uppercase; }
.detail-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px;
               color: var(--text-dim); letter-spacing: 1.2px; text-transform: uppercase; }
.detail-brief { display: grid; grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1.1fr);
                align-items: stretch; gap: 12px; min-width: 0; }
.detail-quote { color: #C7D0D5; font-style: italic; font-size: 13px;
                border-left: 2px solid var(--teal); padding-left: 12px;
                align-self: center; min-width: 0; }
.detail-desc { width: 100%; color: #999; font-size: 13px; line-height: 1.6;
               font-style: italic; padding-left: 12px;
               border-left: 2px solid var(--sleep); max-width: 700px; }
.detail-quest-meta { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; }
.completion-panel { width: 100%; display: grid;
                    grid-template-columns: minmax(240px, 1fr) auto;
                    gap: 9px; min-width: 0; }
.completion-item { background: transparent; border: 1px solid rgba(123,161,187,0.18);
                   border-radius: 7px; padding: 8px 10px; min-width: 0; }
.completion-item.objective { background: rgba(0,241,159,0.04); border-color: rgba(0,241,159,0.22); }
.completion-stack { display: grid; grid-template-columns: repeat(4, minmax(78px, 1fr)); gap: 8px; }
.completion-label { font-family: 'JetBrains Mono', monospace; font-size: 8px;
                    color: var(--teal); letter-spacing: 1.4px;
                    text-transform: uppercase; }
.completion-value { margin-top: 5px; color: #DDD; font-size: 12px;
                    line-height: 1.45; overflow-wrap: anywhere; }
.share-btn { background: rgba(20,26,31,0.88); border: 1px solid var(--border);
             color: var(--text); padding: 8px 10px; border-radius: 6px;
             font-family: 'JetBrains Mono', monospace; font-size: 9px;
             letter-spacing: 1.3px; text-transform: uppercase; cursor: pointer;
             transition: all 200ms ease; display: inline-flex; align-items: center; gap: 6px; }
.share-btn:hover { border-color: var(--teal); color: var(--teal); }
.detail-actions { display: flex; gap: 8px; flex-wrap: nowrap; flex-shrink: 0; justify-content: flex-end; }

.stage { flex: 1; position: relative; min-height: 0; background: #071014; }
.panel-map { position: relative; width: 100%; height: 100%; overflow: hidden; }
#map { width: 100%; height: 100%; }
.artifact-panel { position: absolute; top: 16px; right: 16px; width: min(360px, calc(100% - 352px));
                  min-width: 300px; border: 1px solid rgba(42,53,64,0.78);
                  border-radius: 10px; background: linear-gradient(180deg, rgba(9,16,20,0.90), rgba(9,12,14,0.74));
                  backdrop-filter: blur(12px); z-index: 4; overflow: hidden;
                  box-shadow: 0 18px 50px rgba(0,0,0,0.28); pointer-events: none; }
.artifact-canvas { width: 100%; height: 170px; display: block;
                   background: radial-gradient(circle at 55% 45%, rgba(0,241,159,0.14), transparent 48%),
                               linear-gradient(135deg, rgba(0,147,231,0.10), rgba(208,186,119,0.10)); }
.artifact-footer { display: grid; grid-template-columns: 1.2fr 0.8fr 0.8fr; gap: 1px;
                   border-top: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); }
.artifact-stat { padding: 10px 11px; background: rgba(6,10,12,0.72); min-width: 0; }
.artifact-stat b { display: block; color: #FFF; font-family: 'JetBrains Mono', monospace;
                   font-size: 11px; letter-spacing: 1px; white-space: nowrap; }
.artifact-stat span { display: block; margin-top: 5px; color: var(--text-dim);
                      font-family: 'JetBrains Mono', monospace; font-size: 8px;
                      text-transform: uppercase; letter-spacing: 1.2px; }
.artifact-label { position: absolute; left: 12px; top: 12px;
                  font-family: 'JetBrains Mono', monospace; font-size: 9px;
                  color: var(--teal); letter-spacing: 1.6px; text-transform: uppercase; }
.artifact-copy { position: absolute; left: 12px; top: 30px; max-width: 190px;
                 color: rgba(255,255,255,0.52); font-size: 11px; line-height: 1.35; }
.info-card { position: absolute; top: 16px; left: 16px;
             background: rgba(10,12,14,0.88); border: 1px solid var(--border);
             border-radius: 8px; padding: 10px 12px;
             backdrop-filter: blur(8px); max-width: 320px; z-index: 3; }
.info-title { font-size: 13px; font-weight: 700; letter-spacing: -0.2px; }
.info-stats { font-family: 'JetBrains Mono', monospace; font-size: 10px;
              color: var(--text-dim); letter-spacing: 1px; text-transform: uppercase;
              margin-top: 6px; }
.info-stats b { color: #FFF; }

.scrubber-wrap { position: absolute; bottom: 16px; left: 16px; right: 16px;
                 background: rgba(10,12,14,0.88); border: 1px solid var(--border);
                 border-radius: 8px; padding: 10px 14px;
                 display: flex; align-items: center; gap: 14px;
                 backdrop-filter: blur(8px); z-index: 5; }
.scrubber-pos { font-family: 'JetBrains Mono', monospace; font-size: 11px;
                color: var(--teal); min-width: 140px; letter-spacing: 1px; }
.route-lock { flex: 0 0 auto; background: rgba(20,26,31,0.92);
              border: 1px solid rgba(123,161,187,0.28); color: var(--text-dim);
              border-radius: 6px; padding: 7px 9px;
              font-family: 'JetBrains Mono', monospace; font-size: 9px;
              letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer;
              transition: border-color 180ms ease, color 180ms ease, background 180ms ease; }
.route-lock.active { color: var(--teal); border-color: rgba(0,241,159,0.7);
                     background: rgba(0,241,159,0.08); box-shadow: 0 0 18px rgba(0,241,159,0.12); }
input[type=range] { flex: 1; height: 4px; -webkit-appearance: none;
                    background: #1F2A33; border-radius: 2px; outline: none; }
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
  background: var(--teal); cursor: pointer; box-shadow: 0 0 12px rgba(0,241,159,0.6); }
input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%;
  background: var(--teal); cursor: pointer; border: none; }

.photo-strip { position: absolute; bottom: 70px; left: 16px; right: 16px;
               background: rgba(10,12,14,0.92); border: 1px dashed var(--border);
               border-radius: 10px; padding: 10px 14px;
               backdrop-filter: blur(8px); z-index: 4;
               min-height: 124px;
               display: flex; gap: 10px; align-items: center;
               transition: all 200ms ease; }
.photo-strip.dragging { border: 1.5px dashed var(--teal); background: rgba(0,241,159,0.06); }
.photo-strip-label { font-family: 'JetBrains Mono', monospace; font-size: 9px;
                     color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase;
                     writing-mode: vertical-rl; transform: rotate(180deg);
                     border-right: 1px solid var(--border); padding-right: 10px; margin-right: 4px;
                     white-space: nowrap; }
.photo-strip-scroll { display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden;
                      scrollbar-width: thin; scrollbar-color: var(--border) transparent;
                      flex: 1; min-height: 100px; }
.photo-strip-scroll::-webkit-scrollbar { height: 4px; }
.photo-strip-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.photo-thumb { position: relative; flex: 0 0 130px; height: 100px;
               border-radius: 6px; overflow: hidden; cursor: pointer;
               border: 1.5px solid var(--border);
               transition: border-color 200ms ease, transform 200ms ease; }
.photo-thumb img { width: 100%; height: 100%; object-fit: cover;
                   filter: brightness(0.92) saturate(1.08);
                   transition: filter 200ms ease; }
.photo-thumb:hover { border-color: var(--teal); transform: translateY(-2px); }
.photo-thumb:hover img { filter: brightness(1.05) saturate(1.2); }
.photo-thumb.active { border-color: var(--teal); box-shadow: 0 0 18px rgba(0,241,159,0.4); }
.photo-thumb-tag { position: absolute; bottom: 4px; left: 4px;
                   font-family: 'JetBrains Mono', monospace; font-size: 8px;
                   color: #FFF; background: rgba(0,0,0,0.65); padding: 2px 5px;
                   border-radius: 3px; letter-spacing: 0.5px; }
.photo-thumb-remove { position: absolute; top: 4px; right: 4px;
                      width: 20px; height: 20px; border-radius: 50%;
                      background: rgba(0,0,0,0.7); color: #FFF;
                      display: none; align-items: center; justify-content: center;
                      font-size: 12px; cursor: pointer; line-height: 1; }
.photo-thumb:hover .photo-thumb-remove { display: flex; }
.photo-thumb-remove:hover { background: var(--red); }
.photo-thumb.user::before { content: 'YOU'; position: absolute; top: 4px; left: 4px;
  font-family: 'JetBrains Mono', monospace; font-size: 7px;
  color: var(--strain); background: rgba(0,0,0,0.65); padding: 2px 4px;
  border-radius: 3px; letter-spacing: 0.5px; font-weight: 600; }
.empty-msg { flex: 1; text-align: center; padding: 18px;
             font-family: 'JetBrains Mono', monospace; font-size: 10px;
             color: var(--text-faint); letter-spacing: 1.5px; text-transform: uppercase;
             line-height: 1.8; }
.empty-msg b { color: var(--teal); display: block; }

.photo-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.92);
               backdrop-filter: blur(10px); z-index: 1000;
               display: none; align-items: center; justify-content: center;
               padding: 60px; cursor: pointer; }
.photo-modal.open { display: flex; }
.photo-modal img { max-width: 100%; max-height: 100%; border-radius: 8px;
                   box-shadow: 0 12px 60px rgba(0,0,0,0.8); cursor: default; }
.photo-modal .caption { position: absolute; bottom: 30px; left: 50%; transform: translateX(-50%);
                        font-family: 'JetBrains Mono', monospace; font-size: 11px;
                        color: #DDD; letter-spacing: 1.5px;
                        background: rgba(10,12,14,0.85); padding: 8px 16px; border-radius: 6px; }

.drop-overlay { position: fixed; inset: 0; background: rgba(0,241,159,0.10);
                backdrop-filter: blur(6px); z-index: 999; pointer-events: none;
                display: none; align-items: center; justify-content: center; }
.drop-overlay.active { display: flex; }
.drop-overlay-inner { padding: 40px 60px; border: 2px dashed var(--teal); border-radius: 16px;
                      background: rgba(11,16,20,0.85); text-align: center; }
.drop-overlay-inner h2 { font-size: 20px; letter-spacing: 0.1em; text-transform: uppercase; }
.drop-overlay-inner p { font-family: 'JetBrains Mono', monospace; font-size: 11px;
                        color: var(--teal); letter-spacing: 1.5px; margin-top: 8px; }

/* Share modal */
.share-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.92);
               backdrop-filter: blur(10px); z-index: 1100;
               display: none; align-items: center; justify-content: center;
               padding: 40px; flex-direction: column; gap: 20px; }
.share-modal.open { display: flex; }
.share-modal img { max-width: 1200px; width: 100%; border-radius: 8px;
                   box-shadow: 0 12px 60px rgba(0,0,0,0.8); }
.share-modal-actions { display: flex; gap: 12px; }
.share-modal-actions a { background: var(--teal); color: #000;
                         padding: 10px 18px; border-radius: 6px; text-decoration: none;
                         font-family: 'JetBrains Mono', monospace; font-size: 11px;
                         letter-spacing: 1.5px; text-transform: uppercase; font-weight: 700; }
.share-modal-actions button { background: transparent; color: var(--text);
                              border: 1px solid var(--border); padding: 10px 18px;
                              border-radius: 6px; cursor: pointer;
                              font-family: 'JetBrains Mono', monospace; font-size: 11px;
                              letter-spacing: 1.5px; text-transform: uppercase; }

/* Inline SVG icon sizing — keeps icons aligned with text */
.icon { width: 1em; height: 1em; vertical-align: -0.15em; flex: 0 0 auto; }
.icon-lg { width: 1.2em; height: 1.2em; }
.share-btn.strava-btn:hover { border-color: #FC4C02; color: #FC4C02; }

/* ──────────── Mobile (≤ 700px) ──────────── */
@media (max-width: 700px) {
  /* Header: tighter padding, drop the tagline to save space */
  header { padding: 12px 16px; }
  .brand-sub { display: none; }
  .brand-title { font-size: 13px; letter-spacing: 0.14em; }
  .back-btn { padding: 7px 12px; font-size: 9px; }

  /* Gallery */
  .gallery { padding: 18px 14px 32px; gap: 12px;
             grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .gallery-intro { margin-bottom: 4px; }
  .atlas-kicker { font-size: 9px; }
  .gallery-intro h2 { font-size: 26px; line-height: 1.15; }
  .gallery-intro p { font-size: 13px; line-height: 1.6; }
  .gallery-count { font-size: 10px; }
  .atlas-stats { gap: 8px; }
  .atlas-stat { flex: 1 1 30%; min-width: 96px; padding: 9px 10px; }
  .atlas-stat b { font-size: 16px; }
  .gallery-filters { gap: 8px; }
  .filter-field { flex: 1 1 calc(50% - 8px); min-width: 0; }
  .filter-reset { flex: 1 1 100%; padding: 9px 12px; }

  .quest-card { padding: 14px; border-radius: 12px; }
  .quest-svg { height: 110px; padding: 8px; }
  .quest-name { font-size: 14px; }
  .quest-meta { font-size: 9px; }
  .quest-title { font-size: 12px; }
  .quest-goal { font-size: 12px; }

  /* Detail header: stack vertically so title doesn't fight with action buttons */
  .detail { height: auto; min-height: calc(100dvh - 57px); overflow: visible; }
  .detail-header { padding: 12px 14px; gap: 10px; }
  .detail-topline { grid-template-columns: 1fr; gap: 10px; }
  .detail-brief { grid-template-columns: 1fr; gap: 8px; }
  .detail-name { font-size: 16px; letter-spacing: 0.06em;
                 white-space: normal; word-break: keep-all; }
  .detail-meta { font-size: 10px; white-space: nowrap;
                 overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .detail-quote { font-size: 12px; max-width: 100%; padding-left: 10px;
                  border-left-width: 2px; }
  .detail-desc { font-size: 12px; padding-left: 10px; max-width: 100%; }
  .completion-panel { grid-template-columns: 1fr; gap: 7px; }
  .completion-stack { grid-template-columns: 1fr 1fr; gap: 7px; }
  .completion-stack .completion-item { flex: 1 1 calc(50% - 7px); }
  .completion-value { font-size: 11px; }
  .detail-actions { width: 100%; }
  .detail-actions { flex-wrap: wrap; }
  .detail-actions .share-btn { flex: 1; justify-content: center;
                               padding: 9px 12px; font-size: 10px; }

  .stage { min-height: 72dvh; height: 72dvh; }
  .panel-map { border-right: none; border-bottom: 1px solid var(--border); }

  /* Map overlays scale down */
  .info-card { max-width: calc(100% - 24px); padding: 10px 12px;
               top: 10px; left: 12px; right: 12px; }
  .info-title { font-size: 12px; }
  .info-stats { font-size: 9px; }
  .artifact-panel { top: auto; left: 10px; right: 10px; bottom: 62px;
                    width: auto; min-width: 0; }
  .artifact-canvas { height: 132px; }
  .artifact-copy { display: none; }
  .artifact-footer { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .artifact-stat { padding: 8px 9px; }
  .artifact-stat b { font-size: 10px; }

  .scrubber-wrap { bottom: 10px; left: 10px; right: 10px;
                   padding: 8px 12px; gap: 10px; }
  .scrubber-pos { min-width: 100px; font-size: 10px; }
  .route-lock { padding: 7px 8px; font-size: 8px; }

  /* Photo strip: lose the vertical "YOUR PHOTOS" label on small screens.
     Hide entirely when empty (drag-and-drop is desktop-only anyway). */
  .photo-strip { bottom: 64px; left: 10px; right: 10px;
                 padding: 8px 10px; min-height: 96px; gap: 8px; }
  .photo-strip-label { display: none; }
  .photo-strip.empty { display: none; }
  .photo-thumb { flex: 0 0 92px; height: 72px; }

  /* Photo modal */
  .photo-modal { padding: 20px; }
  .photo-modal .caption { bottom: 14px; font-size: 9px; padding: 6px 12px; }

  /* Share modal */
  .share-modal { padding: 20px; gap: 14px; }
  .share-modal img { max-width: 100%; }
  .share-modal-actions a, .share-modal-actions button {
    padding: 9px 14px; font-size: 10px; }

  /* Drop overlay: not useful on touch, hide it */
  .drop-overlay-inner { padding: 24px 32px; }
  .drop-overlay-inner h2 { font-size: 16px; }
}
</style></head>
<body>

<!-- SVG icon sprite — referenced via <svg class="icon"><use href="#i-..."/></svg> -->
<svg width="0" height="0" style="display:none" aria-hidden="true">
  <symbol id="i-bike" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5.5" cy="17.5" r="3.5"/>
    <circle cx="18.5" cy="17.5" r="3.5"/>
    <path d="M5.5 17.5L10 8h4l4.5 9.5"/>
    <path d="M10 8l-1.5-3h-2"/>
    <path d="M14 8h3"/>
  </symbol>
  <symbol id="i-runner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="15" cy="4.5" r="1.8"/>
    <path d="M9 21l3-6 3 2 3 5"/>
    <path d="M8 13l3-4 3 1 3-3"/>
    <path d="M6 17l-2-2"/>
  </symbol>
  <symbol id="i-camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 8a2 2 0 012-2h2.5l1.5-2h6l1.5 2H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
    <circle cx="12" cy="13" r="3.5"/>
  </symbol>
  <symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4v12"/>
    <path d="M7 11l5 5 5-5"/>
    <path d="M5 20h14"/>
  </symbol>
  <symbol id="i-external" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 4h6v6"/>
    <path d="M20 4L10 14"/>
    <path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"/>
  </symbol>
</svg>

<header>
  <div class="brand">
    <div class="brand-dot"></div>
    <div>
      <div class="brand-title">godiesel</div>
      <div class="brand-sub">QUEST ATLAS · REAL ROUTES, PLAYABLE DAYS</div>
    </div>
  </div>
  <button class="back-btn" id="backBtn" onclick="showGallery()">← ALL QUESTS</button>
</header>

<div class="gallery" id="gallery">
  <div class="gallery-intro">
    <div class="atlas-kicker">Prototype quest atlas</div>
    <h2>Pick a quest. Go diesel.</h2>
    <p>Lauren&rsquo;s real runs and rides have been turned into repeatable adventure
       challenges. Each quest has a route, a rule, a reward, and the photos
       that made the day worth remembering.</p>
    <div class="gallery-count" id="galleryCount"></div>
    <div class="atlas-stats" id="atlasStats"></div>
  </div>
  <div class="gallery-filters" id="galleryFilters" aria-label="Quest filters">
    <div class="filter-field">
      <label for="filterType">Type</label>
      <select id="filterType" data-filter="type"></select>
    </div>
    <div class="filter-field">
      <label for="filterDifficulty">Difficulty</label>
      <select id="filterDifficulty" data-filter="difficulty"></select>
    </div>
    <div class="filter-field">
      <label for="filterRegion">Region</label>
      <select id="filterRegion" data-filter="region"></select>
    </div>
    <div class="filter-field">
      <label for="filterTheme">Theme</label>
      <select id="filterTheme" data-filter="theme"></select>
    </div>
    <button class="filter-reset" type="button" onclick="resetFilters()">Clear filters</button>
  </div>
</div>

<div class="detail" id="detail">
  <div class="detail-header">
    <div class="detail-topline">
      <div class="detail-identity">
        <div class="detail-name" id="detailName"></div>
        <div class="detail-meta" id="detailMeta"></div>
      </div>
      <div class="detail-actions">
        <a class="share-btn strava-btn" id="stravaBtn" href="#" target="_blank" rel="noopener" title="Open this activity on Strava">
          <svg class="icon"><use href="#i-external"/></svg> OPEN ON STRAVA
        </a>
        <button class="share-btn" id="copyLinkBtn" onclick="copyQuestLink()" title="Copy a direct link to this quest">
          <svg class="icon"><use href="#i-external"/></svg> COPY LINK
        </button>
        <button class="share-btn" id="shareBtn" onclick="openShareCard()">
          <svg class="icon"><use href="#i-camera"/></svg> SHARE CARD
        </button>
      </div>
    </div>
    <div class="detail-brief">
      <div class="detail-quote" id="detailQuote"></div>
      <div class="completion-panel" id="completionPanel"></div>
      <div class="detail-desc" id="detailDesc" style="display:none"></div>
    </div>
  </div>
  <div class="stage">
    <div class="panel-map">
      <div id="map"></div>
      <div class="info-card">
        <div class="info-title" id="poiTitle">Loading…</div>
        <div class="info-stats">
          <b id="kmDone">0.0 km</b> / <span id="kmTotal">— km</span> along route
          &nbsp;·&nbsp; <b id="elevHere">0 m</b> elev
        </div>
      </div>
      <div class="artifact-panel" aria-label="Route elevation artifact">
        <canvas class="artifact-canvas" id="artifactCanvas"></canvas>
        <div class="artifact-label">Three.js elevation</div>
        <div class="artifact-copy">Route profile rendered as a compact terrain object.</div>
        <div class="artifact-footer">
          <div class="artifact-stat"><b id="artifactKm">0.0 / 0.0 km</b><span>along route</span></div>
          <div class="artifact-stat"><b id="artifactElev">0 m</b><span>current elev</span></div>
          <div class="artifact-stat"><b id="artifactClimb">0 m</b><span>total climb</span></div>
        </div>
      </div>
      <div class="scrubber-wrap">
        <div class="scrubber-pos" id="scrubberPos">0.00 / 0.00 km</div>
        <input type="range" id="scrubber" min="0" max="100" value="0">
        <button class="route-lock active" id="routeLockBtn" type="button" onclick="toggleRouteLock()" title="Keep the camera following the active point">LOCK VIEW</button>
      </div>
    </div>
  </div>
</div>

<div class="photo-modal" id="photoModal" onclick="closePhoto()">
  <img id="photoFull" src="" alt="" onclick="event.stopPropagation()">
  <div class="caption" id="photoCaption"></div>
</div>

<div class="drop-overlay" id="dropOverlay">
  <div class="drop-overlay-inner">
    <h2>Drop to add to this quest</h2>
    <p>JPG · PNG · HEIC accepted</p>
  </div>
</div>

<div class="share-modal" id="shareModal">
  <img id="shareImg" src="" alt="">
  <div class="share-modal-actions">
    <a id="shareDownload" href="" download="quest-share-card.png"><svg class="icon"><use href="#i-download"/></svg> DOWNLOAD PNG</a>
    <button onclick="closeShareCard()">CLOSE</button>
  </div>
</div>

<script src="https://unpkg.com/maplibre-gl@5.18.0/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/three@0.150.1/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js"></script>
<script>
const ROUTES = __ROUTES_JSON__;
let activeRouteIdx = -1;
let map, mapSlug = null;
let routeViewLocked = true;
let routeLockCameraReady = false;
let artifactRenderer = null, artifactScene = null, artifactCamera = null;
let artifactFullLine = null, artifactProgressLine = null, artifactMarker = null, artifactBlocks = [];
let artifactPoints = [], artifactSlug = null;
let allPhotos = [];
const STORAGE_KEY_PREFIX = 'quests:photos:';

const galleryFilters = {
  type: 'All',
  difficulty: 'All',
  region: 'All',
  theme: 'All',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function uniqueRouteValues(key) {
  return [...new Set(ROUTES.map(r => r[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function setSelectOptions(id, values) {
  const select = document.getElementById(id);
  select.innerHTML = '';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function initFilterControls() {
  setSelectOptions('filterType', ['All', 'Run', 'Ride']);
  setSelectOptions('filterDifficulty', ['All', 'Easy', 'Moderate', 'Epic']);
  setSelectOptions('filterRegion', ['All', ...uniqueRouteValues('region')]);
  setSelectOptions('filterTheme', ['All', ...uniqueRouteValues('theme')]);
  document.querySelectorAll('[data-filter]').forEach(select => {
    select.addEventListener('change', e => {
      galleryFilters[e.target.dataset.filter] = e.target.value;
      renderGallery();
    });
  });
}

function routeMatchesFilters(route) {
  return Object.entries(galleryFilters).every(([key, value]) =>
    value === 'All' || route[key] === value);
}

function resetFilters() {
  Object.keys(galleryFilters).forEach(key => { galleryFilters[key] = 'All'; });
  document.querySelectorAll('[data-filter]').forEach(select => { select.value = 'All'; });
  renderGallery();
}

function questHash(slug) {
  return `#quest/${encodeURIComponent(slug)}`;
}

function questUrl(route) {
  return `${location.origin}${location.pathname}${location.search}${questHash(route.slug)}`;
}

function routeIndexBySlug(slug) {
  return ROUTES.findIndex(route => route.slug === slug);
}

function setQuestUrl(route) {
  if (!route || location.hash === questHash(route.slug)) return;
  history.pushState({ quest: route.slug }, '', questHash(route.slug));
}

function setGalleryUrl() {
  if (!location.hash) return;
  history.pushState({ gallery: true }, '', `${location.pathname}${location.search}`);
}

function handleCurrentUrl() {
  const match = location.hash.match(/^#quest\\/(.+)$/);
  if (!match) {
    showGallery({ updateUrl: false });
    return;
  }
  const slug = decodeURIComponent(match[1]);
  const idx = routeIndexBySlug(slug);
  if (idx === -1) showGallery({ updateUrl: false });
  else openRoute(idx, { updateUrl: false });
}

function renderGallery() {
  const gal = document.getElementById('gallery');
  Array.from(gal.querySelectorAll('.quest-card, .gallery-empty')).forEach(el => el.remove());
  const filteredRoutes = ROUTES
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => routeMatchesFilters(route));
  const filtered = filteredRoutes.map(({ route }) => route);
  const totalUser = filtered.reduce((s, r) => s + getStoredPhotos(r.slug).length, 0);
  const totalPhotos = filtered.reduce((s, r) => s + r.baseline_photos.length, 0) + totalUser;
  const totalKm = filtered.reduce((s,r)=>s+r.distance_km,0);
  const totalXp = filtered.reduce((s,r)=>s+(r.xp || 0),0);
  const totalClimb = filtered.reduce((s,r)=>s+(r.elevation_gain_m || 0),0);
  const suffix = filtered.length === ROUTES.length ? '' : ` · FILTERED FROM ${ROUTES.length}`;
  document.getElementById('galleryCount').textContent =
    `${filtered.length} QUEST${filtered.length === 1 ? '' : 'S'} · ${totalPhotos} PHOTOS · ${totalKm.toFixed(0)} KM TOTAL${suffix}`;
  document.getElementById('atlasStats').innerHTML = `
    <div class="atlas-stat"><b>${filtered.length}</b><span>quests</span></div>
    <div class="atlas-stat"><b>${totalKm.toFixed(0)}</b><span>km mapped</span></div>
    <div class="atlas-stat"><b>${totalXp.toLocaleString()}</b><span>xp available</span></div>
    <div class="atlas-stat"><b>${Math.round(totalClimb).toLocaleString()}</b><span>m climbing</span></div>
  `;
  if (filteredRoutes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'gallery-empty';
    empty.textContent = 'No quests match these filters.';
    gal.appendChild(empty);
    return;
  }
  filteredRoutes.forEach(({ route: r, index: i }) => {
    const card = document.createElement('div');
    card.className = 'quest-card';
    const userPhotos = getStoredPhotos(r.slug).length;
    const totalPhotos = r.baseline_photos.length + userPhotos;
    const typeClass = r.type === 'Ride' ? 'ride' : 'run';
    const typeIcon  = r.type === 'Ride'
      ? '<svg class="icon"><use href="#i-bike"/></svg>'
      : '<svg class="icon"><use href="#i-runner"/></svg>';
    const yearMonth = r.date ? r.date.substring(0,7) : '';
    card.innerHTML = `
      <div class="quest-photo-badge ${totalPhotos > 0 ? '' : 'empty'}">
        ${totalPhotos > 0
          ? '<svg class="icon"><use href="#i-camera"/></svg> ' + totalPhotos
          : 'no photos yet'}
      </div>
      <div class="quest-svg">${r.svg}</div>
      <div class="quest-row">
        <div class="quest-name">${r.name}</div>
        <div class="quest-type ${typeClass}">${typeIcon} ${r.type.toUpperCase()}</div>
      </div>
      <div class="quest-meta">
        <span>${r.distance_km.toFixed(1)} km</span>
        <span class="dot">·</span>
        <span>${(r.elevation_gain_m || 0).toLocaleString()} m up</span>
        <span class="dot">·</span>
        <span>${yearMonth}</span>
      </div>
      <div class="quest-badges">
        <span class="quest-chip xp">${(r.xp || 0).toLocaleString()} XP</span>
        <span class="quest-chip theme">${r.theme || 'Quest'}</span>
        <span class="quest-chip">${r.difficulty || 'Open'}</span>
      </div>
      <div class="quest-title">"${r.subtitle}"</div>
      <div class="quest-goal">${r.completion_rule || ''}</div>
    `;
    card.onclick = () => openRoute(i);
    gal.appendChild(card);
  });
}

function renderCompletionPanel(route) {
  const panel = document.getElementById('completionPanel');
  const baselineCount = route.baseline_photos.length;
  const totalPhotos = baselineCount + getStoredPhotos(route.slug).length;
  const climb = Math.round(route.elevation_gain_m || 0).toLocaleString();
  const objective = route.completion_rule || `Complete ${route.distance_km.toFixed(1)} km.`;
  const facts = [
    ['Reward', `${(route.xp || 0).toLocaleString()} XP`],
    ['Difficulty', route.difficulty || 'Open'],
    ['Proof', `${totalPhotos} photo${totalPhotos === 1 ? '' : 's'}`],
    ['Climb', `${climb} m`],
  ];
  panel.innerHTML = `
    <div class="completion-item objective">
      <div class="completion-label">Objective</div>
      <div class="completion-value">${escapeHtml(objective)}</div>
    </div>
    <div class="completion-stack">
      ${facts.map(([label, value]) => `
        <div class="completion-item">
          <div class="completion-label">${escapeHtml(label)}</div>
          <div class="completion-value">${escapeHtml(value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function openRoute(i, options = {}) {
  const { updateUrl = true } = options;
  activeRouteIdx = i;
  document.getElementById('gallery').style.display = 'none';
  document.getElementById('detail').classList.add('active');
  document.getElementById('backBtn').style.display = 'inline-flex';
  const r = ROUTES[i];
  if (updateUrl) setQuestUrl(r);
  const typeIcon = r.type === 'Ride'
    ? '<svg class="icon"><use href="#i-bike"/></svg>'
    : '<svg class="icon"><use href="#i-runner"/></svg>';
  document.getElementById('detailName').textContent = r.name;
  document.getElementById('detailMeta').innerHTML =
    `${typeIcon} ${r.type.toUpperCase()} · ${r.distance_km.toFixed(1)} KM · ${(r.elevation_gain_m || 0).toLocaleString()} M UP · ${(r.xp || 0).toLocaleString()} XP · ${r.date}`;
  document.getElementById('detailQuote').textContent = r.quest_blurb || `"${r.subtitle}"`;
  document.getElementById('stravaBtn').href =
    `https://www.strava.com/activities/${r.activity_id}`;
  const descEl = document.getElementById('detailDesc');
  if (r.description) {
    descEl.textContent = r.description;
    descEl.style.display = 'block';
  }
  else { descEl.style.display = 'none'; }
  renderCompletionPanel(r);
  document.getElementById('kmTotal').textContent =
    (r.route[r.route.length-1].d / 1000).toFixed(2) + ' km';
  initRoute();
  window.scrollTo(0, 0);
}

function showGallery(options = {}) {
  const { updateUrl = true } = options;
  document.getElementById('gallery').style.display = 'grid';
  document.getElementById('detail').classList.remove('active');
  document.getElementById('backBtn').style.display = 'none';
  activeRouteIdx = -1;
  if (updateUrl) setGalleryUrl();
  renderGallery();
}

function initRoute() {
  const r = ROUTES[activeRouteIdx];
  allPhotos = [...r.baseline_photos.map(p => ({ ...p, source: 'auto' })),
               ...getStoredPhotos(r.slug)];
  try {
    initMainMap(r);
  } catch (err) {
    console.warn('MapLibre route map unavailable', err);
    map = null;
    mapSlug = r.slug;
  }
  try {
    initElevationArtifact(r);
  } catch (err) {
    console.warn('Elevation artifact unavailable', err);
    artifactRenderer = null;
    artifactSlug = r.slug;
  }
  renderStrip();
  syncRouteLockButton();
  const scrubber = document.getElementById('scrubber');
  scrubber.max = r.route.length - 1; scrubber.value = 0;
  setRouteIndex(0);
}

function routeMapStyle({ satellite = false } = {}) {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
      terrain: {
        type: 'raster-dem',
        url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
        tileSize: 256,
      },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm', paint: {
        'raster-saturation': satellite ? -0.15 : -0.45,
        'raster-brightness-min': satellite ? 0.0 : 0.05,
        'raster-brightness-max': satellite ? 0.82 : 0.68,
      } },
      { id: 'hillshade', type: 'hillshade', source: 'terrain', paint: { 'hillshade-shadow-color': '#061014', 'hillshade-highlight-color': '#E5D2A0', 'hillshade-accent-color': '#00F19F' } },
    ],
  };
}

function routeFeature(route, endIdx = route.route.length - 1) {
  const coords = route.route.slice(0, Math.max(1, endIdx + 1)).map(p => [p.lng, p.lat]);
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
}

function pointFeature(point) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [point.lng, point.lat] }, properties: {} };
}

function photoFeatures() {
  return {
    type: 'FeatureCollection',
    features: allPhotos.map((ph, idx) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ph.lng, ph.lat] },
      properties: { idx, label: ph.dt || 'photo' },
    })),
  };
}

function routeBounds(route) {
  const bounds = new maplibregl.LngLatBounds();
  route.route.forEach(p => bounds.extend([p.lng, p.lat]));
  return bounds;
}

function addRouteLayers(targetMap, route, { includePhotos = false } = {}) {
  targetMap.addSource('route-full', { type: 'geojson', data: routeFeature(route) });
  targetMap.addSource('route-progress', { type: 'geojson', data: routeFeature(route, 0) });
  targetMap.addSource('route-point', { type: 'geojson', data: pointFeature(route.route[0]) });
  targetMap.addLayer({
    id: 'route-full-glow', type: 'line', source: 'route-full',
    paint: { 'line-color': '#00F19F', 'line-opacity': 0.20, 'line-width': 8, 'line-blur': 8 },
  });
  targetMap.addLayer({
    id: 'route-full', type: 'line', source: 'route-full',
    paint: { 'line-color': '#BFEFE1', 'line-opacity': 0.35, 'line-width': 3 },
  });
  targetMap.addLayer({
    id: 'route-progress', type: 'line', source: 'route-progress',
    paint: { 'line-color': '#00F19F', 'line-opacity': 0.98, 'line-width': 5 },
  });
  targetMap.addLayer({
    id: 'route-point-halo', type: 'circle', source: 'route-point',
    paint: { 'circle-radius': 15, 'circle-color': '#00F19F', 'circle-opacity': 0.24, 'circle-blur': 0.45 },
  });
  targetMap.addLayer({
    id: 'route-point', type: 'circle', source: 'route-point',
    paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#00F19F', 'circle-stroke-width': 3 },
  });
  if (includePhotos) {
    targetMap.addSource('route-photos', { type: 'geojson', data: photoFeatures() });
    targetMap.addLayer({
      id: 'route-photos', type: 'circle', source: 'route-photos',
      paint: { 'circle-radius': 6, 'circle-color': '#0093E7', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 },
    });
    targetMap.on('click', 'route-photos', e => {
      const idx = e.features?.[0]?.properties?.idx;
      if (idx !== undefined) jumpToPhoto(Number(idx));
    });
    targetMap.on('mouseenter', 'route-photos', () => { targetMap.getCanvas().style.cursor = 'pointer'; });
    targetMap.on('mouseleave', 'route-photos', () => { targetMap.getCanvas().style.cursor = ''; });
  }
}

function initMainMap(route) {
  if (typeof maplibregl === 'undefined') return;
  if (map) {
    map.remove();
    map = null;
  }
  mapSlug = route.slug;
  routeLockCameraReady = false;
  map = new maplibregl.Map({
    container: 'map',
    style: routeMapStyle({ satellite: true }),
    center: [route.center_lng, route.center_lat],
    zoom: 11,
    pitch: 56,
    bearing: -18,
    interactive: true,
    attributionControl: false,
  });
  map.on('load', () => {
    if (!map || mapSlug !== route.slug) return;
    map.setTerrain({ source: 'terrain', exaggeration: 1.28 });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    addRouteLayers(map, route, { includePhotos: true });
    map.fitBounds(routeBounds(route), { padding: 86, duration: 900, pitch: 56, bearing: -18 });
    map.once('moveend', () => { routeLockCameraReady = true; });
    map.on('click', e => snapToRoute(e.lngLat));
    updateMainMapProgress(route, 0);
  });
}

function updateMapSources(targetMap, route, idx) {
  if (!targetMap || !targetMap.isStyleLoaded()) return;
  const progress = targetMap.getSource('route-progress');
  const point = targetMap.getSource('route-point');
  if (progress) progress.setData(routeFeature(route, idx));
  if (point) point.setData(pointFeature(route.route[idx]));
}

function updateMainMapProgress(route, idx) {
  if (!map || mapSlug !== route.slug) return;
  updateMapSources(map, route, idx);
}

function routeBearing(route, idx) {
  const pts = route.route;
  const a = pts[Math.max(0, Math.min(idx, pts.length - 2))];
  const b = pts[Math.max(1, Math.min(idx + 1, pts.length - 1))];
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function updateLockedRouteCamera(route, idx) {
  if (!routeViewLocked || !routeLockCameraReady || !map || mapSlug !== route.slug) return;
  const p = route.route[idx];
  map.easeTo({
    center: [p.lng, p.lat],
    zoom: Math.max(map.getZoom(), 13.2),
    pitch: 62,
    bearing: routeBearing(route, idx),
    duration: 420,
    essential: true,
  });
}

function syncRouteLockButton() {
  const btn = document.getElementById('routeLockBtn');
  if (!btn) return;
  btn.classList.toggle('active', routeViewLocked);
  btn.textContent = routeViewLocked ? 'LOCK VIEW' : 'FREE VIEW';
}

function toggleRouteLock() {
  routeViewLocked = !routeViewLocked;
  syncRouteLockButton();
  if (routeViewLocked && activeRouteIdx !== -1) {
    const idx = Number(document.getElementById('scrubber').value || 0);
    routeLockCameraReady = true;
    updateLockedRouteCamera(ROUTES[activeRouteIdx], idx);
  }
}

function routeArtifactPoints(route) {
  const pts = route.route;
  if (!pts.length) return [];
  const minElev = Math.min(...pts.map(p => Number(p.elev) || 0));
  const maxElev = Math.max(...pts.map(p => Number(p.elev) || 0));
  const elevSpan = Math.max(maxElev - minElev, 1);
  const total = Math.max(pts[pts.length - 1].d || 1, 1);
  return pts.map((p, idx) => {
    const prev = pts[Math.max(0, idx - 1)];
    const x = ((p.d || 0) / total - 0.5) * 8.8;
    const y = ((Number(p.elev) || 0) - minElev) / elevSpan * 2.2 - 0.85;
    const lngDelta = (p.lng - prev.lng) * Math.cos((p.lat * Math.PI) / 180);
    const latDelta = p.lat - prev.lat;
    const z = Math.sin(idx * 0.22) * 0.18 + (latDelta + lngDelta) * 180;
    return new THREE.Vector3(x, y, Math.max(-1.2, Math.min(1.2, z)));
  });
}

function disposeArtifactObject(obj) {
  if (!obj) return;
  obj.traverse?.(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });
}

function drawArtifactFallback(route, idx = 0) {
  const canvas = document.getElementById('artifactCanvas');
  if (!canvas || !route?.route?.length) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const pts = route.route;
  const minElev = Math.min(...pts.map(p => Number(p.elev) || 0));
  const maxElev = Math.max(...pts.map(p => Number(p.elev) || 0));
  const elevSpan = Math.max(maxElev - minElev, 1);
  const total = Math.max(pts[pts.length - 1].d || 1, 1);
  const padX = 28 * dpr, padTop = 34 * dpr, padBottom = 24 * dpr;
  const plotW = Math.max(1, w - padX * 2);
  const plotH = Math.max(1, h - padTop - padBottom);
  const toPoint = p => [
    padX + ((p.d || 0) / total) * plotW,
    padTop + (1 - ((Number(p.elev) || 0) - minElev) / elevSpan) * plotH,
  ];
  ctx.fillStyle = 'rgba(0,241,159,0.035)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(191,239,225,0.24)';
  ctx.lineWidth = 1 * dpr;
  for (let g = 0; g < 4; g++) {
    const y = padTop + (plotH / 3) * g;
    ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
  }
  const drawLine = (end, color, width, glow = false) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (glow) {
      ctx.shadowColor = 'rgba(0,241,159,0.65)';
      ctx.shadowBlur = 12 * dpr;
    }
    ctx.beginPath();
    pts.slice(0, Math.max(1, end + 1)).forEach((p, i) => {
      const [x, y] = toPoint(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };
  drawLine(pts.length - 1, 'rgba(191,239,225,0.34)', 2);
  drawLine(idx, '#00F19F', 2.5, true);
  const [mx, my] = toPoint(pts[Math.max(0, Math.min(idx, pts.length - 1))]);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,241,159,0.9)';
  ctx.shadowBlur = 10 * dpr;
  ctx.beginPath();
  ctx.arc(mx, my, 5 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

function initElevationArtifact(route) {
  if (typeof THREE === 'undefined') {
    drawArtifactFallback(route, 0);
    return;
  }
  const canvas = document.getElementById('artifactCanvas');
  if (!canvas) return;
  if (artifactRenderer) {
    disposeArtifactObject(artifactScene);
    artifactRenderer.dispose();
    artifactRenderer = null;
  }
  artifactSlug = route.slug;
  artifactPoints = routeArtifactPoints(route);
  artifactScene = new THREE.Scene();
  artifactScene.fog = new THREE.Fog(0x071014, 8, 16);
  artifactCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  artifactCamera.position.set(0, 3.1, 8.4);
  artifactCamera.lookAt(0, 0.15, 0);
  artifactRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  artifactRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const ambient = new THREE.AmbientLight(0x9fcfc1, 1.1);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 6, 6);
  artifactScene.add(ambient, key);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(9.5, 0.035, 2.5),
    new THREE.MeshBasicMaterial({ color: 0x23333a, transparent: true, opacity: 0.28 })
  );
  base.position.y = -0.95;
  artifactScene.add(base);

  artifactBlocks = [];
  const blockCount = Math.min(18, Math.max(8, Math.floor(artifactPoints.length / 8)));
  for (let b = 0; b < blockCount; b++) {
    const p = artifactPoints[Math.floor((b / Math.max(blockCount - 1, 1)) * (artifactPoints.length - 1))] || new THREE.Vector3();
    const h = Math.max(0.08, p.y + 1.08);
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, h, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x00f19f, emissive: 0x003a2a, roughness: 0.65, metalness: 0.1, transparent: true, opacity: 0.28 })
    );
    block.position.set(p.x, -0.95 + h / 2, p.z - 0.55);
    artifactBlocks.push(block);
    artifactScene.add(block);
  }

  artifactFullLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(artifactPoints),
    new THREE.LineBasicMaterial({ color: 0xc0efe1, transparent: true, opacity: 0.34 })
  );
  artifactScene.add(artifactFullLine);
  artifactProgressLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([artifactPoints[0] || new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x00f19f, transparent: true, opacity: 1 })
  );
  artifactScene.add(artifactProgressLine);
  artifactMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00f19f, emissiveIntensity: 0.75 })
  );
  artifactScene.add(artifactMarker);
  resizeElevationArtifact();
  updateElevationArtifact(route, 0);
}

function resizeElevationArtifact() {
  if (!artifactRenderer || !artifactCamera) return;
  const canvas = artifactRenderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  artifactRenderer.setSize(w, h, false);
  artifactCamera.aspect = w / h;
  artifactCamera.updateProjectionMatrix();
  artifactRenderer.render(artifactScene, artifactCamera);
}

function updateElevationArtifact(route, idx) {
  const p = route.route[idx];
  document.getElementById('artifactKm').textContent =
    `${(p.d / 1000).toFixed(1)} / ${route.distance_km.toFixed(1)} km`;
  document.getElementById('artifactElev').textContent = `${Math.round(p.elev).toLocaleString()} m`;
  document.getElementById('artifactClimb').textContent = `${Math.round(route.elevation_gain_m || 0).toLocaleString()} m`;
  if (!artifactRenderer || artifactSlug !== route.slug || !artifactPoints.length) {
    drawArtifactFallback(route, idx);
    return;
  }
  const safeIdx = Math.max(0, Math.min(idx, artifactPoints.length - 1));
  artifactProgressLine.geometry.dispose();
  artifactProgressLine.geometry = new THREE.BufferGeometry().setFromPoints(artifactPoints.slice(0, safeIdx + 1));
  artifactMarker.position.copy(artifactPoints[safeIdx]);
  artifactBlocks.forEach((block, b) => {
    const threshold = (b / Math.max(artifactBlocks.length - 1, 1)) * (artifactPoints.length - 1);
    block.material.opacity = threshold <= safeIdx ? 0.56 : 0.18;
    block.material.emissiveIntensity = threshold <= safeIdx ? 0.45 : 0.08;
  });
  artifactScene.rotation.y = -0.22 + (safeIdx / Math.max(artifactPoints.length - 1, 1)) * 0.44;
  artifactRenderer.render(artifactScene, artifactCamera);
}

function renderStrip() {
  const strip = document.getElementById('photoStripScroll');
  if (!strip) return;
  const wrap = strip.closest('.photo-strip');
  strip.innerHTML = '';
  if (allPhotos.length === 0) {
    if (wrap) wrap.classList.add('empty');
    strip.innerHTML = `<div class="empty-msg"><b>NO PHOTOS YET FOR THIS ROUTE</b>
      Drag JPG or HEIC files anywhere on this page<br>to tag them to spots on the route.</div>`;
    return;
  }
  if (wrap) wrap.classList.remove('empty');
  allPhotos.forEach((ph, idx) => {
    const card = document.createElement('div');
    card.className = 'photo-thumb' + (ph.source === 'user' ? ' user' : '');
    card.id = 'photoThumb' + idx;
    const thumbSrc = ph.thumb_url || ('data:image/jpeg;base64,' + ph.thumb);
    card.innerHTML = `<img src="${thumbSrc}" alt="" loading="lazy" decoding="async">
                     ${ph.dt ? '<div class="photo-thumb-tag">' + ph.dt + '</div>' : ''}
                     ${ph.source === 'user' ? '<div class="photo-thumb-remove" onclick="removeUserPhoto(event,' + idx + ')">×</div>' : ''}`;
    card.onclick = () => jumpToPhoto(idx);
    strip.appendChild(card);
  });
}

function snapToRoute(latLng) {
  const r = ROUTES[activeRouteIdx];
  const lat = latLng.lat; const lng = latLng.lng;
  let best = 0; let bestD = Infinity;
  for (let i = 0; i < r.route.length; i++) {
    const d = (r.route[i].lat - lat) ** 2 + (r.route[i].lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  setRouteIndex(best); document.getElementById('scrubber').value = best;
}

function setRouteIndex(i) {
  const r = ROUTES[activeRouteIdx]; const p = r.route[i];
  document.getElementById('scrubberPos').textContent =
    (p.d / 1000).toFixed(2) + ' / ' + (r.route[r.route.length-1].d / 1000).toFixed(2) + ' km';
  document.getElementById('kmDone').textContent = (p.d / 1000).toFixed(1) + ' km';
  document.getElementById('elevHere').textContent = Math.round(p.elev) + ' m';
  document.getElementById('poiTitle').textContent =
    i < 10 ? 'Route start' : (i > r.route.length - 10 ? 'Route end' : 'Along route');
  updateMainMapProgress(r, i);
  updateElevationArtifact(r, i);
  updateLockedRouteCamera(r, i);
}

function jumpToPhoto(idx) {
  const r = ROUTES[activeRouteIdx]; const ph = allPhotos[idx];
  let best = 0; let bestD = Infinity;
  for (let i = 0; i < r.route.length; i++) {
    const d = (r.route[i].lat - ph.lat) ** 2 + (r.route[i].lng - ph.lng) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  setRouteIndex(best); document.getElementById('scrubber').value = best;
  document.querySelectorAll('.photo-thumb').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('photoThumb' + idx);
  if (el) el.classList.add('active');
  setTimeout(() => openPhoto(idx), 200);
}

function openPhoto(idx) {
  const ph = allPhotos[idx];
  document.getElementById('photoFull').src =
    ph.full_url || ('data:image/jpeg;base64,' + ph.full);
  document.getElementById('photoCaption').textContent =
    'Lauren · ' + (ph.dt_full || ph.dt || 'no date') +
    ' · ' + ph.lat.toFixed(4) + '°, ' + ph.lng.toFixed(4) + '°';
  document.getElementById('photoModal').classList.add('open');
}
function closePhoto() { document.getElementById('photoModal').classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePhoto(); closeShareCard(); }
});

// Share card
function openShareCard() {
  if (activeRouteIdx === -1) return;
  const r = ROUTES[activeRouteIdx];
  const path = `cards/${r.slug}.png`;
  document.getElementById('shareImg').src = path;
  document.getElementById('shareDownload').href = path;
  document.getElementById('shareDownload').setAttribute('download', `quest-${r.slug}.png`);
  document.getElementById('shareModal').classList.add('open');
}
function closeShareCard() { document.getElementById('shareModal').classList.remove('open'); }

async function copyQuestLink() {
  if (activeRouteIdx === -1) return;
  const r = ROUTES[activeRouteIdx];
  const url = questUrl(r);
  const btn = document.getElementById('copyLinkBtn');
  const original = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(url);
    btn.innerHTML = '<svg class="icon"><use href="#i-external"/></svg> COPIED';
  } catch {
    window.prompt('Copy quest link', url);
    btn.innerHTML = '<svg class="icon"><use href="#i-external"/></svg> COPY LINK';
  }
  setTimeout(() => { btn.innerHTML = original; }, 1400);
}

// Storage
function storageKey(slug) { return STORAGE_KEY_PREFIX + slug; }
function getStoredPhotos(slug) {
  try { return JSON.parse(localStorage.getItem(storageKey(slug)) || '[]'); }
  catch { return []; }
}
function storePhotos(slug, list) {
  try { localStorage.setItem(storageKey(slug), JSON.stringify(list)); }
  catch (e) { alert('Could not save photo — local storage may be full. (' + e.message + ')'); }
}
function removeUserPhoto(event, idx) {
  event.stopPropagation();
  const ph = allPhotos[idx]; if (ph.source !== 'user') return;
  const r = ROUTES[activeRouteIdx];
  const user = getStoredPhotos(r.slug);
  const filtered = user.filter(p => !(p.thumb === ph.thumb));
  storePhotos(r.slug, filtered); initRoute();
}

// Drag-drop
let dragCounter = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault(); if (activeRouteIdx === -1) return;
  dragCounter++; document.getElementById('dropOverlay').classList.add('active');
});
window.addEventListener('dragleave', e => {
  e.preventDefault(); dragCounter--;
  if (dragCounter <= 0) document.getElementById('dropOverlay').classList.remove('active');
});
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', async e => {
  e.preventDefault(); dragCounter = 0;
  document.getElementById('dropOverlay').classList.remove('active');
  if (activeRouteIdx === -1) return;
  const files = Array.from(e.dataTransfer.files).filter(f =>
    /^image\\//.test(f.type) || /\\.heic$/i.test(f.name));
  for (const f of files) await addUserPhoto(f);
  initRoute();
});

async function addUserPhoto(file) {
  const r = ROUTES[activeRouteIdx];
  let lat = r.center_lat, lng = r.center_lng, dt = '', dt_full = '';
  try {
    const exif = await exifr.parse(file, { gps: true, exif: true });
    if (exif) {
      if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
        lat = exif.latitude; lng = exif.longitude;
      }
      const d = exif.DateTimeOriginal || exif.CreateDate;
      if (d instanceof Date) {
        dt = d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
        dt_full = d.toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
      }
    }
  } catch {}
  try {
    const imgEl = await loadImageFile(file);
    const thumb = canvasResize(imgEl, 240, 'image/jpeg', 0.80);
    const full  = canvasResize(imgEl, 900, 'image/jpeg', 0.80);
    const photo = { thumb: thumb.split(',')[1], full: full.split(',')[1],
                    lat, lng, dt, dt_full, source: 'user' };
    const stored = getStoredPhotos(r.slug); stored.push(photo);
    storePhotos(r.slug, stored);
  } catch (err) { alert('Could not process: ' + err.message); }
}
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed (HEIC may not render in this browser)'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}
function canvasResize(img, maxSize, mime, quality) {
  const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const w = Math.round(img.width * ratio); const h = Math.round(img.height * ratio);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL(mime, quality);
}

document.getElementById('scrubber').addEventListener('input', e => {
  setRouteIndex(parseInt(e.target.value));
});

window.addEventListener('resize', () => {
  resizeElevationArtifact();
  if (map) map.resize();
});
window.addEventListener('popstate', handleCurrentUrl);
window.addEventListener('hashchange', handleCurrentUrl);
initFilterControls();
if (location.hash) handleCurrentUrl();
else renderGallery();
</script>
</body></html>
'''

html_out = (template_html
            .replace('__ROUTES_JSON__', data_json))
(QUESTS / 'index.html').write_text(html_out)

print(f'\n✓ Built: {QUESTS}/index.html  ({len(routes_data)} quests)')
print(f'✓ Cards: {CARDS}/ ({len(routes_data)} PNGs)')
print(f'\nOpen: open {QUESTS}/index.html')
