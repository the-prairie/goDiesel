"""Build the React application's generated route data from curated sources."""
import json, re, shutil, tempfile
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from quest_meta import (
    build_quest_meta,
    build_replay_metadata,
    build_route_curation,
    elevation_gain_m,
    infer_route_region,
    route_manifest_record,
)
from route_provenance import build_route_provenance, load_source_route_points
from route_annotations import build_route_annotations
from route_imports import find_strava_activity_file, route_metadata
from route_timezones import route_time_zone

# ── Paths ──
DD = Path('/Users/laurenzary/Desktop/DieselDiaries')
QUESTS = Path(__file__).resolve().parent
REACT_DATA = QUESTS / 'app' / 'src' / 'data'
REACT_GENERATED_DATA = REACT_DATA / 'generated'
REACT_ROUTE_DETAILS = QUESTS / 'app' / 'public' / 'data' / 'routes'
REACT_GENERATED_FILES = (
    REACT_GENERATED_DATA / 'routes.manifest.json',
    REACT_GENERATED_DATA / 'route-stats.json',
)
ROUTE_GENERATION_BACKUP = REACT_ROUTE_DETAILS.parent / '.route-generation-backup'
BEST_IN_EARTH_IDS = {
    '13935098460', '14349820520', '17636880071', '17654151284',
    '13358070690', '9959792315', '9934715694',
}

def recover_interrupted_route_publication():
    if not ROUTE_GENERATION_BACKUP.exists():
        return
    ready_marker = ROUTE_GENERATION_BACKUP / 'ready'
    if not ready_marker.exists():
        shutil.rmtree(ROUTE_GENERATION_BACKUP)
        return

    backup_details = ROUTE_GENERATION_BACKUP / 'routes'
    if REACT_ROUTE_DETAILS.exists():
        shutil.rmtree(REACT_ROUTE_DETAILS)
    if backup_details.exists():
        shutil.copytree(backup_details, REACT_ROUTE_DETAILS)

    metadata_backup = ROUTE_GENERATION_BACKUP / 'metadata'
    for index, path in enumerate(REACT_GENERATED_FILES):
        backup_file = metadata_backup / f'{index}.bin'
        missing_marker = metadata_backup / f'{index}.missing'
        if backup_file.exists():
            temp_path = path.with_name(f'.{path.name}.recovery')
            shutil.copyfile(backup_file, temp_path)
            temp_path.replace(path)
        elif missing_marker.exists():
            path.unlink(missing_ok=True)
    shutil.rmtree(ROUTE_GENERATION_BACKUP)


recover_interrupted_route_publication()

# ── Load quests.json ──
config = json.loads((QUESTS / 'quests.json').read_text())
# Schema: {routes: [{activity_id, status, region, optional curation object}]}.
# Only build approved public routes.
all_routes = config.get('routes', config.get('quests', []))
quest_specs = [
    r for r in all_routes
    if r.get('status', 'approved') == 'approved'
    and r.get('visibility', 'public') != 'hidden'
]
pending_n = sum(1 for r in all_routes if r.get('status') == 'pending')
rejected_n = sum(1 for r in all_routes if r.get('status') == 'rejected')
print(f'[1/2] Curation: {len(quest_specs)} approved · {pending_n} pending · {rejected_n} rejected')

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

# ── Build each quest ──
print('[2/2] Building routes…')
routes_data = []
for spec in quest_specs:
    aid = spec['activity_id']
    act = acts_by_id.get(aid)
    meta = route_metadata(spec, QUESTS, act)
    if meta is None:
        print(f'    ✗ {aid}: not found in activities.csv'); continue
    source_kind = meta.source_kind
    name, date, typ, desc = meta.name, meta.date, meta.activity_type, meta.description
    fp = meta.source_path or find_strava_activity_file(aid, DD)
    if fp is None:
        print(f'    ✗ {aid}: no .gpx/.fit file'); continue
    route_provenance = build_route_provenance(load_source_route_points(fp))
    lifecycle = spec.get('lifecycle', 'completed')
    if lifecycle not in ('completed', 'planned', 'discovered'):
        raise ValueError(f'Invalid lifecycle for {aid}: {lifecycle!r}')
    route_js = [dict(point) for point in route_provenance.route]
    if not route_js:
        print(f'    ✗ {aid}: empty polyline'); continue
    distance_km = route_js[-1]['d'] / 1000

    # Auto-detect region if not specified
    region_label = spec.get('region') or infer_route_region(
        route_js[0]['lat'], route_js[0]['lng']
    )
    temporal_provenance = dict(route_provenance.temporal)
    discontinuities = [dict(item) for item in route_provenance.discontinuities]
    # Supplied timestamps on a discovered route are source provenance, not
    # evidence that the owner completed it. Keep them in the durable GPX but do
    # not publish elapsed time or pace as owner experience.
    if lifecycle == 'discovered':
        temporal_provenance = {'status': 'unavailable'}
        route_js = [
            {key: value for key, value in point.items() if key != 'elapsed_s'}
            for point in route_js
        ]
        discontinuities = [
            {key: value for key, value in item.items() if key != 'elapsed_time_s'}
            for item in discontinuities
        ]
    time_zone = route_time_zone(region_label)
    if temporal_provenance.get('status') == 'recorded' and time_zone:
        temporal_provenance['time_zone'] = time_zone

    # Slug from activity_id
    slug = aid

    lats = [p['lat'] for p in route_js]; lngs = [p['lng'] for p in route_js]
    cx = (min(lats) + max(lats)) / 2; cy = (min(lngs) + max(lngs)) / 2
    quest_meta = build_quest_meta(
        activity_type=typ,
        distance_km=round(distance_km, 1),
        elevation_gain=(
            elevation_gain_m(route_js)
            if route_provenance.elevation['status'] == 'recorded'
            else None
        ),
        region_label=region_label,
        activity_name=name,
    )
    for _field, _target in (
        ('theme', 'theme'),
        ('difficulty', 'difficulty'),
        ('completion_rule', 'completion_rule'),
    ):
        if spec.get(_field):
            quest_meta[_target] = str(spec[_field]).strip()

    subtitle = str(spec.get('title') or name).strip()
    quest = {
        'slug': slug,
        'activity_id': aid,
        'source_kind': source_kind,
        'name': region_label,
        'subtitle': subtitle,
        'activity_name': name,
        'region': region_label,
        'date': date,
        'distance_km': round(distance_km, 1),
        'elevation_status': route_provenance.elevation['status'],
        'type': typ,
        'description': desc,
        'route': route_js,
        'provenance': {
            'temporal': temporal_provenance,
            'elevation': route_provenance.elevation,
            'track': route_provenance.track,
            'discontinuities': discontinuities,
        },
        'center_lat': cx, 'center_lng': cy,
        'mid_idx': len(route_js) // 2,
        **quest_meta,
    }
    if spec.get('curation') is not None:
        quest['curation'] = build_route_curation(spec['curation'])
    if spec.get('annotations') is not None:
        quest['annotations'] = build_route_annotations(
            spec['annotations'], route_js[-1]['d']
        )
    if spec.get('replay_mode') is not None:
        quest['replay_mode'] = spec['replay_mode']
    quest['lifecycle'] = lifecycle
    routes_data.append(quest)
    print(f'    ✓ {region_label:28s} {typ:5s} {distance_km:.1f}km')

