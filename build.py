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
def env_value(name):
    env_path = QUESTS / '.env'
    if not env_path.exists():
        return ''
    for line in env_path.read_text().splitlines():
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip()
    return ''

GOOGLE_MAPS_API_KEY = env_value('GOOGLE_MAPS_API_KEY')
print('[1/5] Map provider: MapLibre GL JS + Google Street View route cam')

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

    lats = [p[0] for p in route]; lngs = [p[1] for p in route]
    cx = (min(lats) + max(lats)) / 2; cy = (min(lngs) + max(lngs)) / 2
    # Personal archive photos are intentionally not attached to quests. The
    # match radius was too broad and made the atlas feel untrustworthy.
    baseline_photos = []
    visual_source = {
        'kind': 'generated_route',
        'label': 'Generated route preview',
        'description': 'Stable route art shown without personal photo matching.',
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
curation_json = json.dumps({
    'approved': len(quest_specs),
    'pending': pending_n,
    'rejected': rejected_n,
    'total': len(all_routes),
})

# Build app HTML — same as previous version but with Share-card button
HTML_TEMPLATE_PATH = Path('/tmp/quests_template.html')
template_html = '''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B1014">
<meta name="description" content="Lauren&rsquo;s quest atlas — real runs and rides turned into repeatable adventure challenges.">
<title>godiesel quest atlas · Lauren Zary</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='10' fill='%2300F19F'/%3E%3C/svg%3E">
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
  -webkit-font-smoothing: antialiased; min-height: 100vh; overflow-x: hidden; }

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
.ops-rail { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr;
            gap: 12px; margin: 2px 0 4px; }
.ops-panel { border: 1px solid rgba(42,53,64,0.84); background: rgba(11,18,22,0.82);
             border-radius: 10px; padding: 13px 14px; min-width: 0; }
.ops-kicker { font-family: 'JetBrains Mono', monospace; color: var(--teal);
              font-size: 9px; letter-spacing: 1.6px; text-transform: uppercase; }
.ops-title { margin-top: 7px; color: #EEE; font-size: 13px; font-weight: 700; }
.ops-copy { margin-top: 5px; color: var(--text-dim); font-size: 12px; line-height: 1.55; max-width: 62ch; }
.ops-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.ops-step { border-left: 1px solid rgba(0,241,159,0.28); padding-left: 9px; min-width: 0; }
.ops-step { appearance: none; text-align: left; background: transparent; color: inherit; cursor: pointer; }
.ops-step:hover b { color: var(--teal); }
.ops-step b { display: block; color: #FFF; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1px; }
.ops-step span { display: block; margin-top: 4px; color: var(--text-dim); font-size: 11px; line-height: 1.35; }
.curation-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.curation-stat { border: 1px solid rgba(123,161,187,0.16); border-radius: 7px; padding: 8px 9px; }
.curation-stat b { display: block; color: #FFF; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.curation-stat span { display: block; margin-top: 4px; color: var(--text-faint); font-family: 'JetBrains Mono', monospace;
                      font-size: 8px; letter-spacing: 1.2px; text-transform: uppercase; }
.admin-link { display: inline-flex; margin-top: 11px; color: var(--teal); text-decoration: none;
              font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 1.3px; text-transform: uppercase; }
.curation-panel { display: none; }
body.ops-mode .ops-rail { grid-template-columns: minmax(280px, 1.15fr) minmax(280px, 0.85fr); }
body.ops-mode .curation-panel { display: block; }
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
.gallery-empty button { margin-left: 10px; appearance: none; border: 1px solid rgba(0,241,159,0.5);
                        background: rgba(0,241,159,0.08); color: var(--teal); border-radius: 6px;
                        padding: 7px 9px; font-family: 'JetBrains Mono', monospace;
                        font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer; }

.globe-lab { display: none; position: relative; min-height: calc(100dvh - 68px);
             background: radial-gradient(circle at 42% 48%, rgba(0,147,231,0.14), transparent 34%),
                         linear-gradient(180deg, #05090D 0%, #071014 58%, #050708 100%);
             overflow: hidden; border-top: 1px solid rgba(123,161,187,0.10); }
.globe-lab.active { display: block; }
.globe-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.globe-label-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.globe-label { position: absolute; transform: translate(-50%, -50%);
               display: flex; align-items: center; gap: 7px;
               font-family: 'JetBrains Mono', monospace; font-size: 9px;
               letter-spacing: 1.2px; text-transform: uppercase; color: #DCE8EF;
               background: rgba(8,12,16,0.70); border: 1px solid rgba(123,161,187,0.30);
               border-radius: 999px; padding: 6px 8px; backdrop-filter: blur(8px);
               white-space: nowrap; opacity: 0.78; transition: opacity 160ms ease, border-color 160ms ease, transform 160ms ease;
               pointer-events: auto; cursor: pointer; }
.globe-label:hover { opacity: 1; border-color: rgba(0,241,159,0.52); }
.globe-label::before { content: ''; width: 8px; height: 8px; border-radius: 50%;
                       background: var(--teal); box-shadow: 0 0 16px rgba(0,241,159,0.65); }
.globe-label.active { opacity: 1; border-color: rgba(0,241,159,0.72);
                      transform: translate(-50%, -50%) scale(1.05); color: #FFF; }
.globe-panel { position: absolute; z-index: 3; top: 28px; left: 28px; width: min(390px, calc(100% - 56px));
               background: rgba(7,11,15,0.80); border: 1px solid rgba(123,161,187,0.22);
               border-radius: 10px; padding: 18px; backdrop-filter: blur(14px);
               box-shadow: 0 22px 70px rgba(0,0,0,0.34); }
.globe-kicker { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--teal);
                letter-spacing: 1.8px; text-transform: uppercase; }
.globe-title { margin-top: 8px; font-size: 28px; font-weight: 800; letter-spacing: 0.04em;
               text-transform: uppercase; line-height: 1.05; }
.globe-copy { margin-top: 10px; color: var(--text-dim); font-size: 13px; line-height: 1.6; max-width: 34rem; }
.globe-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.globe-stat { border: 1px solid rgba(123,161,187,0.16); border-radius: 7px;
              background: rgba(12,20,24,0.55); padding: 10px; min-width: 0; }
.globe-stat b { display: block; color: #FFF; font-family: 'JetBrains Mono', monospace;
                font-size: 15px; letter-spacing: 0.6px; }
.globe-stat span { display: block; margin-top: 4px; color: var(--text-dim);
                   font-family: 'JetBrains Mono', monospace; font-size: 8px;
                   letter-spacing: 1.2px; text-transform: uppercase; }
.globe-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.globe-action { appearance: none; border: 1px solid rgba(123,161,187,0.30);
                background: rgba(20,26,31,0.82); color: #DCE8EF; border-radius: 7px;
                padding: 9px 11px; font-family: 'JetBrains Mono', monospace;
                font-size: 9px; letter-spacing: 1.3px; text-transform: uppercase; cursor: pointer; }
.globe-action.primary { border-color: rgba(0,241,159,0.58); color: var(--teal);
                       background: rgba(0,241,159,0.08); }
.globe-route-panel { position: absolute; z-index: 3; right: 28px; bottom: 28px;
                     width: min(380px, calc(100% - 56px)); max-height: min(470px, calc(100dvh - 160px));
                     display: flex; flex-direction: column;
                     background: rgba(7,11,15,0.82); border: 1px solid rgba(123,161,187,0.22);
                     border-radius: 10px; backdrop-filter: blur(14px); overflow: hidden;
                     box-shadow: 0 22px 70px rgba(0,0,0,0.34); }
.globe-route-head { width: 100%; appearance: none; border: 0; border-bottom: 1px solid rgba(123,161,187,0.15);
                    background: transparent; color: inherit; padding: 14px 15px; text-align: left;
                    cursor: pointer; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
.globe-route-head:hover { background: rgba(0,241,159,0.05); }
.globe-route-summary { display: block; min-width: 0; }
.globe-route-head b { display: block; color: #FFF; text-transform: uppercase; letter-spacing: 0.08em; }
.globe-route-meta { display: block; margin-top: 5px; color: var(--text-dim);
                    font-family: 'JetBrains Mono', monospace; font-size: 9px;
                    letter-spacing: 1.1px; text-transform: uppercase; }
.globe-route-caret { color: var(--teal); font-family: 'JetBrains Mono', monospace;
                     font-size: 14px; line-height: 1; transition: transform 160ms ease; }
.globe-route-panel.menu-open .globe-route-caret { transform: rotate(180deg); }
.globe-region-menu { display: none; border-bottom: 1px solid rgba(123,161,187,0.15);
                     background: rgba(5,9,12,0.64); padding: 7px; max-height: 190px; overflow: auto;
                     overscroll-behavior: contain; }
.globe-route-panel.menu-open .globe-region-menu { display: grid; gap: 4px; }
.globe-route-panel.menu-open .globe-route-list { display: none; }
.globe-region-option { width: 100%; appearance: none; border: 1px solid transparent; border-radius: 7px;
                       background: transparent; color: #DCE8EF; cursor: pointer; padding: 9px 10px;
                       display: grid; grid-template-columns: 1fr auto; gap: 8px; text-align: left; }
.globe-region-option:hover { border-color: rgba(0,241,159,0.32); background: rgba(0,241,159,0.06); }
.globe-region-option.active { border-color: rgba(0,241,159,0.50); background: rgba(0,241,159,0.09); }
.globe-region-option b { color: #FFF; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.globe-region-option span { color: var(--text-dim); font-family: 'JetBrains Mono', monospace;
                             font-size: 8px; letter-spacing: 1px; text-transform: uppercase; white-space: nowrap; }
.globe-route-list { padding: 8px; overflow: auto; overscroll-behavior: contain; }
.globe-route-item { width: 100%; text-align: left; appearance: none; border: 1px solid transparent;
                    border-radius: 8px; background: transparent; color: #DCE8EF; cursor: pointer;
                    padding: 10px; display: grid; gap: 5px; }
.globe-route-item:hover { border-color: rgba(0,241,159,0.34); background: rgba(0,241,159,0.06); }
.globe-route-item b { color: #FFF; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.globe-route-item span { color: var(--text-dim); font-family: 'JetBrains Mono', monospace;
                         font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }

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
.quest-chip.earth { background: rgba(232,212,154,0.13); color: #E8D49A;
                    border: 1px solid rgba(232,212,154,0.24); }
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
.detail.cinema-playing .detail-header { opacity: 0.38; transform: translateY(-4px);
  transition: opacity 260ms ease, transform 260ms ease; }
.detail.cinema-playing .detail-header:hover,
.detail.cinema-playing:focus-within .detail-header { opacity: 1; transform: translateY(0); }
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
.detail-earth-badge { display: inline-flex; align-items: center; margin-left: 8px;
                      padding: 2px 7px; border-radius: 999px;
                      border: 1px solid rgba(232,212,154,0.28);
                      background: rgba(232,212,154,0.10); color: #E8D49A;
                      font-size: 9px; letter-spacing: 1.2px; vertical-align: 1px; }
.detail-brief { display: grid; grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1.1fr);
                align-items: stretch; gap: 12px; min-width: 0; }
.detail-quote { color: #C7D0D5; font-style: italic; font-size: 13px;
                border-left: 2px solid var(--teal); padding-left: 12px;
                align-self: center; min-width: 0; overflow-wrap: anywhere; }
.detail-desc { width: 100%; color: #999; font-size: 13px; line-height: 1.6;
               font-style: italic; padding-left: 12px;
               border-left: 2px solid var(--sleep); max-width: 700px; }
.detail-quest-meta { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; }
.completion-panel { width: 100%; display: grid;
                    grid-template-columns: minmax(260px, 1.25fr) minmax(320px, 1fr);
                    gap: 8px; min-width: 0; }
.completion-item { background: rgba(9,15,18,0.62); border: 1px solid rgba(123,161,187,0.16);
                   border-radius: 7px; padding: 8px 10px; min-width: 0; }
.completion-item.objective { background: rgba(0,241,159,0.055); border-color: rgba(0,241,159,0.30); }
.completion-stack { display: grid; grid-template-columns: repeat(4, minmax(70px, 1fr)); gap: 0;
                    border: 1px solid rgba(123,161,187,0.16); border-radius: 7px;
                    overflow: hidden; background: rgba(9,15,18,0.46); }
.completion-stack .completion-item { border: 0; border-radius: 0;
                                     border-left: 1px solid rgba(123,161,187,0.14);
                                     background: transparent; }
.completion-stack .completion-item:first-child { border-left: 0; }
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
.panel-map { position: absolute; inset: 0; width: auto; height: auto; overflow: hidden; }
#map { width: 100%; height: 100%; transition: filter 420ms ease; }
.panel-map.atlas-active #map { filter: saturate(0.78) contrast(1.05) brightness(0.86); }
.panel-map.earth-active #map { opacity: 0; pointer-events: none; }
.map-fallback { position: absolute; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center;
                background: radial-gradient(circle at 50% 42%, rgba(0,241,159,0.11), transparent 34%),
                            linear-gradient(135deg, rgba(6,13,16,0.96), rgba(7,16,20,0.92));
                color: rgba(255,255,255,0.72); transition: opacity 220ms ease; }
.map-fallback.hidden { opacity: 0; pointer-events: none; }
.map-fallback-inner { width: min(560px, calc(100% - 64px)); text-align: center; }
.map-fallback-route svg { width: 100%; max-height: 280px; filter: drop-shadow(0 0 18px rgba(0,241,159,0.34)); }
.map-fallback-kicker { margin-top: 12px; font-family: 'JetBrains Mono', monospace; font-size: 9px;
                       color: var(--teal); letter-spacing: 1.6px; text-transform: uppercase; }
.map-fallback-copy { margin-top: 6px; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.cinema-layer { position: absolute; inset: 0; z-index: 2; opacity: 0; pointer-events: none;
                background: radial-gradient(circle at 50% 46%, rgba(0,241,159,0.12), transparent 38%),
                            linear-gradient(180deg, rgba(5,10,12,0.96), rgba(3,7,9,0.98));
                transition: opacity 220ms ease; }
.cinema-layer.active { opacity: 1; }
.cinema-layer.active + .map-fallback { opacity: 0; pointer-events: none; }
.cinema-layer.active[data-mode="artifact"] {
  background: radial-gradient(circle at 50% 50%, rgba(0,241,159,0.2), transparent 38%),
              linear-gradient(180deg, rgba(4,9,11,0.98), rgba(3,7,9,0.99)); }
.cinema-layer.active[data-mode="flyover"] {
  background: radial-gradient(circle at 50% 38%, rgba(246,222,168,0.10), transparent 34%),
              linear-gradient(180deg, rgba(5,9,10,0.10), rgba(5,8,8,0.34) 72%, rgba(4,7,7,0.52)); }
.cinema-layer.active[data-mode="quest"] {
  background: radial-gradient(circle at 52% 46%, rgba(255,211,106,0.16), transparent 28%),
              radial-gradient(circle at 42% 55%, rgba(0,241,159,0.18), transparent 38%),
              linear-gradient(180deg, rgba(5,12,10,0.98), rgba(3,7,9,0.99)); }
.cinema-layer canvas { width: 100%; height: 100%; display: block; }
.cinema-layer.active[data-mode="flyover"] canvas { opacity: 0.36; }
.cinema-label { position: absolute; left: 16px; bottom: 86px;
                font-family: 'JetBrains Mono', monospace; font-size: 9px;
                color: #F0DFAE; letter-spacing: 1.6px; text-transform: uppercase;
                background: rgba(9,10,9,0.54); border: 1px solid rgba(240,223,174,0.24);
                border-radius: 7px; padding: 8px 10px; backdrop-filter: blur(10px); }
.earth-layer { position: absolute; inset: 0; z-index: 2; display: none;
               background: radial-gradient(circle at 54% 28%, rgba(240,223,174,0.12), transparent 30%),
                           linear-gradient(180deg, rgba(4,9,12,0.98), rgba(1,4,6,1)); }
.earth-layer.active { display: block; }
.earth-canvas { position: absolute; inset: 0; }
.earth-layer.loading .earth-canvas,
.earth-layer.unavailable .earth-canvas { opacity: 0.2; }
.earth-fallback { position: absolute; inset: 0; z-index: 2; display: none;
                  align-items: center; justify-content: center;
                  background: radial-gradient(circle at 50% 42%, rgba(240,223,174,0.12), transparent 34%),
                              linear-gradient(180deg, rgba(4,8,10,0.82), rgba(4,8,10,0.94));
                  text-align: center; padding: 28px; box-sizing: border-box; }
.earth-layer.loading .earth-fallback,
.earth-layer.unavailable .earth-fallback { display: flex; }
.earth-fallback-card { width: min(520px, 100%); border: 1px solid rgba(240,223,174,0.30);
                       border-radius: 10px; padding: 22px;
                       background: rgba(8,13,15,0.76); backdrop-filter: blur(14px);
                       box-shadow: 0 24px 70px rgba(0,0,0,0.34); }
.earth-fallback-kicker { font-family: 'JetBrains Mono', monospace; font-size: 9px;
                         color: var(--teal); letter-spacing: 1.7px; text-transform: uppercase; }
.earth-fallback-card b { display: block; margin-top: 9px; color: #FFF; font-size: 17px;
                         letter-spacing: 0.08em; text-transform: uppercase; }
.earth-fallback-card span { display: block; margin-top: 10px; color: rgba(255,255,255,0.66);
                            font-size: 12px; line-height: 1.55; }
.earth-exit { margin-top: 16px; background: rgba(240,223,174,0.10);
              border: 1px solid rgba(240,223,174,0.46); color: #F0DFAE;
              border-radius: 7px; padding: 9px 12px;
              font-family: 'JetBrains Mono', monospace; font-size: 9px;
              letter-spacing: 1.3px; text-transform: uppercase; cursor: pointer; }
.earth-hud { position: absolute; left: 16px; bottom: 86px; z-index: 3;
             display: none; gap: 12px; align-items: end;
             background: rgba(8,10,10,0.62); border: 1px solid rgba(240,223,174,0.26);
             border-radius: 8px; padding: 10px 12px; backdrop-filter: blur(12px);
             font-family: 'JetBrains Mono', monospace; text-transform: uppercase; }
.earth-layer.ready .earth-hud { display: flex; }
.earth-hud b { display: block; color: #F0DFAE; font-size: 9px; letter-spacing: 1.5px; }
.earth-hud span { display: block; margin-top: 5px; color: rgba(255,255,255,0.66);
                  font-size: 8px; letter-spacing: 1.1px; }
.earth-settling { position: absolute; right: 18px; bottom: 86px; z-index: 3;
                  display: none; max-width: 260px; padding: 10px 12px;
                  border: 1px solid rgba(240,223,174,0.30); border-radius: 8px;
                  background: rgba(8,10,10,0.66); backdrop-filter: blur(12px);
                  font-family: 'JetBrains Mono', monospace; color: #F0DFAE;
                  font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; }
.earth-layer.settling .earth-settling,
.earth-layer.partial .earth-settling { display: block; }
.earth-layer.partial .earth-settling { color: #FFF; border-color: rgba(255,255,255,0.30); }
.route-cam { position: absolute; right: 18px; bottom: 86px; width: min(360px, 34vw);
             aspect-ratio: 16 / 9; z-index: 4; overflow: hidden;
             border: 1px solid rgba(240,223,174,0.28); border-radius: 8px;
             background: #111716; box-shadow: 0 24px 60px rgba(0,0,0,0.38);
             opacity: 0; transform: translateY(10px) scale(0.98);
             pointer-events: none; transition: opacity 260ms ease, transform 260ms ease; }
.panel-map.atlas-active .route-cam { opacity: 1; transform: translateY(0) scale(1); }
.route-cam-map { position: absolute; inset: 0; }
.route-cam-empty { position: absolute; inset: 0; display: none; place-items: center; z-index: 1;
                   background: radial-gradient(circle at 50% 44%, rgba(240,223,174,0.10), transparent 36%),
                               linear-gradient(180deg, rgba(8,13,14,0.96), rgba(4,8,9,0.98));
                   text-align: center; padding: 22px; box-sizing: border-box; }
.route-cam-empty-inner b { display: block; color: #F0DFAE; font-size: 11px;
                           font-family: 'JetBrains Mono', monospace; letter-spacing: 1.5px;
                           text-transform: uppercase; }
.route-cam-empty-inner span { display: block; margin-top: 8px; color: rgba(255,255,255,0.62);
                              font-size: 11px; line-height: 1.45; }
.route-cam.no-imagery .route-cam-empty,
.route-cam.loading .route-cam-empty { display: grid; }
.route-cam.no-imagery .route-cam-map,
.route-cam.loading .route-cam-map { opacity: 0.24; }
.route-cam::before { content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: linear-gradient(180deg, rgba(5,8,8,0.06), rgba(5,8,8,0.34)),
              radial-gradient(circle at 50% 80%, transparent 45%, rgba(0,0,0,0.28)); }
.route-cam-hud { position: absolute; left: 10px; right: 10px; bottom: 9px; z-index: 3;
                 display: flex; justify-content: space-between; align-items: end; gap: 10px;
                 font-family: 'JetBrains Mono', monospace; text-transform: uppercase;
                 letter-spacing: 1.3px; pointer-events: none; }
.route-cam-label { color: #F0DFAE; font-size: 9px; font-weight: 700; }
.route-cam-status { color: rgba(255,255,255,0.68); font-size: 8px; text-align: right; line-height: 1.35; }
.route-cam-reticle { position: absolute; left: 50%; top: 50%; z-index: 3;
                     width: 24px; height: 24px; transform: translate(-50%, -50%);
                     border: 1px solid rgba(240,223,174,0.48); border-radius: 50%;
                     box-shadow: 0 0 0 8px rgba(240,223,174,0.035); pointer-events: none; }
.route-cam-reticle::before,
.route-cam-reticle::after { content: ''; position: absolute; background: rgba(240,223,174,0.42); }
.route-cam-reticle::before { left: 50%; top: -8px; bottom: -8px; width: 1px; transform: translateX(-50%); }
.route-cam-reticle::after { top: 50%; left: -8px; right: -8px; height: 1px; transform: translateY(-50%); }
.cinema-moment-layer { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.cinema-moment { position: absolute; opacity: 0; transform: translate(-50%, -110%) scale(0.94);
                 transition: opacity 220ms ease, transform 220ms ease;
                 background: rgba(11,12,10,0.68); border: 1px solid rgba(240,223,174,0.28);
                 border-radius: 8px; padding: 8px 10px; min-width: 112px;
                 box-shadow: 0 12px 34px rgba(0,0,0,0.26), 0 0 22px rgba(232,212,154,0.08);
                 backdrop-filter: blur(12px); }
.cinema-moment.active { opacity: 1; transform: translate(-50%, -126%) scale(1); }
.cinema-moment b { display: block; color: #FFF; font-size: 11px; line-height: 1.2; }
.cinema-moment span { display: block; margin-top: 4px; font-family: 'JetBrains Mono', monospace;
                      color: #F0DFAE; font-size: 8px; letter-spacing: 1.2px; text-transform: uppercase; }
.cinema-memory { position: absolute; opacity: 0; width: 148px;
                 transform: translate(-50%, -112%) scale(0.92) rotate(-1deg);
                 transition: opacity 240ms ease, transform 240ms ease;
                 background: rgba(246,238,218,0.16); border: 1px solid rgba(232,212,154,0.34);
                 border-radius: 10px; padding: 7px;
                 box-shadow: 0 18px 42px rgba(0,0,0,0.32), 0 0 24px rgba(232,212,154,0.08);
                 backdrop-filter: blur(14px); }
.cinema-memory.active { opacity: 1; transform: translate(-50%, -122%) scale(1) rotate(-1deg); }
.cinema-memory img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover;
                     display: block; border-radius: 7px; filter: saturate(0.92) contrast(1.04); }
.cinema-memory span { display: block; margin-top: 5px; font-family: 'JetBrains Mono', monospace;
                      color: #E8D49A; font-size: 8px; letter-spacing: 1.1px; text-transform: uppercase; }
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
                 color: rgba(255,255,255,0.56); font-family: 'JetBrains Mono', monospace;
                 font-size: 9px; letter-spacing: 1px; line-height: 1.45; text-transform: uppercase; }
.info-card { position: absolute; top: 16px; left: 16px;
             background: rgba(10,12,14,0.88); border: 1px solid var(--border);
             border-radius: 8px; padding: 10px 12px;
             backdrop-filter: blur(8px); max-width: 320px; z-index: 3; }
.panel-map.atlas-active .info-card { background: rgba(10,11,10,0.70); border-color: rgba(240,223,174,0.20); }
.panel-map.earth-active .info-card { background: rgba(8,10,10,0.66); border-color: rgba(240,223,174,0.26); }
.detail.cinema-playing .info-card { opacity: 0.62; transition: opacity 260ms ease; }
.panel-map.atlas-active .artifact-panel,
.panel-map.earth-active .artifact-panel,
.detail.cinema-playing .artifact-panel { opacity: 0; transform: translateY(4px);
  pointer-events: none;
  transition: opacity 260ms ease, transform 260ms ease; }
.detail.cinema-playing .info-card:hover,
.detail.cinema-playing .artifact-panel:hover { opacity: 0.74; transform: translateY(0); }
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
.route-control { flex: 0 0 auto; min-width: 74px; background: rgba(20,26,31,0.92);
              border: 1px solid rgba(123,161,187,0.28); color: var(--text-dim);
              border-radius: 6px; padding: 7px 9px;
              font-family: 'JetBrains Mono', monospace; font-size: 9px;
              letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer;
              transition: border-color 180ms ease, color 180ms ease, background 180ms ease; }
.route-control:hover { border-color: rgba(0,241,159,0.55); color: var(--teal); }
.route-control.active { color: var(--teal); border-color: rgba(0,241,159,0.7);
                     background: rgba(0,241,159,0.08); box-shadow: 0 0 18px rgba(0,241,159,0.12); }
.route-play.playing { color: #FFF; border-color: rgba(0,241,159,0.85); background: rgba(0,241,159,0.12); }
.route-cinema.active { color: #FFF; border-color: rgba(232,212,154,0.78); background: rgba(232,212,154,0.10); }
.route-earth.active { color: #FFF; border-color: rgba(0,241,159,0.78); background: rgba(0,241,159,0.10); }
.route-avatar.active { color: #FFF; border-color: rgba(232,212,154,0.78); background: rgba(232,212,154,0.10); }
.route-mode { display: none; }
.route-mode.visible { display: inline-flex; }
.avatar-picker { position: absolute; right: 16px; bottom: 76px; z-index: 6;
                 display: none; grid-template-columns: repeat(5, 38px); gap: 8px;
                 padding: 9px; border: 1px solid rgba(123,161,187,0.30);
                 border-radius: 8px; background: rgba(10,12,14,0.90);
                 backdrop-filter: blur(10px); box-shadow: 0 18px 46px rgba(0,0,0,0.30); }
.avatar-picker.visible { display: grid; }
.avatar-option { width: 38px; height: 38px; border-radius: 8px;
                 border: 1px solid rgba(123,161,187,0.26);
                 background: rgba(20,26,31,0.86); cursor: pointer;
                 display: grid; place-items: center; padding: 0; }
.avatar-option:hover, .avatar-option.active { border-color: rgba(0,241,159,0.72);
                 box-shadow: 0 0 18px rgba(0,241,159,0.16); }
.avatar-option img { width: 30px; height: 30px; display: block; }
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
  .back-btn { width: 38px; height: 34px; padding: 0; justify-content: center;
              font-size: 0; overflow: hidden; flex: 0 0 38px; }
  .back-btn::before { content: '←'; font-size: 13px; }

  /* Gallery */
  .gallery { padding: 18px 14px 32px; gap: 12px;
             grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .globe-lab { min-height: calc(100dvh - 61px); }
  .globe-panel { top: 12px; left: 12px; width: calc(100% - 24px); padding: 14px; }
  .globe-title { font-size: 22px; }
  .globe-copy { display: none; }
  .globe-route-panel { left: 12px; right: 12px; bottom: 12px; width: auto;
                       max-height: 38dvh; }
  .globe-label { font-size: 8px; padding: 5px 7px; }
  .gallery-intro { margin-bottom: 4px; }
  .atlas-kicker { font-size: 9px; }
  .gallery-intro h2 { font-size: 26px; line-height: 1.15; }
  .gallery-intro p { font-size: 13px; line-height: 1.6; }
  .gallery-count { font-size: 10px; }
  .atlas-stats { gap: 8px; }
  .atlas-stat { flex: 1 1 30%; min-width: 96px; padding: 9px 10px; }
  .atlas-stat b { font-size: 16px; }
  .ops-rail, body.ops-mode .ops-rail { grid-template-columns: 1fr; gap: 10px; }
  .ops-panel { padding: 12px; }
  .ops-steps { grid-template-columns: 1fr; gap: 9px; }
  .curation-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
  .detail-header { padding: 10px 14px; gap: 8px; }
  .detail-topline { grid-template-columns: 1fr; gap: 10px; }
  .detail-brief { grid-template-columns: 1fr; gap: 8px; }
  .detail-name { font-size: 16px; letter-spacing: 0.06em;
                 white-space: normal; word-break: keep-all; }
  .detail-meta { font-size: 10px; white-space: normal;
                 overflow: visible; text-overflow: clip; max-width: 100%;
                 line-height: 1.55; }
  .detail-quote { display: none; }
  .detail-desc { font-size: 12px; padding-left: 10px; max-width: 100%; }
  .completion-panel { display: none; }
  .completion-stack { grid-template-columns: 1fr 1fr; }
  .completion-stack .completion-item { border-left: 0; border-top: 1px solid rgba(123,161,187,0.14); }
  .completion-stack .completion-item:nth-child(-n+2) { border-top: 0; }
  .completion-stack .completion-item:nth-child(even) { border-left: 1px solid rgba(123,161,187,0.14); }
  .completion-value { font-size: 11px; }
  .detail-actions { width: 100%; }
  .detail-actions { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; }
  .detail-actions .share-btn { flex: 0 0 46px; width: 46px; height: 36px;
                               justify-content: center; padding: 0; font-size: 0; gap: 0; }
  .detail-actions .share-btn .icon { width: 13px; height: 13px; }

  .stage { min-height: 72dvh; height: 72dvh; }
  .panel-map { border-right: none; border-bottom: 1px solid var(--border); }
  .map-fallback { align-items: center; box-sizing: border-box;
                  padding: 82px 12px 188px; }
  .map-fallback-inner { width: 100%; }
  .map-fallback-route svg { max-height: 34dvh; }
  .map-fallback-copy { display: none; }

  /* Map overlays scale down */
  .info-card { max-width: calc(100% - 24px); padding: 10px 12px;
               top: 10px; left: 12px; right: 12px; }
  .info-title { font-size: 12px; }
  .info-stats { font-size: 9px; }
  .artifact-panel { top: auto; left: 10px; right: 10px; bottom: 92px;
                    width: auto; min-width: 0; }
  .artifact-canvas { height: 82px; }
  .artifact-copy { display: none; }
  .artifact-footer { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .artifact-stat { padding: 8px 9px; }
  .artifact-stat b { font-size: 10px; }

  .scrubber-wrap { bottom: 10px; left: 10px; right: 10px;
                   padding: 8px 10px; gap: 8px; flex-wrap: wrap; }
  .scrubber-pos { min-width: 0; flex: 1 1 calc(100% - 84px); font-size: 10px; }
  .scrubber-wrap input[type=range] { flex: 1 1 100%; order: 4; }
  .route-control { min-width: 0; padding: 7px 8px; font-size: 8px; }
  .route-play { order: 1; flex: 0 0 62px; }
  .scrubber-pos { order: 2; }
  .route-speed { order: 3; flex: 0 0 44px; }
  .route-avatar { order: 5; flex: 1 1 calc(33.333% - 6px); }
  .route-earth { order: 6; flex: 1 1 calc(33.333% - 6px); }
  .route-cinema { order: 6; flex: 1 1 calc(33.333% - 6px); }
  .route-mode { order: 6; flex: 1 1 calc(33.333% - 6px); }
  .route-lock { order: 7; flex: 1 1 100%; }
  .avatar-picker { right: 10px; bottom: 118px; grid-template-columns: repeat(5, 34px); }
  .avatar-option { width: 34px; height: 34px; }
  .avatar-option img { width: 27px; height: 27px; }
  .cinema-label { left: 10px; bottom: 124px; font-size: 8px; }
  .earth-settling { left: 10px; right: 10px; bottom: 214px; max-width: none; }
  .route-cam { right: 10px; bottom: 214px; width: min(260px, calc(100% - 20px)); }
  .route-cam-hud { left: 8px; right: 8px; bottom: 8px; }

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

<div class="globe-lab" id="globeLab">
  <canvas class="globe-canvas" id="globeCanvas" aria-label="Quest globe"></canvas>
  <div class="globe-label-layer" id="globeLabelLayer"></div>
  <section class="globe-panel">
    <div class="globe-kicker">Quest globe lab</div>
    <div class="globe-title">Real places, playable days.</div>
    <div class="globe-copy">Explore Lauren&rsquo;s routes as regional hotspots. Pick a place, then open the route in the existing replay experience.</div>
    <div class="globe-stats" id="globeStats"></div>
    <div class="globe-actions">
      <button class="globe-action primary" type="button" onclick="selectBestGlobeRegion()">Best in Earth</button>
      <button class="globe-action" type="button" onclick="showGallery()">All quests</button>
    </div>
  </section>
  <aside class="globe-route-panel" id="globeRoutePanel">
    <button class="globe-route-head" type="button" onclick="toggleGlobeRegionMenu()" aria-expanded="false" aria-controls="globeRegionMenu">
      <span class="globe-route-summary">
        <b id="globeRegionName">Route regions</b>
        <span class="globe-route-meta" id="globeRegionMeta">Pick a hotspot</span>
      </span>
      <span class="globe-route-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="globe-region-menu" id="globeRegionMenu"></div>
    <div class="globe-route-list" id="globeRouteList"></div>
  </aside>
</div>

<div class="gallery" id="gallery">
  <div class="gallery-intro">
    <div class="atlas-kicker">Prototype quest atlas</div>
    <h2>Pick a quest. Go diesel.</h2>
    <p>Lauren&rsquo;s real runs and rides have been turned into repeatable adventure
       challenges. Each quest has a route, a rule, a reward, and a playable
       map preview built from the route itself.</p>
    <div class="gallery-count" id="galleryCount"></div>
    <div class="atlas-stats" id="atlasStats"></div>
  </div>
  <div class="ops-rail">
    <div class="ops-panel curation-panel">
      <div class="ops-kicker">First run protocol</div>
      <div class="ops-title">Pick a quest by intent, then preview the route before committing.</div>
      <div class="ops-copy">Use these quick starts to set the existing filters. The atlas stays low-friction: choose the vibe, inspect the terrain, share the card.</div>
      <div class="ops-steps">
        <button class="ops-step" type="button" onclick="applyQuestPreset('easy')"><b>Start easy</b><span>Shorter quests with gentler effort.</span></button>
        <button class="ops-step" type="button" onclick="applyQuestPreset('ride')"><b>Find a ride</b><span>Switch straight to bike routes.</span></button>
        <button class="ops-step" type="button" onclick="applyQuestPreset('xp')"><b>Big XP</b><span>Surface the larger objective set.</span></button>
      </div>
    </div>
    <div class="ops-panel">
      <div class="ops-kicker">Curation cockpit</div>
      <div class="ops-title">Route backlog ready for triage.</div>
      <div class="curation-grid" id="curationGrid"></div>
      <a class="admin-link" href="http://localhost:8766/">Open local admin queue →</a>
    </div>
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
      <div class="cinema-layer" id="cinemaLayer" aria-label="3D route cinema">
        <canvas id="cinemaCanvas"></canvas>
        <div class="cinema-moment-layer" id="cinemaMomentLayer" aria-hidden="true"></div>
        <div class="cinema-label" id="cinemaLabel">Route cinema · real path + elevation</div>
      </div>
      <div class="earth-layer" id="earthLayer" aria-label="Earth replay lab">
        <div class="earth-canvas" id="earthCanvas"></div>
        <div class="earth-fallback" id="earthFallback">
          <div class="earth-fallback-card">
            <div class="earth-fallback-kicker" id="earthFallbackKicker">Earth replay lab</div>
            <b id="earthFallbackTitle">Earth mode unavailable</b>
            <span id="earthFallbackCopy">The photorealistic 3D route world could not load in this browser session.</span>
            <button class="earth-exit" type="button" onclick="exitEarthMode()">Open standard atlas</button>
          </div>
        </div>
        <div class="earth-hud">
          <div><b>Earth replay</b><span id="earthStatus">Photorealistic 3D tiles</span></div>
        </div>
        <div class="earth-settling" id="earthSettling">Resolving 3D terrain</div>
      </div>
      <div class="route-cam" id="routeCam" aria-label="Route dashcam">
        <div class="route-cam-map" id="routeCamMap"></div>
        <div class="route-cam-empty" id="routeCamEmpty">
          <div class="route-cam-empty-inner">
            <b id="routeCamEmptyTitle">Finding ground imagery</b>
            <span id="routeCamEmptyCopy">Checking Street View near this point on the route.</span>
          </div>
        </div>
        <div class="route-cam-reticle" aria-hidden="true"></div>
        <div class="route-cam-hud">
          <div class="route-cam-label" id="routeCamLabel">Street View</div>
          <div class="route-cam-status" id="routeCamStatus">Ground imagery</div>
        </div>
      </div>
      <div class="map-fallback" id="mapFallback">
        <div class="map-fallback-inner">
          <div class="map-fallback-route" id="mapFallbackRoute"></div>
          <div class="map-fallback-kicker">Route visual standby</div>
          <div class="map-fallback-copy">MapLibre terrain is loading. The quest route remains playable from the local route trace.</div>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title" id="poiTitle">Loading…</div>
        <div class="info-stats">
          <b id="kmDone">0.0 km</b> / <span id="kmTotal">— km</span> along route
          &nbsp;·&nbsp; <b id="elevHere">0 m</b> elev
        </div>
      </div>
      <div class="artifact-panel" aria-label="Route elevation artifact">
        <canvas class="artifact-canvas" id="artifactCanvas"></canvas>
        <div class="artifact-label">Elevation trace</div>
        <div class="artifact-copy" id="artifactContext">Route profile</div>
        <div class="artifact-footer">
          <div class="artifact-stat"><b id="artifactKm">0.0 / 0.0 km</b><span>along route</span></div>
          <div class="artifact-stat"><b id="artifactElev">0 m</b><span>current elev</span></div>
          <div class="artifact-stat"><b id="artifactClimb">0 m</b><span>total climb</span></div>
        </div>
      </div>
      <div class="scrubber-wrap">
        <button class="route-control route-play" id="routePlayBtn" type="button" onclick="toggleRoutePlayback()" title="Play the route preview">PLAY</button>
        <div class="scrubber-pos" id="scrubberPos">0.00 / 0.00 km</div>
        <input type="range" id="scrubber" min="0" max="100" value="0">
        <button class="route-control route-speed" id="routeSpeedBtn" type="button" onclick="cycleRouteSpeed()" title="Change playback speed">4X</button>
        <button class="route-control route-avatar" id="routeAvatarBtn" type="button" onclick="toggleAvatarPicker()" title="Choose route avatar">AVATAR</button>
        <button class="route-control route-earth" id="routeEarthBtn" type="button" onclick="toggleEarthReplay()" title="Switch between Atlas and Earth Replay">EARTH</button>
        <button class="route-control route-cinema" id="routeCinemaBtn" type="button" onclick="toggleRouteCinema()" title="Enter the route memory atlas">ENTER ROUTE</button>
        <button class="route-control route-mode" id="routeModeBtn" type="button" onclick="cycleRouteCinemaMode()" title="Cycle route world prototype">ARTIFACT</button>
        <button class="route-control route-lock active" id="routeLockBtn" type="button" onclick="toggleRouteLock()" title="Keep the camera following the active point">FOLLOWING</button>
      </div>
      <div class="avatar-picker" id="avatarPicker" aria-label="Route avatar picker"></div>
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
const CURATION = __CURATION_JSON__;
const GOOGLE_MAPS_API_KEY = '__GOOGLE_MAPS_API_KEY__';
let activeRouteIdx = -1;
let map, mapSlug = null;
let routeCamPanorama = null, routeCamService = null, routeCamSlug = null, routeCamReady = false;
let routeCamBearing = null;
let routeCamLookupToken = 0;
const routeCamCache = new Map();
const routeCamRequested = new Map();
let routeViewLocked = true;
let routeLockCameraReady = false;
let routePlaying = false;
let routePlayTimer = null;
let routePlaybackCursor = 0;
let routePlaybackLastAt = 0;
let routeCameraBearing = null;
let routePlaySpeed = 4;
const ROUTE_SPEEDS = [1, 4, 12];
const queryParams = new URLSearchParams(location.search);
const SHOW_DEV_CINEMA_MODES = queryParams.get('devModes') === '1';
const GLOBE_LAB_MODE = queryParams.get('lab') === 'globe';
let artifactRenderer = null, artifactScene = null, artifactCamera = null;
let artifactFullLine = null, artifactProgressLine = null, artifactMarker = null, artifactBlocks = [];
let artifactPoints = [], artifactSlug = null;
let routeCinemaEnabled = false;
const ROUTE_CINEMA_MODES = SHOW_DEV_CINEMA_MODES ? ['artifact', 'flyover', 'quest'] : ['flyover'];
let routeCinemaMode = 'flyover';
let earthModeEnabled = false;
let earthViewer = null, earthTileset = null, earthFullEntity = null, earthProgressEntity = null, earthMarkerEntity = null;
let earthReady = false, earthState = 'inactive', earthSlug = null, earthCameraBearing = null, earthLoadToken = 0;
let earthCesiumPromise = null;
let earthTileFailures = 0, earthTilesLoading = 0;
let earthBlankWarnings = 0, earthBlankCheckTimer = null, earthScrubUntil = 0;
const EARTH_PARTIAL_TILE_FAILURE_THRESHOLD = 16;
let cinemaRenderer = null, cinemaScene = null, cinemaCamera = null;
let cinemaFullLine = null, cinemaProgressLine = null, cinemaMarker = null, cinemaSurface = null;
let cinemaPoints = [], cinemaSlug = null, cinemaDecor = [], cinemaMoments = [], cinemaMemories = [];
let cinemaFrame = null, cinemaStartedAt = 0;
let cinemaCameraTarget = null, cinemaLookTarget = null, cinemaLookCurrent = null;
let globeRenderer = null, globeScene = null, globeCamera = null, globeRoot = null, globeRaycaster = null;
let globeHotspots = [], globeLabels = [], globeRegions = [], selectedGlobeRegion = null;
let globeAnimationFrame = null, globePointer = null, globeTargetRotation = null;
let globeCameraDistance = 7.2;
let globeDrag = { active: false, moved: false, x: 0, y: 0, rotX: 0, rotY: 0 };
let globeRegionMenuOpen = false;
let allPhotos = [];
const STORAGE_KEY_PREFIX = 'quests:photos:';
const REPLAY_MODE_STORAGE_KEY = 'quests:replay-mode';
const AVATAR_STORAGE_KEY = 'quests:route-avatar';
const ROUTE_AVATARS = [
  {
    id: 'spark',
    label: 'Spark',
    bg: '#00f19f',
    fg: '#07100d',
  },
  {
    id: 'runner',
    label: 'Runner',
    bg: '#83cfff',
    fg: '#061019',
  },
  {
    id: 'bolt',
    label: 'Bolt',
    bg: '#e8d49a',
    fg: '#151008',
  },
  {
    id: 'flag',
    label: 'Flag',
    bg: '#ff8f70',
    fg: '#170805',
  },
  {
    id: 'peak',
    label: 'Peak',
    bg: '#c7f2d3',
    fg: '#07110b',
  },
];
let currentAvatarId = getAvatarPreference();
const BEST_IN_EARTH_ROUTES = new Set([
  '17654151284', '17636880071', '17616195995', '17606492777', '17597564971',
  '16366737881', '15573295095', '15562324390', '15182597704', '13835672113',
  '13807396994', '14736711660', '14486170630', '14422331296', '14415835303',
  '14394581660', '14349820520', '14262327221', '14160295943', '14130782031',
  '14130772463', '14130768855', '14080158961', '14064880083', '14030669837',
  '14023448720', '13134774070', '13971753429', '13941094274', '13935098460',
  '13534813116', '13358070690', '10082410891', '10075093128', '9959792315',
  '9953403673', '9945324433', '9934715694', '9845102380', '8790922344',
  '8788969453', '8788967538', '8767788731', '8762819138', '6496900063',
  '6477420224', '5981399261', '5944474545', '5868096334', '5837509151',
  '5786313644', '5650407638', '5460495850', '5420668682'
]);

const galleryFilters = {
  type: 'All',
  difficulty: 'All',
  region: 'All',
  theme: 'All',
};

if (queryParams.get('ops') === '1') {
  document.body.classList.add('ops-mode');
}
const requestedCinemaModeRaw = queryParams.get('lab');
const requestedReplayMode = requestedCinemaModeRaw === 'earth' || requestedCinemaModeRaw === 'atlas'
  ? requestedCinemaModeRaw
  : null;
const requestedCinemaMode = requestedCinemaModeRaw === 'memory' || requestedCinemaModeRaw === 'atlas'
  ? 'flyover'
  : requestedCinemaModeRaw;
const replayModePreference = requestedReplayMode || getReplayModePreference() || defaultReplayMode();
if (replayModePreference === 'earth') {
  earthModeEnabled = true;
  routeCinemaEnabled = false;
}
if (!earthModeEnabled && ROUTE_CINEMA_MODES.includes(requestedCinemaMode)) {
  routeCinemaMode = requestedCinemaMode;
  routeCinemaEnabled = true;
}

function defaultReplayMode() {
  return window.matchMedia?.('(max-width: 700px)').matches ? 'atlas' : 'earth';
}

function getReplayModePreference() {
  try {
    const value = localStorage.getItem(REPLAY_MODE_STORAGE_KEY);
    return value === 'earth' || value === 'atlas' ? value : null;
  } catch {
    return null;
  }
}

function setReplayModePreference(mode) {
  if (mode !== 'earth' && mode !== 'atlas') return;
  try {
    localStorage.setItem(REPLAY_MODE_STORAGE_KEY, mode);
  } catch {}
}

function avatarById(id) {
  return ROUTE_AVATARS.find(avatar => avatar.id === id) || ROUTE_AVATARS[0];
}

function getAvatarPreference() {
  try {
    const value = localStorage.getItem(AVATAR_STORAGE_KEY);
    return ROUTE_AVATARS.some(avatar => avatar.id === value) ? value : ROUTE_AVATARS[0].id;
  } catch {
    return ROUTE_AVATARS[0].id;
  }
}

function setAvatarPreference(id) {
  currentAvatarId = avatarById(id).id;
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, currentAvatarId);
  } catch {}
}

function avatarImageDataUri(id = currentAvatarId) {
  const avatar = avatarById(id);
  const canvas = document.createElement('canvas');
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.48)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = avatar.bg;
  ctx.beginPath();
  ctx.arc(48, 48, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(48, 48, 25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(48, 48, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = avatar.fg;
  ctx.strokeStyle = avatar.fg;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (avatar.id === 'spark') {
    const spikes = 5;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i += 1) {
      const radius = i % 2 === 0 ? 26 : 11;
      const angle = -Math.PI / 2 + i * Math.PI / spikes;
      const x = 48 + Math.cos(angle) * radius;
      const y = 48 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (avatar.id === 'runner') {
    ctx.beginPath();
    ctx.arc(48, 27, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(46, 38); ctx.lineTo(35, 53); ctx.lineTo(52, 49); ctx.lineTo(65, 66);
    ctx.moveTo(47, 39); ctx.lineTo(61, 35);
    ctx.moveTo(35, 53); ctx.lineTo(25, 71);
    ctx.moveTo(52, 49); ctx.lineTo(42, 73);
    ctx.stroke();
  } else if (avatar.id === 'bolt') {
    ctx.beginPath();
    ctx.moveTo(56, 17); ctx.lineTo(30, 53); ctx.lineTo(48, 53);
    ctx.lineTo(39, 80); ctx.lineTo(68, 41); ctx.lineTo(50, 41);
    ctx.closePath();
    ctx.fill();
  } else if (avatar.id === 'flag') {
    ctx.beginPath();
    ctx.moveTo(35, 76); ctx.lineTo(35, 22);
    ctx.moveTo(38, 23); ctx.lineTo(68, 23); ctx.lineTo(60, 40); ctx.lineTo(68, 56); ctx.lineTo(38, 56);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(18, 70); ctx.lineTo(39, 33); ctx.lineTo(51, 52); ctx.lineTo(61, 28); ctx.lineTo(79, 70);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(39, 33); ctx.lineTo(45, 48); ctx.lineTo(51, 52); ctx.lineTo(61, 28); ctx.lineTo(65, 43);
    ctx.stroke();
  }
  return canvas.toDataURL('image/png');
}

function syncAvatarPicker() {
  const btn = document.getElementById('routeAvatarBtn');
  const picker = document.getElementById('avatarPicker');
  const avatar = avatarById(currentAvatarId);
  if (btn) {
    btn.textContent = avatar.label.toUpperCase();
    btn.classList.toggle('active', picker?.classList.contains('visible') || false);
    btn.title = `Route avatar: ${avatar.label}`;
  }
  picker?.querySelectorAll('.avatar-option').forEach(option => {
    option.classList.toggle('active', option.dataset.avatar === currentAvatarId);
  });
}

function renderAvatarPicker() {
  const picker = document.getElementById('avatarPicker');
  if (!picker) return;
  picker.innerHTML = ROUTE_AVATARS.map(avatar => `
    <button class="avatar-option" type="button" data-avatar="${avatar.id}" title="${avatar.label}" aria-label="${avatar.label}">
      <img alt="" src="${avatarImageDataUri(avatar.id)}">
    </button>
  `).join('');
  picker.querySelectorAll('.avatar-option').forEach(option => {
    option.addEventListener('click', () => selectRouteAvatar(option.dataset.avatar));
  });
  syncAvatarPicker();
}

function toggleAvatarPicker() {
  const picker = document.getElementById('avatarPicker');
  if (!picker) return;
  picker.classList.toggle('visible');
  syncAvatarPicker();
}

function selectRouteAvatar(id) {
  setAvatarPreference(id);
  const picker = document.getElementById('avatarPicker');
  picker?.classList.remove('visible');
  if (earthMarkerEntity?.billboard) {
    earthMarkerEntity.billboard.image = avatarImageDataUri();
  }
  syncAvatarPicker();
}

function isBestInEarth(route) {
  return BEST_IN_EARTH_ROUTES.has(String(route?.activity_id || route?.slug || ''));
}

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

function globeRouteRegions() {
  const byRegion = new Map();
  ROUTES.forEach((route, index) => {
    const key = route.region || route.name || 'Routes';
    if (!byRegion.has(key)) {
      byRegion.set(key, { name: key, routes: [], indexes: [], lat: 0, lng: 0, km: 0, climb: 0, xp: 0 });
    }
    const group = byRegion.get(key);
    group.routes.push(route);
    group.indexes.push(index);
    group.lat += Number(route.center_lat) || 0;
    group.lng += Number(route.center_lng) || 0;
    group.km += Number(route.distance_km) || 0;
    group.climb += Number(route.elevation_gain_m) || 0;
    group.xp += Number(route.xp) || 0;
  });
  return [...byRegion.values()].map(group => {
    group.lat /= Math.max(group.routes.length, 1);
    group.lng /= Math.max(group.routes.length, 1);
    group.bestEarth = group.routes.some(route => isBestInEarth(route));
    group.bestRouteIndex = group.indexes[group.routes.reduce((bestIdx, route, i, routes) =>
      (Number(route.xp) || 0) > (Number(routes[bestIdx].xp) || 0) ? i : bestIdx, 0)];
    return group;
  }).sort((a, b) => b.routes.length - a.routes.length || b.km - a.km);
}

function latLngToVector3(lat, lng, radius = 2.42) {
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * Math.cos(latRad) * Math.cos(lngRad)
  );
}

function makeGlobeLine(points, color, opacity = 0.42) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function makeGlobeCircle(latitude = null, longitude = null, radius = 2.425) {
  const points = [];
  const steps = 128;
  for (let i = 0; i <= steps; i += 1) {
    if (latitude !== null) {
      const lng = -180 + (360 * i / steps);
      points.push(latLngToVector3(latitude, lng, radius));
    } else {
      const lat = -85 + (170 * i / steps);
      points.push(latLngToVector3(lat, longitude, radius));
    }
  }
  return points;
}

function buildGlobeScene() {
  const canvas = document.getElementById('globeCanvas');
  if (!canvas || typeof THREE === 'undefined') return false;
  globeScene = new THREE.Scene();
  globeCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  globeCamera.position.set(0, 0.35, globeCameraDistance);
  globeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  globeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  globeRoot = new THREE.Group();
  globeScene.add(globeRoot);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(2.38, 96, 64),
    new THREE.MeshBasicMaterial({ color: 0x10242c })
  );
  globeRoot.add(globe);
  new THREE.TextureLoader().load(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
    texture => {
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.offset.x = 0.25;
      globe.material.map = texture;
      globe.material.color.set(0x9fb7ac);
      globe.material.needsUpdate = true;
    },
    undefined,
    () => globe.material.color.set(0x10242c)
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(2.52, 96, 64),
    new THREE.MeshBasicMaterial({ color: 0x0b4e83, transparent: true, opacity: 0.12, side: THREE.BackSide })
  );
  globeRoot.add(glow);
  [-60, -30, 0, 30, 60].forEach(lat => globeRoot.add(makeGlobeLine(makeGlobeCircle(lat, null), 0x244663, 0.22)));
  [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].forEach(lng => globeRoot.add(makeGlobeLine(makeGlobeCircle(null, lng), 0x244663, 0.16)));

  globeRegions = globeRouteRegions();
  globeHotspots = [];
  globeRegions.forEach((region, i) => {
    const position = latLngToVector3(region.lat, region.lng, 2.47);
    const intensity = clamp(region.routes.length / 8, 0.38, 1);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 20, 12),
      new THREE.MeshBasicMaterial({
        color: region.bestEarth ? 0xe8d49a : 0x00f19f,
        transparent: true,
        opacity: 0.48 + intensity * 0.44,
      })
    );
    dot.position.copy(position);
    dot.userData.regionIndex = i;
    dot.userData.intensity = intensity;
    globeRoot.add(dot);
    globeHotspots.push(dot);
  });

  const sorted = [...globeRegions].sort((a, b) => b.km - a.km).slice(0, 8);
  sorted.forEach((region, i) => {
    const next = sorted[(i + 1) % sorted.length];
    const a = latLngToVector3(region.lat, region.lng, 2.44);
    const b = latLngToVector3(next.lat, next.lng, 2.44);
    const mid = a.clone().add(b).normalize().multiplyScalar(2.72);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    globeRoot.add(makeGlobeLine(curve.getPoints(42), 0x00f19f, 0.14));
  });

  globeRaycaster = new THREE.Raycaster();
  globePointer = new THREE.Vector2();
  globeTargetRotation = new THREE.Vector2(-0.18, -0.48);
  globeRoot.rotation.set(globeTargetRotation.x, globeTargetRotation.y, 0);
  canvas.addEventListener('click', handleGlobeClick);
  canvas.addEventListener('pointerdown', handleGlobePointerDown);
  canvas.addEventListener('pointermove', handleGlobePointerMove);
  canvas.addEventListener('pointerup', handleGlobePointerUp);
  canvas.addEventListener('pointercancel', handleGlobePointerUp);
  canvas.addEventListener('mousedown', handleGlobeMouseDown);
  canvas.addEventListener('touchstart', handleGlobeTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleGlobeTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleGlobeTouchEnd);
  document.addEventListener('mousemove', handleGlobeMouseMove);
  document.addEventListener('mouseup', handleGlobeMouseUp);
  canvas.addEventListener('wheel', handleGlobeWheel, { passive: false });
  renderGlobeLabels();
  resizeGlobe();
  return true;
}

function renderGlobeLabels() {
  const layer = document.getElementById('globeLabelLayer');
  if (!layer) return;
  layer.innerHTML = '';
  globeLabels = globeRegions.map((region, i) => {
    const el = document.createElement('div');
    el.className = 'globe-label';
    el.textContent = `${region.name} · ${region.routes.length}`;
    el.dataset.regionIndex = i;
    el.addEventListener('click', () => selectGlobeRegion(region));
    layer.appendChild(el);
    return el;
  });
}

function setGlobeRegionMenuOpen(open) {
  globeRegionMenuOpen = open;
  const panel = document.getElementById('globeRoutePanel');
  const head = document.querySelector('.globe-route-head');
  panel?.classList.toggle('menu-open', open);
  head?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleGlobeRegionMenu() {
  setGlobeRegionMenuOpen(!globeRegionMenuOpen);
  renderGlobeRegionMenu();
}

function renderGlobeRegionMenu() {
  const menu = document.getElementById('globeRegionMenu');
  if (!menu) return;
  menu.innerHTML = globeRegions.map((region, i) => `
    <button class="globe-region-option ${selectedGlobeRegion === region ? 'active' : ''}" type="button" onclick="selectGlobeRegion(globeRegions[${i}])">
      <b>${escapeHtml(region.name)}</b>
      <span>${region.routes.length} · ${region.km.toFixed(0)} km</span>
    </button>
  `).join('');
}

function renderGlobeRegionOverview() {
  selectedGlobeRegion = null;
  const name = document.getElementById('globeRegionName');
  const meta = document.getElementById('globeRegionMeta');
  const list = document.getElementById('globeRouteList');
  const totalKm = globeRegions.reduce((sum, region) => sum + region.km, 0);
  if (name) name.textContent = 'Route regions';
  if (meta) meta.textContent = `${globeRegions.length} regions · ${ROUTES.length} routes · ${totalKm.toFixed(0)} km`;
  if (list) list.innerHTML = '';
  setGlobeRegionMenuOpen(true);
  renderGlobeRegionMenu();
}

function resizeGlobe() {
  if (!globeRenderer || !globeCamera) return;
  const canvas = document.getElementById('globeCanvas');
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  globeRenderer.setSize(width, height, false);
  globeCamera.aspect = width / height;
  globeCamera.updateProjectionMatrix();
}

function updateGlobeLabels() {
  if (!globeCamera || !globeRoot || !globeLabels.length) return;
  const canvas = document.getElementById('globeCanvas');
  const rect = canvas.getBoundingClientRect();
  const placed = [];
  const cameraFacing = new THREE.Vector3(0, 0, 1);
  const labels = globeHotspots.map((dot, i) => {
    const label = globeLabels[i];
    if (!label) return null;
    const world = dot.getWorldPosition(new THREE.Vector3());
    const projected = world.clone().project(globeCamera);
    const facing = world.clone().normalize().dot(cameraFacing);
    const selected = selectedGlobeRegion === globeRegions[i];
    label.classList.toggle('active', selected);
    return {
      label,
      selected,
      priority: (selected ? 100 : 0) + globeRegions[i].routes.length,
      visible: projected.z < 1 && facing > 0.16,
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }).filter(Boolean).sort((a, b) => b.priority - a.priority);
  labels.forEach(item => {
    const width = item.label.offsetWidth || 130;
    const height = item.label.offsetHeight || 26;
    const box = { left: item.x - width / 2, right: item.x + width / 2, top: item.y - height / 2, bottom: item.y + height / 2 };
    const collides = placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
    const inFrame = box.right > 8 && box.left < rect.width - 8 && box.bottom > 8 && box.top < rect.height - 8;
    const show = item.visible && inFrame && (item.selected || !collides);
    item.label.style.left = `${item.x}px`;
    item.label.style.top = `${item.y}px`;
    item.label.style.display = show ? 'flex' : 'none';
    if (show) placed.push(box);
  });
}

function animateGlobe() {
  if (!globeRenderer || !globeScene || !globeCamera || !globeRoot) return;
  globeCamera.position.z += (globeCameraDistance - globeCamera.position.z) * 0.08;
  globeRoot.rotation.x += (globeTargetRotation.x - globeRoot.rotation.x) * 0.055;
  globeRoot.rotation.y += (globeTargetRotation.y - globeRoot.rotation.y) * 0.055;
  if (!globeDrag.active) globeRoot.rotation.y += 0.0009;
  globeHotspots.forEach((dot, i) => {
    const selected = selectedGlobeRegion === globeRegions[i];
    dot.scale.setScalar(selected ? 1.12 : 1);
    dot.material.opacity = selected ? 1 : 0.48 + (dot.userData.intensity || 0.5) * 0.44;
  });
  updateGlobeLabels();
  globeRenderer.render(globeScene, globeCamera);
  globeAnimationFrame = requestAnimationFrame(animateGlobe);
}

function initGlobe() {
  if (!GLOBE_LAB_MODE) return;
  if (!globeRenderer && !buildGlobeScene()) return;
  if (!selectedGlobeRegion && globeRegions.length) renderGlobeRegionOverview();
  if (!globeAnimationFrame) animateGlobe();
}

function setGlobePointer(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  globePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  globePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function regionFromGlobeEvent(event) {
  if (!globeRaycaster || !globeCamera) return null;
  setGlobePointer(event);
  globeRaycaster.setFromCamera(globePointer, globeCamera);
  const hit = globeRaycaster.intersectObjects(globeHotspots, false)[0];
  return hit ? globeRegions[hit.object.userData.regionIndex] : null;
}

function handleGlobeClick(event) {
  if (globeDrag.moved) return;
  const region = regionFromGlobeEvent(event);
  if (region) selectGlobeRegion(region);
}

function handleGlobePointerDown(event) {
  if (!globeRoot || !globeTargetRotation) return;
  event.preventDefault();
  beginGlobeDrag(event.clientX, event.clientY);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.style.cursor = 'grabbing';
}

function beginGlobeDrag(clientX, clientY) {
  globeDrag = {
    active: true,
    moved: false,
    x: clientX,
    y: clientY,
    rotX: globeTargetRotation.x,
    rotY: globeTargetRotation.y,
  };
}

function updateGlobeDrag(clientX, clientY) {
  if (!globeDrag.active || !globeTargetRotation) return false;
  const dx = clientX - globeDrag.x;
  const dy = clientY - globeDrag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) globeDrag.moved = true;
  globeTargetRotation.y = globeDrag.rotY + dx * 0.006;
  globeTargetRotation.x = clamp(globeDrag.rotX + dy * 0.004, -1.1, 1.1);
  return true;
}

function handleGlobePointerMove(event) {
  if (updateGlobeDrag(event.clientX, event.clientY)) {
    event.preventDefault();
    event.currentTarget.style.cursor = 'grabbing';
    return;
  }
  const region = regionFromGlobeEvent(event);
  event.currentTarget.style.cursor = region ? 'pointer' : 'grab';
}

function handleGlobePointerUp(event) {
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  event.currentTarget.style.cursor = 'grab';
  endGlobeDrag();
}

function endGlobeDrag() {
  window.setTimeout(() => { globeDrag.moved = false; }, 0);
  globeDrag.active = false;
}

function handleGlobeMouseDown(event) {
  if (event.button !== 0 || !globeRoot || !globeTargetRotation) return;
  event.preventDefault();
  beginGlobeDrag(event.clientX, event.clientY);
  event.currentTarget.style.cursor = 'grabbing';
}

function handleGlobeMouseMove(event) {
  if (updateGlobeDrag(event.clientX, event.clientY)) event.preventDefault();
}

function handleGlobeMouseUp() {
  if (globeDrag.active) endGlobeDrag();
}

function handleGlobeTouchStart(event) {
  const touch = event.touches?.[0];
  if (!touch || !globeRoot || !globeTargetRotation) return;
  event.preventDefault();
  beginGlobeDrag(touch.clientX, touch.clientY);
}

function handleGlobeTouchMove(event) {
  const touch = event.touches?.[0];
  if (touch && updateGlobeDrag(touch.clientX, touch.clientY)) event.preventDefault();
}

function handleGlobeTouchEnd() {
  if (globeDrag.active) endGlobeDrag();
}

function handleGlobeWheel(event) {
  event.preventDefault();
  globeCameraDistance = clamp(globeCameraDistance + event.deltaY * 0.004, 4.8, 9.2);
}

function selectGlobeRegion(region, options = {}) {
  selectedGlobeRegion = region;
  const name = document.getElementById('globeRegionName');
  const meta = document.getElementById('globeRegionMeta');
  const list = document.getElementById('globeRouteList');
  if (name) name.textContent = region.name;
  if (meta) {
    meta.textContent = `${region.routes.length} routes · ${region.km.toFixed(0)} km · ${Math.round(region.climb).toLocaleString()} m up`;
  }
  if (list) {
    list.innerHTML = region.routes.map((route, i) => `
      <button class="globe-route-item" type="button" onclick="openRoute(${region.indexes[i]})">
        <b>${escapeHtml(route.name)}</b>
        <span>${escapeHtml(route.type)} · ${route.distance_km.toFixed(1)} km · ${(route.elevation_gain_m || 0).toLocaleString()} m up</span>
      </button>
    `).join('');
    list.scrollTop = 0;
  }
  setGlobeRegionMenuOpen(false);
  renderGlobeRegionMenu();
  if (options.rotate !== false && globeTargetRotation) {
    globeTargetRotation.x = -region.lat * Math.PI / 360;
    globeTargetRotation.y = -(region.lng + 12) * Math.PI / 180;
  }
}

function selectBestGlobeRegion() {
  const region = globeRegions.find(item => item.bestEarth) || globeRegions[0];
  if (region) selectGlobeRegion(region);
}

function showGlobe(options = {}) {
  const { updateUrl = true } = options;
  document.getElementById('detail').classList.remove('active');
  document.getElementById('gallery').style.display = 'none';
  document.getElementById('globeLab').classList.add('active');
  document.getElementById('backBtn').style.display = 'none';
  if (updateUrl && location.hash) history.pushState({ globe: true }, '', `${location.pathname}${location.search}`);
  stopRoutePlayback();
  stopCinemaLoop();
  disposeEarthReplay();
  if (map) {
    map.remove();
    map = null;
    mapSlug = null;
  }
  initGlobe();
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

function applyQuestPreset(kind) {
  Object.keys(galleryFilters).forEach(key => { galleryFilters[key] = 'All'; });
  if (kind === 'ride') galleryFilters.type = 'Ride';
  if (kind === 'easy') galleryFilters.difficulty = 'Moderate';
  if (kind === 'xp') galleryFilters.difficulty = 'Epic';
  document.querySelectorAll('[data-filter]').forEach(select => {
    select.value = galleryFilters[select.dataset.filter] || 'All';
  });
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
    if (GLOBE_LAB_MODE) showGlobe({ updateUrl: false });
    else showGallery({ updateUrl: false });
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
  const totalKm = filtered.reduce((s,r)=>s+r.distance_km,0);
  const totalXp = filtered.reduce((s,r)=>s+(r.xp || 0),0);
  const totalClimb = filtered.reduce((s,r)=>s+(r.elevation_gain_m || 0),0);
  const suffix = filtered.length === ROUTES.length ? '' : ` · FILTERED FROM ${ROUTES.length}`;
  document.getElementById('galleryCount').textContent =
    `${filtered.length} QUEST${filtered.length === 1 ? '' : 'S'} · ${totalKm.toFixed(0)} KM TOTAL${suffix}`;
  document.getElementById('atlasStats').innerHTML = `
    <div class="atlas-stat"><b>${filtered.length}</b><span>quests</span></div>
    <div class="atlas-stat"><b>${totalKm.toFixed(0)}</b><span>km mapped</span></div>
    <div class="atlas-stat"><b>${totalXp.toLocaleString()}</b><span>xp available</span></div>
    <div class="atlas-stat"><b>${Math.round(totalClimb).toLocaleString()}</b><span>m climbing</span></div>
  `;
  document.getElementById('curationGrid').innerHTML = `
    <div class="curation-stat"><b>${CURATION.approved.toLocaleString()}</b><span>published</span></div>
    <div class="curation-stat"><b>${CURATION.pending.toLocaleString()}</b><span>pending</span></div>
    <div class="curation-stat"><b>${CURATION.total.toLocaleString()}</b><span>strava routes</span></div>
  `;
  if (filteredRoutes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'gallery-empty';
    empty.innerHTML = 'No quests match these filters. <button type="button" onclick="resetFilters()">Reset filters</button>';
    gal.appendChild(empty);
    return;
  }
  filteredRoutes.forEach(({ route: r, index: i }) => {
    const card = document.createElement('div');
    card.className = 'quest-card';
    const typeClass = r.type === 'Ride' ? 'ride' : 'run';
    const typeIcon  = r.type === 'Ride'
      ? '<svg class="icon"><use href="#i-bike"/></svg>'
      : '<svg class="icon"><use href="#i-runner"/></svg>';
    const yearMonth = r.date ? r.date.substring(0,7) : '';
    card.innerHTML = `
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
        ${isBestInEarth(r) ? '<span class="quest-chip earth">Best in Earth</span>' : ''}
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
  const climb = Math.round(route.elevation_gain_m || 0).toLocaleString();
  const objective = route.completion_rule || `Complete ${route.distance_km.toFixed(1)} km.`;
  const facts = [
    ['Reward', `${(route.xp || 0).toLocaleString()} XP`],
    ['Difficulty', route.difficulty || 'Open'],
    [isBestInEarth(route) ? 'Replay' : 'Proof', isBestInEarth(route) ? 'Best in Earth' : 'GPS route'],
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
  document.getElementById('globeLab').classList.remove('active');
  document.getElementById('gallery').style.display = 'none';
  document.getElementById('detail').classList.add('active');
  document.getElementById('backBtn').style.display = 'inline-flex';
  const r = ROUTES[i];
  if (updateUrl) setQuestUrl(r);
  const typeIcon = r.type === 'Ride'
    ? '<svg class="icon"><use href="#i-bike"/></svg>'
    : '<svg class="icon"><use href="#i-runner"/></svg>';
  document.getElementById('detailName').textContent = r.name;
  const earthBadge = isBestInEarth(r)
    ? ' <span class="detail-earth-badge">BEST IN EARTH</span>'
    : '';
  document.getElementById('detailMeta').innerHTML =
    `${typeIcon} ${r.type.toUpperCase()} · ${r.distance_km.toFixed(1)} KM · ${(r.elevation_gain_m || 0).toLocaleString()} M UP · ${(r.xp || 0).toLocaleString()} XP · ${r.date}${earthBadge}`;
  document.getElementById('detailQuote').textContent = r.quest_blurb || `"${r.subtitle}"`;
  document.getElementById('stravaBtn').href =
    `https://www.strava.com/activities/${r.activity_id}`;
  const descEl = document.getElementById('detailDesc');
  if (r.description) {
    descEl.textContent = r.description;
    descEl.style.display = 'block';
  }
  else { descEl.style.display = 'none'; }
  document.getElementById('artifactContext').textContent =
    `${r.type.toUpperCase()} · ${r.difficulty || 'OPEN'} · ${r.date || 'DATE TBD'}`;
  renderCompletionPanel(r);
  document.getElementById('kmTotal').textContent =
    (r.route[r.route.length-1].d / 1000).toFixed(2) + ' km';
  initRoute();
  window.scrollTo(0, 0);
}

function showGallery(options = {}) {
  const { updateUrl = true } = options;
  stopRoutePlayback();
  disposeEarthReplay();
  document.getElementById('globeLab').classList.remove('active');
  document.getElementById('gallery').style.display = 'grid';
  document.getElementById('detail').classList.remove('active');
  document.getElementById('backBtn').style.display = 'none';
  activeRouteIdx = -1;
  if (updateUrl) setGalleryUrl();
  renderGallery();
}

function initRoute() {
  const r = ROUTES[activeRouteIdx];
  stopRoutePlayback();
  allPhotos = [];
  if (earthModeEnabled) {
    disposeEarthReplay();
    if (map) {
      map.remove();
      map = null;
      mapSlug = null;
    }
    stopCinemaLoop();
    setEarthMode('loading', 'Loading Earth mode', 'Building a photorealistic 3D route world from Google Map Tiles.');
  } else {
    disposeEarthReplay();
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
    try {
      initRouteCinema(r);
    } catch (err) {
      console.warn('Route cinema unavailable', err);
      cinemaRenderer = null;
      cinemaSlug = r.slug;
    }
    initRouteCam(r).catch(err => {
      console.warn('Route cam unavailable', err);
      routeCamSlug = r.slug;
      setRouteCamStatus('Route cam unavailable');
      setRouteCamMode('no-imagery', 'Route cam unavailable', 'Street View could not initialize for this route.');
    });
  }
  renderStrip();
  syncRouteLockButton();
  syncRoutePlayButton();
  syncRouteCinemaButton();
  const scrubber = document.getElementById('scrubber');
  scrubber.max = r.route.length - 1; scrubber.step = 'any'; scrubber.value = 0;
  setRouteIndex(0);
  if (earthModeEnabled) {
    initEarthReplay(r);
  }
  if (routeCinemaEnabled && routeCinemaMode === 'flyover') {
    startRoutePlayback();
  }
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

function routePointAt(route, cursor) {
  const pts = route.route || [];
  if (!pts.length) return { lat: route.center_lat || 0, lng: route.center_lng || 0, elev: 0, d: 0 };
  const clamped = Math.max(0, Math.min(cursor, pts.length - 1));
  const lo = Math.floor(clamped);
  const hi = Math.min(pts.length - 1, Math.ceil(clamped));
  const t = clamped - lo;
  const a = pts[lo];
  const b = pts[hi] || a;
  const lerp = (x, y) => (Number(x) || 0) + ((Number(y) || 0) - (Number(x) || 0)) * t;
  return {
    lat: lerp(a.lat, b.lat),
    lng: lerp(a.lng, b.lng),
    elev: lerp(a.elev, b.elev),
    d: lerp(a.d, b.d),
  };
}

function routeFeature(route, endIdx = route.route.length - 1) {
  const clamped = Math.max(0, Math.min(endIdx, route.route.length - 1));
  const wholeIdx = Math.floor(clamped);
  const coords = route.route.slice(0, Math.max(1, wholeIdx + 1)).map(p => [p.lng, p.lat]);
  if (clamped > wholeIdx && wholeIdx < route.route.length - 1) {
    const p = routePointAt(route, clamped);
    coords.push([p.lng, p.lat]);
  }
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
    paint: { 'line-color': '#F0DFAE', 'line-opacity': 0.18, 'line-width': 10, 'line-blur': 10 },
  });
  targetMap.addLayer({
    id: 'route-full', type: 'line', source: 'route-full',
    paint: { 'line-color': '#E9EFE5', 'line-opacity': 0.46, 'line-width': 3 },
  });
  targetMap.addLayer({
    id: 'route-progress', type: 'line', source: 'route-progress',
    paint: { 'line-color': '#00F19F', 'line-opacity': 0.92, 'line-width': 4.5 },
  });
  targetMap.addLayer({
    id: 'route-point-halo', type: 'circle', source: 'route-point',
    paint: { 'circle-radius': 18, 'circle-color': '#F0DFAE', 'circle-opacity': 0.22, 'circle-blur': 0.56 },
  });
  targetMap.addLayer({
    id: 'route-point', type: 'circle', source: 'route-point',
    paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF', 'circle-stroke-color': '#00F19F', 'circle-stroke-width': 3 },
  });
  if (includePhotos) {
    targetMap.addSource('route-photos', { type: 'geojson', data: photoFeatures() });
    targetMap.addLayer({
      id: 'route-photos', type: 'circle', source: 'route-photos',
      paint: { 'circle-radius': 6, 'circle-color': '#F0DFAE', 'circle-stroke-color': '#11130F', 'circle-stroke-width': 2 },
    });
    targetMap.on('click', 'route-photos', e => {
      const idx = e.features?.[0]?.properties?.idx;
      if (idx !== undefined) jumpToPhoto(Number(idx));
    });
    targetMap.on('mouseenter', 'route-photos', () => { targetMap.getCanvas().style.cursor = 'pointer'; });
    targetMap.on('mouseleave', 'route-photos', () => { targetMap.getCanvas().style.cursor = ''; });
  }
}

function routeSvgMarkup(route) {
  const pts = route.route || [];
  if (pts.length < 2) return '';
  const w = 520, h = 260, pad = 24;
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const dLat = latMax - latMin || 1e-6;
  const dLng = lngMax - lngMin || 1e-6;
  const lngScale = Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  const dLngAdjusted = dLng * lngScale || 1e-6;
  const scale = Math.min((w - pad * 2) / dLngAdjusted, (h - pad * 2) / dLat);
  const mapW = dLngAdjusted * scale;
  const mapH = dLat * scale;
  const ox = (w - mapW) / 2;
  const oy = (h - mapH) / 2;
  const points = pts.map(p => {
    const x = ox + (p.lng - lngMin) * lngScale * scale;
    const y = oy + (latMax - p.lat) * scale;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Route trace">
    <polyline points="${points}" fill="none" stroke="#00F19F" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function showMapFallback(route, copy = 'MapLibre terrain is loading. The quest route remains playable from the local route trace.') {
  const fallback = document.getElementById('mapFallback');
  if (!fallback) return;
  document.getElementById('mapFallbackRoute').innerHTML = routeSvgMarkup(route);
  fallback.querySelector('.map-fallback-copy').textContent = copy;
  fallback.classList.remove('hidden');
}

function hideMapFallback() {
  const fallback = document.getElementById('mapFallback');
  if (fallback) fallback.classList.add('hidden');
}

function initMainMap(route) {
  showMapFallback(route);
  if (typeof maplibregl === 'undefined') {
    showMapFallback(route, 'MapLibre is unavailable. Local route trace mode is active.');
    return;
  }
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
    addRouteLayers(map, route, { includePhotos: false });
    map.fitBounds(routeBounds(route), { padding: 86, duration: 900, pitch: 56, bearing: -18 });
    map.once('moveend', () => { routeLockCameraReady = true; });
    map.on('click', e => snapToRoute(e.lngLat));
    map.on('move', () => {
      if (routeCinemaEnabled && routeCinemaMode === 'flyover') {
        updateCinemaMomentLabels(Number(document.getElementById('scrubber')?.value || 0));
      }
    });
    updateMainMapProgress(route, 0);
    hideMapFallback();
  });
  map.on('error', () => {
    if (!map || !map.loaded()) {
      showMapFallback(route, 'Terrain tiles are unavailable. Local route trace mode is active.');
    }
  });
}

function updateMapSources(targetMap, route, idx) {
  if (!targetMap || !targetMap.isStyleLoaded()) return;
  const progress = targetMap.getSource('route-progress');
  const point = targetMap.getSource('route-point');
  if (progress) progress.setData(routeFeature(route, idx));
  if (point) point.setData(pointFeature(routePointAt(route, idx)));
}

function updateMainMapProgress(route, idx) {
  if (!map || mapSlug !== route.slug) return;
  updateMapSources(map, route, idx);
}

function setEarthStatus(copy) {
  const el = document.getElementById('earthStatus');
  if (el) el.textContent = copy;
}

function setEarthSettling(copy = '') {
  const el = document.getElementById('earthSettling');
  if (el && copy) el.textContent = copy;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setEarthMode(mode, title = '', copy = '') {
  const layer = document.getElementById('earthLayer');
  const titleEl = document.getElementById('earthFallbackTitle');
  const copyEl = document.getElementById('earthFallbackCopy');
  if (!layer) return;
  earthState = mode;
  layer.classList.toggle('active', earthModeEnabled);
  layer.classList.toggle('loading', mode === 'loading');
  layer.classList.toggle('ready', mode === 'ready');
  layer.classList.toggle('unavailable', mode === 'unavailable');
  if (mode !== 'ready') {
    layer.classList.remove('settling', 'partial');
  }
  if (titleEl && title) titleEl.textContent = title;
  if (copyEl && copy) copyEl.textContent = copy;
}

function earthUrlForCurrentRoute(enabled) {
  const params = new URLSearchParams(location.search);
  params.set('lab', enabled ? 'earth' : 'atlas');
  const search = params.toString();
  return `${location.pathname}${search ? '?' + search : ''}${location.hash || ''}`;
}

function toggleEarthReplay() {
  const nextMode = earthModeEnabled ? 'atlas' : 'earth';
  setReplayModePreference(nextMode);
  location.href = earthUrlForCurrentRoute(nextMode === 'earth');
}

function exitEarthMode() {
  if (!earthModeEnabled) return;
  setReplayModePreference('atlas');
  location.href = earthUrlForCurrentRoute(false);
}

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function shouldBlockEarthForViewport() {
  return window.matchMedia?.('(max-width: 700px)').matches;
}

function loadCesiumApi() {
  if (window.Cesium?.Viewer) return Promise.resolve(true);
  if (earthCesiumPromise) return earthCesiumPromise;
  earthCesiumPromise = new Promise(resolve => {
    const cssId = 'goDieselCesiumCss';
    if (!document.getElementById(cssId)) {
      const link = document.createElement('link');
      link.id = cssId;
      link.rel = 'stylesheet';
      link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Widgets/widgets.css';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Cesium.js';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.Cesium?.Viewer));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(Boolean(window.Cesium?.Viewer)), 15000);
  });
  return earthCesiumPromise;
}

function disposeEarthReplay() {
  earthReady = false;
  earthState = 'inactive';
  earthSlug = null;
  earthCameraBearing = null;
  earthTileFailures = 0;
  earthTilesLoading = 0;
  earthBlankWarnings = 0;
  earthScrubUntil = 0;
  if (earthBlankCheckTimer) clearTimeout(earthBlankCheckTimer);
  earthBlankCheckTimer = null;
  earthFullEntity = null;
  earthProgressEntity = null;
  earthMarkerEntity = null;
  earthTileset = null;
  earthLoadToken++;
  if (earthViewer && !earthViewer.isDestroyed?.()) {
    earthViewer.destroy();
  }
  earthViewer = null;
  const canvas = document.getElementById('earthCanvas');
  if (canvas) canvas.innerHTML = '';
}

function earthPositionAt(route, idx, heightOffset = 58) {
  if (!window.Cesium || !route?.route?.length) return null;
  const p = routePointAt(route, clamp(idx, 0, route.route.length - 1));
  return Cesium.Cartesian3.fromDegrees(p.lng, p.lat, (Number(p.elev) || 0) + heightOffset);
}

function earthPositionsBetween(route, startIdx = 0, endIdx = route.route.length - 1, heightOffset = 58) {
  if (!window.Cesium || !route?.route?.length) return [];
  const maxIdx = route.route.length - 1;
  const start = clamp(startIdx, 0, maxIdx);
  const end = clamp(endIdx, 0, maxIdx);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const positions = [];
  positions.push(earthPositionAt(route, from, heightOffset));
  for (let i = Math.ceil(from); i <= Math.floor(to); i += 1) {
    positions.push(earthPositionAt(route, i, heightOffset));
  }
  if (to > Math.floor(to)) {
    positions.push(earthPositionAt(route, to, heightOffset));
  }
  return positions.filter(Boolean);
}

function earthLocalRoutePositions(route, idx) {
  return earthPositionsBetween(route, idx - 22, idx + 62, 58);
}

function earthTrailPositions(route, idx) {
  return earthPositionsBetween(route, idx - 22, idx, 64);
}

function createEarthViewer() {
  const Cesium = window.Cesium;
  Cesium.Ion.defaultAccessToken = '';
  const viewer = new Cesium.Viewer('earthCanvas', {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    shouldAnimate: true,
    requestRenderMode: false,
    contextOptions: {
      webgl: {
        preserveDrawingBuffer: true,
      },
    },
  });
  viewer.scene.globe.show = false;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
  return viewer;
}

async function createGoogleEarthTileset() {
  const Cesium = window.Cesium;
  const url = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const options = {
    showCreditsOnScreen: true,
    maximumScreenSpaceError: 24,
    dynamicScreenSpaceError: true,
    skipLevelOfDetail: true,
  };
  if (Cesium.Cesium3DTileset.fromUrl) return Cesium.Cesium3DTileset.fromUrl(url, options);
  return new Cesium.Cesium3DTileset({ url, ...options });
}

function earthRouteMetrics(route) {
  const pts = route.route || [];
  const elevs = pts.map(p => Number(p.elev) || 0);
  const totalKm = Number(route.distance_km) || ((pts[pts.length - 1]?.d || 0) / 1000) || 1;
  const elevMin = elevs.length ? Math.min(...elevs) : 0;
  const elevMax = elevs.length ? Math.max(...elevs) : 0;
  return {
    totalKm,
    climb: Number(route.elevation_gain_m) || 0,
    elevSpan: Math.max(0, elevMax - elevMin),
  };
}

function earthCameraProfile(route, playing, scrubbing = false) {
  const metrics = earthRouteMetrics(route);
  const lengthFactor = clamp((metrics.totalKm - 18) / 92, 0, 1);
  const climbFactor = clamp((metrics.climb + metrics.elevSpan) / Math.max(metrics.totalKm * 55, 1), 0, 1);
  const shortFactor = clamp((18 - metrics.totalKm) / 12, 0, 1);
  const baseHeight = playing ? 760 : scrubbing ? 900 : 1040;
  const baseTrail = playing ? 780 : scrubbing ? 920 : 1080;
  return {
    lookahead: Math.round((playing ? 18 : 10) + lengthFactor * 18),
    height: baseHeight + lengthFactor * 760 + climbFactor * 360 - shortFactor * 180,
    trailing: baseTrail + lengthFactor * 860 + climbFactor * 280 - shortFactor * 240,
    pitch: Cesium.Math.toRadians(playing ? -36 - lengthFactor * 4 : -42 - lengthFactor * 3),
    smooth: playing ? 0.08 : scrubbing ? 0.16 : 0.22,
    flyDuration: playing ? 0 : scrubbing ? 0.52 : 0.34,
  };
}

function syncEarthTileStatus() {
  if (!earthModeEnabled || !earthReady) return;
  const layer = document.getElementById('earthLayer');
  if (earthTileFailures >= EARTH_PARTIAL_TILE_FAILURE_THRESHOLD) {
    layer?.classList.remove('settling');
    layer?.classList.add('partial');
    earthState = 'partial';
    setEarthStatus('3D tiles partially unavailable');
    setEarthSettling('3D tiles partially unavailable');
  } else if (earthTilesLoading > 0) {
    layer?.classList.add('settling');
    layer?.classList.remove('partial');
    earthState = 'settling';
    setEarthStatus('Settling 3D tiles');
    setEarthSettling('Resolving 3D terrain');
  } else {
    layer?.classList.remove('settling', 'partial');
    earthState = 'ready';
    setEarthStatus('Photorealistic 3D tiles');
  }
}

function scheduleEarthBlankCheck(delay = 2800) {
  if (earthBlankCheckTimer) clearTimeout(earthBlankCheckTimer);
  earthBlankCheckTimer = setTimeout(checkEarthBlankFrame, delay);
}

function checkEarthBlankFrame() {
  earthBlankCheckTimer = null;
  if (!earthModeEnabled || !earthReady) return;
  const canvas = document.querySelector('#earthCanvas canvas');
  if (!canvas || canvas.width < 10 || canvas.height < 10) return;
  try {
    const sample = document.createElement('canvas');
    sample.width = 12;
    sample.height = 12;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let bright = 0, visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (a > 0.9 && b > 8) visible += 1;
      bright += b;
    }
    const avg = bright / (data.length / 4);
    const visibleRatio = visible / (data.length / 4);
    if (avg < 5 || visibleRatio < 0.04) {
      earthBlankWarnings += 1;
      if (earthBlankWarnings >= 2) {
        earthTileFailures = Math.max(earthTileFailures, EARTH_PARTIAL_TILE_FAILURE_THRESHOLD);
        syncEarthTileStatus();
      } else {
        scheduleEarthBlankCheck(1800);
      }
    }
  } catch (err) {
    // Browser security can block canvas sampling for third-party 3D tiles; tile events still cover API failures.
  }
}

function attachEarthTileStatus(viewer, tileset, token) {
  earthTileFailures = 0;
  earthTilesLoading = 0;
  if (tileset.tileFailed?.addEventListener) {
    tileset.tileFailed.addEventListener(() => {
      if (token !== earthLoadToken) return;
      earthTileFailures += 1;
      syncEarthTileStatus();
    });
  }
  if (viewer.scene.tileLoadProgressEvent?.addEventListener) {
    viewer.scene.tileLoadProgressEvent.addEventListener(count => {
      if (token !== earthLoadToken) return;
      earthTilesLoading = Number(count) || 0;
      syncEarthTileStatus();
    });
  }
}

async function initEarthReplay(route) {
  if (!earthModeEnabled) return;
  const token = ++earthLoadToken;
  earthReady = false;
  earthSlug = route.slug;
  earthCameraBearing = null;
  setEarthMode('loading', 'Loading Earth mode', 'Building a photorealistic 3D route world from Google Map Tiles.');
  setEarthStatus('Loading 3D world');
  if (shouldBlockEarthForViewport()) {
    setEarthMode('unavailable', 'Desktop prototype', 'Earth mode is desktop-first while we tune photorealistic 3D playback.');
    setEarthStatus('Desktop prototype');
    return;
  }
  if (!GOOGLE_MAPS_API_KEY) {
    setEarthMode('unavailable', 'Earth mode unavailable', 'Add GOOGLE_MAPS_API_KEY with Map Tiles API access to enable photorealistic 3D tiles.');
    setEarthStatus('Missing API key');
    return;
  }
  if (!webglAvailable()) {
    setEarthMode('unavailable', 'WebGL unavailable', 'This browser cannot start the 3D route world.');
    setEarthStatus('WebGL unavailable');
    return;
  }
  const loaded = await loadCesiumApi();
  if (token !== earthLoadToken || earthSlug !== route.slug) return;
  if (!loaded || !window.Cesium?.Viewer) {
    setEarthMode('unavailable', 'Cesium unavailable', 'The 3D engine could not load in this browser session.');
    setEarthStatus('Cesium unavailable');
    return;
  }
  try {
    if (!earthViewer || earthViewer.isDestroyed?.()) earthViewer = createEarthViewer();
    earthTileset = await createGoogleEarthTileset();
    if (token !== earthLoadToken || earthSlug !== route.slug) return;
    earthViewer.scene.primitives.add(earthTileset);
    attachEarthTileStatus(earthViewer, earthTileset, token);
    earthFullEntity = earthViewer.entities.add({
      name: 'Local route preview',
      polyline: {
        positions: earthLocalRoutePositions(route, 0),
        width: 2,
        material: Cesium.Color.fromCssColorString('#f0dfae').withAlpha(0.46),
      },
    });
    earthProgressEntity = earthViewer.entities.add({
      name: 'Recent route trail',
      polyline: {
        positions: earthTrailPositions(route, 0),
        width: 5,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString('#00f19f').withAlpha(0.98),
          glowPower: 0.12,
        }),
      },
    });
    const p = routePointAt(route, 0);
    earthMarkerEntity = earthViewer.entities.add({
      name: 'Current route position',
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, (Number(p.elev) || 0) + 150),
      billboard: {
        image: avatarImageDataUri(),
        width: 38,
        height: 38,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    earthReady = true;
    setEarthMode('ready');
    setEarthStatus('Photorealistic 3D tiles');
    updateEarthReplay(route, Number(document.getElementById('scrubber')?.value || 0));
    syncEarthTileStatus();
    scheduleEarthBlankCheck(3600);
  } catch (err) {
    console.warn('Earth replay unavailable', err);
    setEarthMode('unavailable', 'Earth mode unavailable', 'Google Photorealistic 3D Tiles could not load for this route.');
    setEarthStatus('Tiles unavailable');
  }
}

function updateEarthReplay(route, idx) {
  if (!earthModeEnabled || !earthReady || earthSlug !== route.slug || !earthViewer || !window.Cesium) return;
  const p = routePointAt(route, idx);
  earthFullEntity.polyline.positions = earthLocalRoutePositions(route, idx);
  earthProgressEntity.polyline.positions = earthTrailPositions(route, idx);
  earthMarkerEntity.position = Cesium.Cartesian3.fromDegrees(p.lng, p.lat, (Number(p.elev) || 0) + 150);
  updateEarthCamera(route, idx);
}

function updateEarthCamera(route, idx) {
  if (!earthModeEnabled || !earthReady || !earthViewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  const p = routePointAt(route, idx);
  const profile = earthCameraProfile(route, routePlaying, performance.now() < earthScrubUntil);
  const targetBearing = routeBearing(route, idx, profile.lookahead);
  earthCameraBearing = smoothBearing(earthCameraBearing, targetBearing, profile.smooth);
  const heading = Cesium.Math.toRadians(earthCameraBearing);
  const cameraLat = p.lat - Math.cos(heading) * profile.trailing / 111320;
  const cameraLng = p.lng - Math.sin(heading) * profile.trailing / (111320 * Math.max(0.2, Math.cos(p.lat * Math.PI / 180)));
  const destination = Cesium.Cartesian3.fromDegrees(cameraLng, cameraLat, (Number(p.elev) || 0) + profile.height);
  if (routePlaying) {
    earthViewer.camera.setView({
      destination,
      orientation: {
        heading,
        pitch: profile.pitch,
        roll: 0,
      },
    });
    return;
  }
  earthViewer.camera.cancelFlight?.();
  earthViewer.camera.flyTo({
    destination,
    orientation: {
      heading,
      pitch: profile.pitch,
      roll: 0,
    },
    duration: profile.flyDuration,
  });
  earthViewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

function loadGoogleMapsApi() {
  if (window.google?.maps?.StreetViewPanorama) return Promise.resolve(true);
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve(false);
  if (window.__googleMapsPromise) return window.__googleMapsPromise;
  window.__googleMapsPromise = new Promise(resolve => {
    const callbackName = '__goDieselGoogleMapsReady';
    window[callbackName] = () => resolve(true);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(Boolean(window.google?.maps?.StreetViewPanorama)), 12000);
  });
  return window.__googleMapsPromise;
}

function setRouteCamStatus(copy) {
  const el = document.getElementById('routeCamStatus');
  if (el) el.textContent = copy;
}

function setRouteCamMode(mode, title = '', copy = '') {
  const cam = document.getElementById('routeCam');
  const titleEl = document.getElementById('routeCamEmptyTitle');
  const copyEl = document.getElementById('routeCamEmptyCopy');
  if (!cam) return;
  cam.classList.toggle('loading', mode === 'loading');
  cam.classList.toggle('no-imagery', mode === 'no-imagery');
  if (titleEl && title) titleEl.textContent = title;
  if (copyEl && copy) copyEl.textContent = copy;
}

function routeCamBucket(idx) {
  return Math.max(0, Math.floor(Number(idx) / 12) * 12);
}

function routeCamCacheKey(route, idx) {
  return `${route.slug}:${routeCamBucket(idx)}`;
}

async function initRouteCam(route) {
  routeCamReady = false;
  routeCamBearing = null;
  routeCamLookupToken++;
  routeCamCache.clear();
  routeCamRequested.clear();
  routeCamSlug = route.slug;
  setRouteCamStatus('Loading Street View');
  setRouteCamMode('loading', 'Finding ground imagery', 'Checking Street View near this point on the route.');
  const loaded = await loadGoogleMapsApi();
  if (!loaded || !window.google?.maps?.StreetViewPanorama) {
    setRouteCamStatus('Street View unavailable');
    setRouteCamMode('no-imagery', 'Street View unavailable', 'Google Maps did not load for this browser session.');
    return;
  }
  routeCamService = new google.maps.StreetViewService();
  if (!routeCamPanorama) {
    routeCamPanorama = new google.maps.StreetViewPanorama(document.getElementById('routeCamMap'), {
      addressControl: false,
      clickToGo: false,
      disableDefaultUI: true,
      enableCloseButton: false,
      fullscreenControl: false,
      imageDateControl: false,
      linksControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      panControl: false,
      scrollwheel: false,
      showRoadLabels: false,
      visible: true,
      zoomControl: false,
      pov: { heading: routeBearing(route, 0, 18), pitch: 1, zoom: 1 },
    });
  }
  routeCamReady = true;
  updateRouteCam(route, Number(document.getElementById('scrubber')?.value || 0), { force: true });
}

function requestRouteCamPanorama(route, idx, key, token) {
  if (!routeCamService || routeCamRequested.has(key)) return;
  routeCamRequested.set(key, true);
  const point = routePointAt(route, routeCamBucket(idx));
  routeCamService.getPanorama(
    {
      location: { lat: point.lat, lng: point.lng },
      radius: 90,
      preference: google.maps.StreetViewPreference.NEAREST,
      source: google.maps.StreetViewSource.OUTDOOR,
    },
    (data, status) => {
      if (token !== routeCamLookupToken || routeCamSlug !== route.slug) return;
      if (status === google.maps.StreetViewStatus.OK && data?.location?.pano) {
        routeCamCache.set(key, { status: 'ok', pano: data.location.pano });
      } else {
        routeCamCache.set(key, { status: 'missing' });
      }
      updateRouteCam(route, Number(document.getElementById('scrubber')?.value || 0), { force: true });
    }
  );
}

function nearestCachedPanorama(route, idx) {
  const bucket = routeCamBucket(idx);
  const offsets = [0, -12, 12, -24, 24, -36, 36];
  for (const offset of offsets) {
    const key = `${route.slug}:${Math.max(0, bucket + offset)}`;
    const cached = routeCamCache.get(key);
    if (cached?.status === 'ok') return cached;
  }
  return null;
}

function updateRouteCam(route, idx, options = {}) {
  if (routeCamSlug !== route.slug || !routeCamReady || !routeCamPanorama) return;
  const p = routePointAt(route, idx);
  const key = routeCamCacheKey(route, idx);
  const cached = routeCamCache.get(key);
  if (!cached) {
    requestRouteCamPanorama(route, idx, key, routeCamLookupToken);
    const nearby = nearestCachedPanorama(route, idx);
    if (!nearby) {
      setRouteCamMode('loading', 'Finding ground imagery', 'Checking Street View near this point on the route.');
      setRouteCamStatus(`${(p.d / 1000).toFixed(1)} km · scanning`);
      return;
    }
  }
  const pano = cached?.status === 'ok' ? cached : nearestCachedPanorama(route, idx);
  if (!pano) {
    setRouteCamMode('no-imagery', 'No ground imagery here', 'Street View coverage is not available near this segment.');
    setRouteCamStatus(`${(p.d / 1000).toFixed(1)} km · no imagery`);
    return;
  }
  setRouteCamMode('ready');
  const targetBearing = routeBearing(route, idx, 22);
  routeCamBearing = smoothBearing(routeCamBearing, targetBearing, routePlaying ? 0.2 : 0.34);
  if (options.force || routeCamPanorama.getPano() !== pano.pano) {
    routeCamPanorama.setPano(pano.pano);
  }
  routeCamPanorama.setPov({
    heading: routeCamBearing,
    pitch: routePlaying ? 1.5 : 0,
    zoom: 1.05,
  });
  setRouteCamStatus(`${(p.d / 1000).toFixed(1)} km · Street View`);
}

function routeBearing(route, idx, lookahead = 8) {
  const pts = route.route;
  const a = routePointAt(route, Math.max(0, Math.min(idx, pts.length - 2)));
  const b = routePointAt(route, Math.max(1, Math.min(idx + lookahead, pts.length - 1)));
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function smoothBearing(current, target, amount = 0.12) {
  if (current === null || current === undefined) return target;
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return (current + delta * amount + 360) % 360;
}

function updateLockedRouteCamera(route, idx) {
  if (!routeViewLocked || !routeLockCameraReady || !map || mapSlug !== route.slug) return;
  const p = routePointAt(route, idx);
  const targetBearing = routeBearing(route, idx, routePlaying ? 16 : 8);
  if (routePlaying) {
    routeCameraBearing = smoothBearing(routeCameraBearing, targetBearing, 0.16);
    map.jumpTo({
      center: [p.lng, p.lat],
      zoom: Math.max(map.getZoom(), 13.2),
      pitch: 62,
      bearing: routeCameraBearing,
    });
    return;
  }
  routeCameraBearing = targetBearing;
  map.easeTo({
    center: [p.lng, p.lat],
    zoom: Math.max(map.getZoom(), 13.2),
    pitch: 62,
    bearing: targetBearing,
    duration: 420,
    easing: t => 1 - Math.pow(1 - t, 3),
    essential: true,
  });
}

function syncRouteLockButton() {
  const btn = document.getElementById('routeLockBtn');
  if (!btn) return;
  btn.classList.toggle('active', routeViewLocked);
  btn.textContent = routeViewLocked ? 'FOLLOWING' : 'FREE VIEW';
  btn.title = routeViewLocked
    ? 'Camera follows the active route point'
    : 'Camera is free to pan, zoom, and rotate';
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

function syncRoutePlayButton() {
  const play = document.getElementById('routePlayBtn');
  const speed = document.getElementById('routeSpeedBtn');
  const detail = document.getElementById('detail');
  if (play) {
    play.classList.toggle('playing', routePlaying);
    play.textContent = routePlaying ? 'PAUSE' : 'PLAY';
  }
  if (speed) speed.textContent = `${routePlaySpeed}X`;
  if (detail) {
    detail.classList.toggle('cinema-playing', routePlaying && routeCinemaEnabled && routeCinemaMode === 'flyover');
  }
}

function stopRoutePlayback() {
  if (routePlayTimer) cancelAnimationFrame(routePlayTimer);
  routePlayTimer = null;
  routePlaybackLastAt = 0;
  routePlaying = false;
  syncRoutePlayButton();
}

function startRoutePlayback() {
  if (activeRouteIdx === -1) return;
  const r = ROUTES[activeRouteIdx];
  const scrubber = document.getElementById('scrubber');
  routePlaying = true;
  routeViewLocked = true;
  routeLockCameraReady = true;
  routePlaybackCursor = Number(scrubber.value || 0);
  routePlaybackLastAt = 0;
  routeCameraBearing = null;
  syncRouteLockButton();
  syncRoutePlayButton();
  if (routePlayTimer) cancelAnimationFrame(routePlayTimer);
  const tick = now => {
    if (!routePlaying) return;
    if (!routePlaybackLastAt) routePlaybackLastAt = now;
    const dt = Math.min(0.05, Math.max(0, (now - routePlaybackLastAt) / 1000));
    routePlaybackLastAt = now;
    const current = Math.max(0, Math.min(routePlaybackCursor, r.route.length - 1));
    const indicesPerSecond = routePlaybackStep(r, Math.floor(current)) / 0.18;
    let next = current + indicesPerSecond * dt;
    if (next >= r.route.length - 1) {
      next = r.route.length - 1;
      scrubber.value = next;
      setRouteIndex(next);
      stopRoutePlayback();
      return;
    }
    routePlaybackCursor = next;
    scrubber.value = next;
    setRouteIndex(next);
    routePlayTimer = requestAnimationFrame(tick);
  };
  routePlayTimer = requestAnimationFrame(tick);
}

function routePlaybackStep(route, idx) {
  if (!(routeCinemaEnabled && routeCinemaMode === 'flyover')) return routePlaySpeed;
  const pts = route.route || [];
  const current = pts[Math.max(0, Math.min(idx, pts.length - 1))];
  const ahead = pts[Math.max(0, Math.min(idx + 8, pts.length - 1))];
  if (!current || !ahead) return routePlaySpeed;
  const grade = Math.abs((ahead.elev || 0) - (current.elev || 0)) / Math.max((ahead.d || 1) - (current.d || 0), 1);
  const progress = idx / Math.max(pts.length - 1, 1);
  const highIdx = pts.reduce((best, p, i) => (Number(p.elev) || 0) > (Number(pts[best].elev) || 0) ? i : best, 0);
  const highProximity = Math.abs(idx - highIdx) / Math.max(pts.length, 1);
  const beatProximity = Math.min(
    Math.abs(progress - 0),
    Math.abs(progress - 0.5),
    Math.abs(progress - 1),
    highProximity
  );
  let multiplier = grade > 0.08 ? 0.58 : grade > 0.035 ? 0.76 : 1.22;
  if (beatProximity < 0.035) multiplier *= 0.52;
  if (progress < 0.04 || progress > 0.96) multiplier *= 0.62;
  return Math.max(1, Math.round((routePlaySpeed / 4) * multiplier));
}

function routeMomentSpecs(route) {
  const pts = route.route || [];
  if (!pts.length) return [];
  const total = pts.length - 1;
  const highIdx = pts.reduce((best, p, i) => (Number(p.elev) || 0) > (Number(pts[best]?.elev) || 0) ? i : best, 0);
  let climbIdx = Math.floor(total * 0.35);
  let bestGain = -Infinity;
  for (let i = 0; i < pts.length - 8; i++) {
    const gain = (Number(pts[i + 8].elev) || 0) - (Number(pts[i].elev) || 0);
    if (gain > bestGain) {
      bestGain = gain;
      climbIdx = i + 4;
    }
  }
  const specs = [
    { key: 'start', idx: Math.floor(total * 0.04), title: 'Roll out', meta: 'start' },
    { key: 'climb', idx: climbIdx, title: 'The lift', meta: 'biggest climb' },
    { key: 'half', idx: Math.floor(total * 0.5), title: 'Halfway pulse', meta: 'midpoint' },
    { key: 'high', idx: highIdx, title: 'High point', meta: `${Math.round(Number(pts[highIdx]?.elev) || 0).toLocaleString()} m` },
    { key: 'finish', idx: total, title: 'Bring it home', meta: 'finish' },
  ];
  const seen = new Set();
  return specs
    .map(spec => ({ ...spec, idx: Math.max(0, Math.min(total, spec.idx)) }))
    .filter(spec => {
      const bucket = Math.round((spec.idx / Math.max(total, 1)) * 20);
      if (seen.has(bucket) && spec.key !== 'finish') return false;
      seen.add(bucket);
      return true;
    });
}

function setupCinemaMomentLabels(route) {
  const layer = document.getElementById('cinemaMomentLayer');
  cinemaMoments = [];
  if (!layer) return;
  layer.innerHTML = '';
  if (routeCinemaMode !== 'flyover') return;
  cinemaMoments = routeMomentSpecs(route).map(spec => {
    const el = document.createElement('div');
    el.className = 'cinema-moment';
    el.innerHTML = `<b>${escapeHtml(spec.title)}</b><span>${escapeHtml(spec.meta)}</span>`;
    layer.appendChild(el);
    return { ...spec, el };
  });
}

function photoRouteIndex(route, photo) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.route.length; i++) {
    const p = route.route[i];
    const d = (p.lat - photo.lat) ** 2 + (p.lng - photo.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function setupCinemaMemoryStations(route) {
  cinemaMemories = [];
}

function toggleRoutePlayback() {
  if (routePlaying) stopRoutePlayback();
  else startRoutePlayback();
}

function cycleRouteSpeed() {
  const idx = ROUTE_SPEEDS.indexOf(routePlaySpeed);
  routePlaySpeed = ROUTE_SPEEDS[(idx + 1) % ROUTE_SPEEDS.length];
  syncRoutePlayButton();
}

function syncRouteCinemaButton() {
  const btn = document.getElementById('routeCinemaBtn');
  const earthBtn = document.getElementById('routeEarthBtn');
  const modeBtn = document.getElementById('routeModeBtn');
  const layer = document.getElementById('cinemaLayer');
  const panelMap = document.querySelector('.panel-map');
  if (btn) {
    btn.classList.toggle('active', routeCinemaEnabled);
    btn.textContent = routeCinemaEnabled && routeCinemaMode === 'flyover' ? 'EXIT ATLAS' : 'ENTER ROUTE';
  }
  if (modeBtn) {
    modeBtn.classList.toggle('visible', routeCinemaEnabled && SHOW_DEV_CINEMA_MODES);
    modeBtn.textContent = routeCinemaMode === 'flyover' ? 'ATLAS' : (routeCinemaMode === 'quest' ? 'QUEST' : routeCinemaMode.toUpperCase());
  }
  if (earthBtn) {
    earthBtn.classList.toggle('active', earthModeEnabled);
    earthBtn.textContent = earthModeEnabled ? 'ATLAS' : 'EARTH';
    earthBtn.title = earthModeEnabled ? 'Return to standard atlas mode' : 'Open Earth Replay for this route';
  }
  if (layer) {
    layer.classList.toggle('active', routeCinemaEnabled && !earthModeEnabled);
    layer.dataset.mode = routeCinemaMode;
  }
  if (panelMap) {
    panelMap.classList.toggle('atlas-active', !earthModeEnabled && routeCinemaEnabled && routeCinemaMode === 'flyover');
    panelMap.classList.toggle('earth-active', earthModeEnabled);
  }
  if (!earthModeEnabled) setEarthMode('inactive');
  else if (earthReady && !['partial', 'settling'].includes(earthState)) setEarthMode('ready');
  else if (!earthReady && earthState !== 'unavailable') setEarthMode('loading');
  const label = document.getElementById('cinemaLabel');
  if (label) {
    label.textContent = {
      artifact: 'Artifact mode · real route sculpture',
      flyover: 'Memory Atlas · real map, remembered places',
      quest: 'Quest world · real checkpoints, playful atmosphere',
    }[routeCinemaMode];
  }
}

function toggleRouteCinema() {
  routeCinemaEnabled = !routeCinemaEnabled;
  syncRouteCinemaButton();
  if (routeCinemaEnabled && activeRouteIdx !== -1) {
    const idx = Number(document.getElementById('scrubber').value || 0);
    startCinemaLoop();
    updateRouteCinema(ROUTES[activeRouteIdx], idx);
    if (routeCinemaMode === 'flyover') startRoutePlayback();
  } else {
    stopCinemaLoop();
  }
}

function cycleRouteCinemaMode() {
  if (!SHOW_DEV_CINEMA_MODES) return;
  const idx = ROUTE_CINEMA_MODES.indexOf(routeCinemaMode);
  routeCinemaMode = ROUTE_CINEMA_MODES[(idx + 1) % ROUTE_CINEMA_MODES.length];
  syncRouteCinemaButton();
  if (activeRouteIdx !== -1) {
    const route = ROUTES[activeRouteIdx];
    const scrubber = document.getElementById('scrubber');
    initRouteCinema(route);
    updateRouteCinema(route, Number(scrubber?.value || 0));
    if (routeCinemaMode === 'flyover') startRoutePlayback();
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

function routeCinemaPointsFor(route) {
  const pts = route.route || [];
  if (!pts.length) return [];
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  const elevs = pts.map(p => Number(p.elev) || 0);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const elevMin = Math.min(...elevs), elevMax = Math.max(...elevs);
  const latSpan = latMax - latMin || 1e-6;
  const lngSpan = (lngMax - lngMin || 1e-6) * Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  const elevSpan = Math.max(elevMax - elevMin, 1);
  const scale = 8.4 / Math.max(latSpan, lngSpan);
  return pts.map(p => {
    const x = ((p.lng - (lngMin + lngMax) / 2) * Math.cos((p.lat * Math.PI) / 180)) * scale;
    const z = -((p.lat - (latMin + latMax) / 2) * scale);
    const y = ((Number(p.elev) || 0) - elevMin) / elevSpan * 1.65 - 0.55;
    return new THREE.Vector3(x, y, z);
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

function cinemaRouteGeometry(points, radius = 0.035) {
  const safePoints = points.length > 1 ? points : [new THREE.Vector3(), new THREE.Vector3(0.01, 0, 0)];
  const curve = new THREE.CatmullRomCurve3(safePoints);
  return new THREE.TubeGeometry(curve, Math.max(12, safePoints.length * 2), radius, 8, false);
}

function initRouteCinema(route) {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('cinemaCanvas');
  if (!canvas) return;
  if (cinemaRenderer) {
    stopCinemaLoop();
    disposeArtifactObject(cinemaScene);
    cinemaRenderer.dispose();
    cinemaRenderer = null;
  }
  cinemaSlug = route.slug;
  cinemaPoints = routeCinemaPointsFor(route);
  const isAtlas = routeCinemaMode === 'flyover';
  cinemaScene = new THREE.Scene();
  cinemaScene.fog = new THREE.Fog(
    routeCinemaMode === 'quest' ? 0x061211 : 0x030709,
    isAtlas ? 42 : 8,
    routeCinemaMode === 'artifact' ? 18 : 20
  );
  cinemaCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 60);
  cinemaCamera.position.set(0, 5.2, 8.8);
  cinemaCamera.lookAt(0, 0, 0);
  cinemaCameraTarget = cinemaCamera.position.clone();
  cinemaLookTarget = new THREE.Vector3(0, 0, 0);
  cinemaLookCurrent = cinemaLookTarget.clone();
  cinemaRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  cinemaRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  cinemaRenderer.setClearColor(0x000000, 0);

  const ambient = new THREE.AmbientLight(isAtlas ? 0xf1dfb4 : (routeCinemaMode === 'quest' ? 0xb8f0d8 : 0x9fd8c9), 1.18);
  const key = new THREE.DirectionalLight(isAtlas ? 0xfff6dc : 0xffffff, isAtlas ? 1.1 : 1.55);
  key.position.set(3, 7, 5);
  const rim = new THREE.DirectionalLight(isAtlas ? 0xe8d49a : 0x00f19f, routeCinemaMode === 'artifact' ? 0.55 : 0.9);
  rim.position.set(-5, 3, -4);
  cinemaScene.add(ambient, key, rim);

  cinemaSurface = null;
  if (!isAtlas) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13, routeCinemaMode === 'artifact' ? 18 : 28, routeCinemaMode === 'artifact' ? 18 : 28),
      new THREE.MeshStandardMaterial({
        color: routeCinemaMode === 'quest' ? 0x0c211c : 0x071115,
        roughness: 0.82,
        metalness: 0.05,
        transparent: true,
        opacity: 0.76,
        wireframe: true
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.74;
    cinemaSurface = floor;
    cinemaScene.add(floor);
  }

  if (!isAtlas && routeCinemaMode !== 'artifact') {
    const grid = new THREE.GridHelper(13, routeCinemaMode === 'quest' ? 18 : 13, routeCinemaMode === 'flyover' ? 0xe8d49a : 0x00f19f, 0x2d4d4b);
    grid.position.y = -0.735;
    grid.material.transparent = true;
    grid.material.opacity = routeCinemaMode === 'quest' ? 0.18 : 0.1;
    cinemaScene.add(grid);
  }

  cinemaFullLine = new THREE.Mesh(
    cinemaRouteGeometry(cinemaPoints, isAtlas ? 0.006 : (routeCinemaMode === 'quest' ? 0.046 : 0.038)),
    new THREE.MeshBasicMaterial({ color: isAtlas ? 0xf0dfae : 0x00f19f, transparent: true, opacity: isAtlas ? 0.0 : (routeCinemaMode === 'artifact' ? 0.96 : 0.78) })
  );
  cinemaScene.add(cinemaFullLine);
  cinemaProgressLine = new THREE.Mesh(
    cinemaRouteGeometry(cinemaPoints.slice(0, 2), isAtlas ? 0.006 : (routeCinemaMode === 'quest' ? 0.065 : 0.055)),
    new THREE.MeshBasicMaterial({ color: isAtlas ? 0xe8d49a : (routeCinemaMode === 'quest' ? 0xffd36a : 0x00f19f), transparent: true, opacity: isAtlas ? 0.0 : 0.98 })
  );
  cinemaScene.add(cinemaProgressLine);
  cinemaMarker = new THREE.Mesh(
    new THREE.SphereGeometry(isAtlas ? 0.1 : (routeCinemaMode === 'quest' ? 0.22 : 0.18), 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xfff7df, emissive: isAtlas ? 0xe8d49a : (routeCinemaMode === 'quest' ? 0xffb000 : 0x00f19f), emissiveIntensity: isAtlas ? 0.1 : 0.9, transparent: true, opacity: isAtlas ? 0.0 : 1 })
  );
  cinemaScene.add(cinemaMarker);
  const markerHalo = new THREE.Mesh(
    new THREE.SphereGeometry(isAtlas ? 0.18 : (routeCinemaMode === 'quest' ? 0.42 : 0.32), 24, 16),
    new THREE.MeshBasicMaterial({ color: isAtlas ? 0xe8d49a : (routeCinemaMode === 'quest' ? 0xffd36a : 0x00f19f), transparent: true, opacity: isAtlas ? 0.0 : 0.14 })
  );
  markerHalo.userData.markerHalo = true;
  cinemaMarker.add(markerHalo);
  cinemaDecor = [];
  setupCinemaMomentLabels(route);
  setupCinemaMemoryStations(route);
  buildCinemaDecor(route);
  resizeRouteCinema();
  updateRouteCinema(route, 0);
  startCinemaLoop();
}

function buildCinemaDecor(route) {
  if (!cinemaScene || !cinemaPoints.length) return;
  const add = obj => {
    cinemaDecor.push(obj);
    cinemaScene.add(obj);
    return obj;
  };
  const total = Math.max((route.route?.length || cinemaPoints.length) - 1, 1);
  if (routeCinemaMode === 'artifact') {
    const count = Math.min(24, Math.max(10, Math.floor(cinemaPoints.length / 6)));
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / Math.max(count - 1, 1)) * total);
      const p = cinemaPoints[idx];
      const height = Math.max(0.08, p.y + 0.72);
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, height, 8),
        new THREE.MeshBasicMaterial({ color: 0x00f19f, transparent: true, opacity: 0.18 })
      );
      pin.position.set(p.x, -0.74 + height / 2, p.z);
      add(pin);
    }
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.05, 7.2),
      new THREE.MeshBasicMaterial({ color: 0x00f19f, transparent: true, opacity: 0.045 })
    );
    plinth.position.y = -0.78;
    add(plinth);
    return;
  }

  if (routeCinemaMode === 'flyover') {
    return;
  }

  const milestoneFractions = [0.18, 0.38, 0.62, 0.82, 1];
  milestoneFractions.forEach((fraction, i) => {
    const idx = Math.min(total, Math.floor(fraction * total));
    const p = cinemaPoints[idx];
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(i === milestoneFractions.length - 1 ? 0.34 : 0.24, 0.018, 10, 34),
      new THREE.MeshStandardMaterial({
        color: i === milestoneFractions.length - 1 ? 0xffd36a : 0x00f19f,
        emissive: i === milestoneFractions.length - 1 ? 0x7a4f00 : 0x003d2b,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.68
      })
    );
    gate.position.set(p.x, p.y + 0.12, p.z);
    gate.rotation.x = Math.PI / 2;
    gate.userData.routeIdx = idx;
    add(gate);
  });

  for (let i = 0; i < 44; i++) {
    const base = cinemaPoints[Math.floor(((i * 17) % 43) / 42 * total)] || cinemaPoints[0];
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 + (i % 3) * 0.006, 8, 8),
      new THREE.MeshBasicMaterial({ color: i % 5 === 0 ? 0xffd36a : 0x00f19f, transparent: true, opacity: 0.22 })
    );
    spark.position.set(
      base.x + Math.sin(i * 2.1) * 0.46,
      base.y + 0.18 + ((i % 7) / 7) * 0.7,
      base.z + Math.cos(i * 1.7) * 0.46
    );
    add(spark);
  }
}

function resizeRouteCinema() {
  if (!cinemaRenderer || !cinemaCamera) return;
  const canvas = cinemaRenderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  cinemaRenderer.setSize(w, h, false);
  cinemaCamera.aspect = w / h;
  cinemaCamera.updateProjectionMatrix();
  cinemaRenderer.render(cinemaScene, cinemaCamera);
}

function startCinemaLoop() {
  stopCinemaLoop();
  cinemaStartedAt = performance.now();
  const tick = now => {
    if (!cinemaRenderer || !cinemaScene || !cinemaCamera) return;
    const elapsed = (now - cinemaStartedAt) / 1000;
    if (cinemaCameraTarget && cinemaLookTarget && cinemaLookCurrent) {
      const ease = routeCinemaMode === 'flyover' ? 0.075 : 0.18;
      cinemaCamera.position.lerp(cinemaCameraTarget, ease);
      cinemaLookCurrent.lerp(cinemaLookTarget, ease * 1.25);
      cinemaCamera.lookAt(cinemaLookCurrent);
      const scrubber = document.getElementById('scrubber');
      if (routeCinemaMode === 'flyover' && scrubber) {
        updateCinemaMomentLabels(Number(scrubber.value || 0));
      }
    }
    cinemaDecor.forEach(obj => {
      if (obj.userData?.flyoverSpin) obj.rotation.z += obj.userData.flyoverSpin;
      if (obj.userData?.flyoverBeat) {
        const pulse = 1 + Math.sin(elapsed * 2.8 + obj.userData.routeIdx * 0.03) * 0.045;
        obj.scale.setScalar(pulse);
      }
      if (obj.userData?.flyoverMote) {
        obj.position.y += Math.sin(elapsed * 1.3 + obj.userData.phase) * 0.0009;
        obj.material.opacity = 0.1 + Math.max(0, Math.sin(elapsed * 0.9 + obj.userData.phase)) * 0.14;
      }
    });
    if (cinemaMarker) {
      const markerHalo = cinemaMarker.children?.find(child => child.userData?.markerHalo);
      if (markerHalo) {
        markerHalo.scale.setScalar(1 + Math.sin(elapsed * 4.2) * 0.08);
      }
    }
    cinemaRenderer.render(cinemaScene, cinemaCamera);
    cinemaFrame = requestAnimationFrame(tick);
  };
  cinemaFrame = requestAnimationFrame(tick);
}

function stopCinemaLoop() {
  if (cinemaFrame) cancelAnimationFrame(cinemaFrame);
  cinemaFrame = null;
}

function updateCinemaMomentLabels(safeIdx) {
  if (routeCinemaMode !== 'flyover') {
    cinemaMoments.forEach(moment => moment.el?.classList.remove('active'));
    cinemaMemories.forEach(memory => memory.el?.classList.remove('active'));
    return;
  }
  const activeRoute = ROUTES[activeRouteIdx];
  const layer = document.getElementById('cinemaMomentLayer');
  const rect = (layer || cinemaRenderer?.domElement)?.getBoundingClientRect();
  if (!rect || !activeRoute) return;
  const total = Math.max((activeRoute.route?.length || cinemaPoints.length) - 1, 1);
  const momentProximity = Math.max(8, Math.floor(total * 0.045));
  const memoryProximity = Math.max(18, Math.floor(total * 0.12));
  const useMapProjection = map && mapSlug === activeRoute.slug && typeof map.project === 'function';
  const projectedPoint = item => {
    if (useMapProjection) {
      const geo = activeRoute.route[Math.max(0, Math.min(item.idx, activeRoute.route.length - 1))];
      if (!geo) return null;
      const projected = map.project([geo.lng, geo.lat]);
      return { x: projected.x, y: projected.y, visible: true };
    }
    if (!cinemaRenderer || !cinemaCamera || !cinemaPoints[item.idx]) return null;
    const projected = cinemaPoints[item.idx].clone().project(cinemaCamera);
    return {
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
      visible: projected.z < 1
    };
  };
  const placeElement = (item, offset = 0, minTop = 84, activationWindow = momentProximity) => {
    if (!item.el) return false;
    const projected = projectedPoint(item);
    const visible = Boolean(projected) && Math.abs(safeIdx - item.idx) <= activationWindow && projected.visible;
    item.el.classList.toggle('active', visible);
    if (visible) {
      item.el.style.left = `${Math.max(86, Math.min(rect.width - 86, projected.x + offset))}px`;
      item.el.style.top = `${Math.max(minTop, Math.min(rect.height - 132, projected.y))}px`;
    }
    return visible;
  };
  cinemaMoments.forEach(moment => {
    placeElement(moment);
  });
  const nearbyMemories = cinemaMemories
    .map((memory, i) => ({ memory, i, distance: Math.abs(safeIdx - memory.idx) }))
    .filter(item => item.distance <= memoryProximity)
    .sort((a, b) => a.distance - b.distance);
  const activeMemory = nearbyMemories[0]?.memory;
  cinemaMemories.forEach((memory, i) => {
    if (memory !== activeMemory) {
      memory.el?.classList.remove('active');
      return;
    }
    placeElement(memory, i % 2 ? 46 : -46, 176, memoryProximity);
  });
}

function updateRouteCinema(route, idx) {
  if (!cinemaRenderer || cinemaSlug !== route.slug || !cinemaPoints.length) return;
  const safeIdx = Math.max(0, Math.min(idx, cinemaPoints.length - 1));
  cinemaProgressLine.geometry.dispose();
  cinemaProgressLine.geometry = cinemaRouteGeometry(
    cinemaPoints.slice(0, Math.max(2, safeIdx + 1)),
    routeCinemaMode === 'quest' ? 0.065 : 0.055
  );
  const p = cinemaPoints[safeIdx];
  cinemaMarker.position.copy(p);
  const forward = cinemaPoints[Math.min(safeIdx + 8, cinemaPoints.length - 1)] || p;
  const progress = safeIdx / Math.max(cinemaPoints.length - 1, 1);
  if (routeCinemaMode === 'artifact') {
    cinemaCameraTarget.set(0, 5.4, 8.9);
    cinemaLookTarget.set(0, 0.05, 0);
    cinemaScene.rotation.y = -0.28 + progress * 0.56;
  } else if (routeCinemaMode === 'flyover') {
    const prev = cinemaPoints[Math.max(safeIdx - 14, 0)] || p;
    const far = cinemaPoints[Math.min(safeIdx + 22, cinemaPoints.length - 1)] || forward;
    let direction = far.clone().sub(prev);
    if (direction.lengthSq() < 0.0001) direction = new THREE.Vector3(0, 0, -1);
    direction.normalize();
    let side = new THREE.Vector3(-direction.z, 0, direction.x);
    if (side.lengthSq() < 0.0001) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const climb = Math.max(-0.6, Math.min(0.9, forward.y - p.y));
    const opening = progress < 0.09 ? 1 - progress / 0.09 : 0;
    const closing = progress > 0.91 ? (progress - 0.91) / 0.09 : 0;
    const reveal = Math.max(opening, closing);
    const bend = Math.min(1, Math.abs((forward.x - p.x) * (p.z - prev.z) - (forward.z - p.z) * (p.x - prev.x)) * 0.85);
    const chaseDistance = 2.9 + reveal * 2.4 + bend * 0.55;
    const height = 2.0 + Math.max(0, climb) * 1.5 + reveal * 1.25 + bend * 0.45;
    const camPos = p.clone()
      .add(direction.clone().multiplyScalar(-chaseDistance))
      .add(side.multiplyScalar(Math.sin(progress * Math.PI * 2) * (0.38 + bend * 0.22)))
      .add(new THREE.Vector3(0, height, 0));
    const look = p.clone().lerp(far, opening ? 0.5 : 0.72)
      .add(new THREE.Vector3(0, 0.18 + Math.max(0, climb) * 0.3 + reveal * 0.16, 0));
    cinemaCameraTarget.copy(camPos);
    cinemaLookTarget.copy(look);
    cinemaScene.rotation.y = -0.05 + progress * 0.1;
    cinemaDecor.forEach(obj => {
      if (obj.userData?.flyoverBeat && obj.material) {
        const lit = obj.userData.routeIdx <= safeIdx;
        obj.material.opacity = lit ? 0.7 : 0.24;
      }
    });
  } else {
    const camTarget = p.clone().lerp(forward, 0.25);
    cinemaCameraTarget.set(p.x - 2.8, p.y + 3.5, p.z + 5.4);
    cinemaLookTarget.set(camTarget.x, camTarget.y + 0.08, camTarget.z);
    cinemaScene.rotation.y = -0.16 + progress * 0.28;
    cinemaDecor.forEach(obj => {
      if (obj.userData?.routeIdx !== undefined && obj.material) {
        const lit = obj.userData.routeIdx <= safeIdx;
        obj.material.opacity = lit ? 0.92 : 0.34;
        obj.material.emissiveIntensity = lit ? 0.82 : 0.18;
      }
    });
  }
  cinemaMarker.scale.setScalar(routeCinemaMode === 'quest' ? 1 + Math.sin(progress * Math.PI * 10) * 0.12 : 1);
  updateCinemaMomentLabels(safeIdx);
  cinemaRenderer.render(cinemaScene, cinemaCamera);
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
  const r = ROUTES[activeRouteIdx];
  const idx = Math.max(0, Math.min(Number(i) || 0, r.route.length - 1));
  const p = routePointAt(r, idx);
  const discreteIdx = Math.max(0, Math.min(Math.round(idx), r.route.length - 1));
  document.getElementById('scrubberPos').textContent =
    (p.d / 1000).toFixed(2) + ' / ' + (r.route[r.route.length-1].d / 1000).toFixed(2) + ' km';
  document.getElementById('kmDone').textContent = (p.d / 1000).toFixed(1) + ' km';
  document.getElementById('elevHere').textContent = Math.round(p.elev) + ' m';
  document.getElementById('poiTitle').textContent =
    idx < 10 ? 'Route start' : (idx > r.route.length - 10 ? 'Route end' : 'Along route');
  updateMainMapProgress(r, idx);
  updateRouteCam(r, idx);
  updateElevationArtifact(r, discreteIdx);
  updateRouteCinema(r, discreteIdx);
  updateEarthReplay(r, idx);
  updateLockedRouteCamera(r, idx);
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
  e.preventDefault();
});
window.addEventListener('dragleave', e => {
  e.preventDefault();
});
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', async e => {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('dropOverlay').classList.remove('active');
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
  earthScrubUntil = performance.now() + 750;
  routePlaybackCursor = Number(e.target.value || 0);
  setRouteIndex(routePlaybackCursor);
  if (earthModeEnabled) scheduleEarthBlankCheck(2200);
});

window.addEventListener('resize', () => {
  resizeGlobe();
  resizeElevationArtifact();
  resizeRouteCinema();
  if (earthViewer && !earthViewer.isDestroyed?.()) earthViewer.resize();
  if (map) map.resize();
  if (routeCamPanorama) google.maps.event.trigger(routeCamPanorama, 'resize');
});
window.addEventListener('popstate', handleCurrentUrl);
window.addEventListener('hashchange', handleCurrentUrl);
renderAvatarPicker();
initFilterControls();
if (location.hash) handleCurrentUrl();
else if (GLOBE_LAB_MODE) showGlobe({ updateUrl: false });
else renderGallery();
</script>
</body></html>
'''

html_out = (template_html
            .replace('__ROUTES_JSON__', data_json)
            .replace('__CURATION_JSON__', curation_json)
            .replace('__GOOGLE_MAPS_API_KEY__', GOOGLE_MAPS_API_KEY))
(QUESTS / 'index.html').write_text(html_out)

print(f'\n✓ Built: {QUESTS}/index.html  ({len(routes_data)} quests)')
print(f'✓ Cards: {CARDS}/ ({len(routes_data)} PNGs)')
print(f'\nOpen: open {QUESTS}/index.html')
