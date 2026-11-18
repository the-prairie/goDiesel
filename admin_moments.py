"""Her planted moments: the closed contract and the atomic write (ADR-0010).

The catalog (what she has made) and the placements (where each stands in the
sketch world) are her private content. They live with her clips in the
gitignored app/public/moments/ folder and are written only here: only when
the whole document is valid, and only by replacing the file atomically, so a
refused or interrupted save leaves what she had.
"""

import json
import math
import os
import re
import tempfile
from pathlib import Path

ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
CLIP = re.compile(r'^/moments/[A-Za-z0-9_-]+\.(?:mp4|webm)$')
KINDS = ('tv-wall',)
ENTRY_KEYS = {'id', 'kind', 'title', 'clip', 'caption', 'public'}
PLACEMENT_KEYS = {'id', 'entryId', 'at', 'facingDeg', 'frontM'}


def _number(value, low, high, name, high_open=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{name} must be a number')
    if value < low or value > high or (high_open and value >= high):
        raise ValueError(f'{name} is out of range')
    return value


def validate_moments(data):
    """The document, unchanged, if it keeps the contract; ValueError otherwise."""
    if not isinstance(data, dict) or set(data) != {'catalog', 'placements'}:
        raise ValueError('moments must have exactly a catalog and placements')
    catalog, placements = data['catalog'], data['placements']
    if not isinstance(catalog, list) or not isinstance(placements, list):
        raise ValueError('catalog and placements must be lists')
    ids = set()
    for entry in catalog:
        if not isinstance(entry, dict) or not set(entry) <= ENTRY_KEYS or not {'id', 'kind', 'title', 'clip'} <= set(entry):
            raise ValueError('a catalog entry has missing or unknown fields')
        if not isinstance(entry['id'], str) or not ID.match(entry['id']) or entry['id'] in ids:
            raise ValueError('catalog ids must be unique short slugs')
        ids.add(entry['id'])
        if entry['kind'] not in KINDS:
            raise ValueError(f'unknown kind: {entry["kind"]!r}')
        if not isinstance(entry['title'], str) or not 0 < len(entry['title']) <= 120:
            raise ValueError('a title is 1 to 120 characters')
        if entry['clip'] is not None and (not isinstance(entry['clip'], str) or not CLIP.match(entry['clip'])):
            raise ValueError('a clip is a file in /moments/, or null')
        if 'caption' in entry and (not isinstance(entry['caption'], str) or len(entry['caption']) > 280):
            raise ValueError('a caption is text up to 280 characters')
        if 'public' in entry and not isinstance(entry['public'], bool):
            raise ValueError('public is true or false')
    places = set()
    for placement in placements:
        if not isinstance(placement, dict) or not set(placement) <= PLACEMENT_KEYS or not {'id', 'entryId', 'at', 'facingDeg'} <= set(placement):
            raise ValueError('a placement has missing or unknown fields')
        if not isinstance(placement['id'], str) or not ID.match(placement['id']) or placement['id'] in places:
            raise ValueError('placement ids must be unique short slugs')
        places.add(placement['id'])
        if placement['entryId'] is not None and placement['entryId'] not in ids:
            raise ValueError('a placement names an entry that is not in the catalog')
        at = placement['at']
        if not isinstance(at, dict) or set(at) != {'lng', 'lat'}:
            raise ValueError('a place is a lng and a lat')
        _number(at['lng'], -180, 180, 'lng')
        _number(at['lat'], -90, 90, 'lat')
        _number(placement['facingDeg'], 0, 360, 'facingDeg', high_open=True)
        if 'frontM' in placement:
            _number(placement['frontM'], 1, 200, 'frontM')
    return data


def moments_path(root):
    return Path(root) / 'app' / 'public' / 'moments' / 'moments.json'


def read_moments(root):
    path = moments_path(root)
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def write_moments(root, data):
    """Validate, then replace the file in one step; nothing is written otherwise."""
    validate_moments(data)
    path = moments_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix='.moments-', suffix='.json')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return data