# Sort routes by date (newest first feels right for a portfolio)
routes_data.sort(key=lambda r: r['date'], reverse=True)

def react_route_record(route):
    aid = str(route.get('activity_id') or route.get('slug') or '')
    point_count = len(route.get('route', []))
    lifecycle = route.get('lifecycle', 'completed')
    return {
        **route,
        'lifecycle': lifecycle,
        'replay': build_replay_metadata(
            aid,
            point_count,
            BEST_IN_EARTH_IDS,
            lifecycle,
            route.get('replay_mode'),
        ),
    }

generated_at = datetime.now(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')
react_manifest_payload = {
    'schema_version': 1,
    'generated_at': generated_at,
    'stats': {
        'approved': len(quest_specs),
        'pending': pending_n,
        'rejected': rejected_n,
        'total': len(all_routes),
    },
    'routes': [route_manifest_record(react_route_record(route)) for route in routes_data],
}
route_stats_payload = {
    'route_count': len(routes_data),
    'completed_km': round(sum(
        route.get('distance_km', 0)
        for route in routes_data
        if route.get('lifecycle', 'completed') == 'completed'
    ), 1),
}

detail_payloads = {}
for route in routes_data:
    record = react_route_record(route)
    slug = str(record['slug'])
    if not re.fullmatch(r'[A-Za-z0-9._-]+', slug):
        raise ValueError(f'Unsafe route slug for generated detail file: {slug!r}')
    detail_payloads[f'{slug}.json'] = json.dumps(record, ensure_ascii=False)

REACT_DATA.mkdir(parents=True, exist_ok=True)
REACT_GENERATED_DATA.mkdir(parents=True, exist_ok=True)
REACT_ROUTE_DETAILS.parent.mkdir(parents=True, exist_ok=True)
generated_files = {
    REACT_GENERATED_DATA / 'routes.manifest.json': json.dumps(
        react_manifest_payload, ensure_ascii=False
    ),
    REACT_GENERATED_DATA / 'route-stats.json': json.dumps(route_stats_payload),
}


def write_text_atomic(path, content):
    temp_path = path.with_name(f'.{path.name}.tmp')
    temp_path.write_text(content, encoding='utf-8')
    temp_path.replace(path)


with tempfile.TemporaryDirectory(
    dir=REACT_ROUTE_DETAILS.parent, prefix='.routes-staging-'
) as staging_directory:
    staging_path = Path(staging_directory)
    for filename, content in detail_payloads.items():
        (staging_path / filename).write_text(content, encoding='utf-8')

    if ROUTE_GENERATION_BACKUP.exists():
        raise RuntimeError('Route generation backup already exists after recovery')
    ROUTE_GENERATION_BACKUP.mkdir()
    backup_details = ROUTE_GENERATION_BACKUP / 'routes'
    if REACT_ROUTE_DETAILS.exists():
        shutil.copytree(REACT_ROUTE_DETAILS, backup_details)
    metadata_backup = ROUTE_GENERATION_BACKUP / 'metadata'
    metadata_backup.mkdir()
    for index, path in enumerate(REACT_GENERATED_FILES):
        if path.exists():
            shutil.copyfile(path, metadata_backup / f'{index}.bin')
        else:
            (metadata_backup / f'{index}.missing').touch()
    (ROUTE_GENERATION_BACKUP / 'ready').touch()

    try:
        if REACT_ROUTE_DETAILS.exists():
            shutil.rmtree(REACT_ROUTE_DETAILS)
        staging_path.replace(REACT_ROUTE_DETAILS)
        for path, content in generated_files.items():
            write_text_atomic(path, content)
    except Exception:
        recover_interrupted_route_publication()
        raise
    else:
        shutil.rmtree(ROUTE_GENERATION_BACKUP)
