"""Match a photograph to a point on a recorded route.

The old matcher accepted any photo within 500 km of a route's centre and applied
no date filter, so a run in Rome collected every photo taken in central Italy in
any year. It was removed. Position alone is too weak.

Time is the stronger signal, and this project has it: 66 of 67 routes carry a
recorded UTC start, an elapsed time, and a per-point `elapsed_s`. So for any
instant we know where on the route the curator was, and at what distance. Time
gives the anchor; position confirms it.

That also disambiguates an out-and-back, where the same coordinates occur twice
at different times and position alone cannot choose.

Nothing here publishes. Matching proposes candidates with a confidence, and a
curator accepts them. `'source': 'auto'` was the defect in the old matcher, not
the matching itself.
"""

import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0

# A high-confidence match must agree in both time and position.
HIGH_CONFIDENCE_SECONDS = 90
HIGH_CONFIDENCE_METRES = 100
# Position-only, for a scouted route or a photo with no usable timestamp.
MEDIUM_CONFIDENCE_METRES = 500

CONFIDENCES = ("high", "medium", "low", "none")


def haversine_m(lat_a, lng_a, lat_b, lng_b):
    phi_a, phi_b = radians(lat_a), radians(lat_b)
    delta_phi = radians(lat_b - lat_a)
    delta_lambda = radians(lng_b - lng_a)
    h = sin(delta_phi / 2) ** 2 + cos(phi_a) * cos(phi_b) * sin(delta_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(h))


def match_photo_to_route(photo, route, temporal):
    """Propose where a photograph belongs on a route.

    `photo` carries `lat`, `lng` and an optional timezone-aware `taken_utc`.
    Returns a proposal with a confidence, the anchor in metres, and the evidence
    label the annotation should carry if a curator accepts it.
    """
    if not route:
        return _no_match("the route has no recorded geometry")

    has_position = photo.get("lat") is not None and photo.get("lng") is not None
    if not has_position:
        return _no_match("the photograph carries no coordinates")

    timed = _time_match(photo, route, temporal)
    if timed is not None:
        return timed
    return _position_match(photo, route)


def _time_match(photo, route, temporal):
    """Anchor by recorded time, then confirm with position."""
    taken = photo.get("taken_utc")
    if taken is None or (temporal or {}).get("status") != "recorded":
        return None
    start = _parse_utc((temporal or {}).get("start_time_utc"))
    if start is None:
        return None

    offset = (taken - start).total_seconds()
    elapsed_total = temporal.get("elapsed_time_s")
    if offset < -HIGH_CONFIDENCE_SECONDS:
        return None
    if elapsed_total is not None and offset > elapsed_total + HIGH_CONFIDENCE_SECONDS:
        return None

    point = _point_at_elapsed(route, offset)
    if point is None:
        return None

    separation = haversine_m(photo["lat"], photo["lng"], point["lat"], point["lng"])
    time_error = abs(offset - point.get("elapsed_s", offset))

    if separation <= HIGH_CONFIDENCE_METRES and time_error <= HIGH_CONFIDENCE_SECONDS:
        return _proposal(
            "high",
            point["d"],
            "recorded",
            "the photograph was taken on this route, at this time and place",
            separation,
            time_error,
        )
    if separation <= MEDIUM_CONFIDENCE_METRES:
        return _proposal(
            "medium",
            point["d"],
            "recorded",
            "the time matches the route, but the position is loose",
            separation,
            time_error,
        )
    return _proposal(
        "low",
        point["d"],
        "hypothesis",
        "the time matches the route, but the position does not",
        separation,
        time_error,
    )


def _position_match(photo, route):
    """Anchor by position alone, for a scouted route or an undated photograph."""
    nearest = min(
        route,
        key=lambda point: haversine_m(
            photo["lat"], photo["lng"], point["lat"], point["lng"]
        ),
    )
    separation = haversine_m(
        photo["lat"], photo["lng"], nearest["lat"], nearest["lng"]
    )
    if separation <= MEDIUM_CONFIDENCE_METRES:
        return _proposal(
            "medium",
            nearest["d"],
            "recorded",
            "the photograph was taken on the route, but the time is unconfirmed",
            separation,
            None,
        )
    return _no_match(
        f"the nearest route point is {separation / 1000:.1f} km away",
        at_distance_m=nearest["d"],
        separation_m=separation,
    )


def _point_at_elapsed(route, offset_seconds):
    timed = [point for point in route if point.get("elapsed_s") is not None]
    if not timed:
        return None
    return min(timed, key=lambda point: abs(point["elapsed_s"] - offset_seconds))


def _proposal(confidence, at_distance_m, evidence, reason, separation_m, time_error_s):
    return {
        "confidence": confidence,
        "at_distance_m": round(float(at_distance_m), 3),
        "evidence": evidence,
        "reason": reason,
        "separation_m": round(float(separation_m), 1),
        "time_error_s": None if time_error_s is None else round(float(time_error_s)),
    }


def _no_match(reason, at_distance_m=None, separation_m=None):
    return {
        "confidence": "none",
        "at_distance_m": None if at_distance_m is None else round(float(at_distance_m), 3),
        "evidence": "hypothesis",
        "reason": reason,
        "separation_m": None if separation_m is None else round(float(separation_m), 1),
        "time_error_s": None,
    }


def _parse_utc(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ── Reading a photograph ───────────────────────────────────────────────────────
#
# iPhone photographs carry GPS in EXIF when Location Services is on for the
# Camera, and HEIC is the default container, which browsers cannot decode. So
# the loopback writer reads the file, not the browser.
#
# The timestamp trap: DateTimeOriginal (0x9003) is LOCAL time with no zone,
# while GPSDateStamp and GPSTimeStamp are UTC. Prefer the GPS pair. Fall back to
# the local stamp interpreted in the route's own recorded time zone. The removed
# matcher parsed only the local stamp, which is hours wrong for a route abroad.

GPS_LATITUDE_REF, GPS_LATITUDE = 1, 2
GPS_LONGITUDE_REF, GPS_LONGITUDE = 3, 4
GPS_TIMESTAMP, GPS_DATESTAMP = 7, 29
EXIF_GPS_IFD, EXIF_IFD, DATE_TIME_ORIGINAL = 0x8825, 0x8769, 0x9003


def read_photo_metadata(path, fallback_time_zone=None):
    """Extract coordinates and a UTC timestamp from an image file."""
    from PIL import Image

    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    with Image.open(path) as image:
        exif = image.getexif()
        size = image.size
    if not exif:
        return {"lat": None, "lng": None, "taken_utc": None, "size": size}

    gps = exif.get_ifd(EXIF_GPS_IFD) or {}
    lat = _coordinate(gps.get(GPS_LATITUDE), gps.get(GPS_LATITUDE_REF, "N"))
    lng = _coordinate(gps.get(GPS_LONGITUDE), gps.get(GPS_LONGITUDE_REF, "E"))

    taken = _gps_timestamp(gps)
    if taken is None:
        taken = _local_timestamp(exif, fallback_time_zone)

    return {"lat": lat, "lng": lng, "taken_utc": taken, "size": size}


def _coordinate(dms, ref):
    if not dms or len(dms) != 3:
        return None
    try:
        degrees = float(dms[0]) + float(dms[1]) / 60 + float(dms[2]) / 3600
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return -degrees if str(ref).upper() in ("S", "W") else degrees


def _gps_timestamp(gps):
    stamp, clock = gps.get(GPS_DATESTAMP), gps.get(GPS_TIMESTAMP)
    if not stamp or not clock or len(clock) != 3:
        return None
    try:
        year, month, day = (int(part) for part in str(stamp).split(":"))
        return datetime(
            year, month, day,
            int(float(clock[0])), int(float(clock[1])), int(float(clock[2])),
            tzinfo=timezone.utc,
        )
    except (TypeError, ValueError):
        return None


def _local_timestamp(exif, time_zone):
    raw = (exif.get_ifd(EXIF_IFD) or {}).get(DATE_TIME_ORIGINAL)
    if not isinstance(raw, str):
        return None
    try:
        naive = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    if not time_zone:
        # No zone to interpret the stamp in, so it cannot be trusted as UTC.
        return None
    try:
        from zoneinfo import ZoneInfo

        return naive.replace(tzinfo=ZoneInfo(time_zone)).astimezone(timezone.utc)
    except Exception:
        return None


def publish_photo(source_path, destination_dir, slug, digest, max_size=1600, thumb=320):
    """Write a stripped, resized copy of a photograph and its thumbnail.

    EXIF is read for matching and then discarded, so a published image never
    carries the coordinates or the clock of the person who took it.
    """
    from PIL import Image

    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
    except ImportError:
        pass

    destination_dir.mkdir(parents=True, exist_ok=True)
    full = destination_dir / f"{digest}.jpg"
    small = destination_dir / f"{digest}-thumb.jpg"

    with Image.open(source_path) as image:
        image = image.convert("RGB")
        published = image.copy()
        published.thumbnail((max_size, max_size))
        # save() without an exif argument writes no EXIF block at all.
        published.save(full, "JPEG", quality=82, optimize=True)
        preview = image.copy()
        preview.thumbnail((thumb, thumb))
        preview.save(small, "JPEG", quality=78, optimize=True)
        width, height = published.size

    return {
        "url": f"media/{slug}/{full.name}",
        "thumb_url": f"media/{slug}/{small.name}",
        "width": width,
        "height": height,
    }


# ── Reading a video ────────────────────────────────────────────────────────────
#
# A video is a better ingest source than a photograph for one reason:
# `com.apple.quicktime.creationdate` carries the UTC offset, so its timestamp is
# unambiguous. A photograph's DateTimeOriginal is bare local time and has to
# borrow a zone from the route.
#
# Two traps, both observed in real files:
#
#   com.apple.quicktime.creationdate   2025-11-25T07:50:41+0900  <- when it was shot
#   creation_time                      2025-11-24T22:56:53Z      <- when the file was written
#
# Those differed by six minutes on a thirteen-second clip, which is about a
# kilometre of route at running pace. Always read the Apple key.
#
# And re-encoding destroys every Apple key. A clip cut with `-c copy` also loses
# them unless `-movflags use_metadata_tags` is given.

VIDEO_LOCATION_PATTERN = re.compile(
    r"^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?"
)


def read_video_metadata(path):
    """Read when and where a video was shot, using ffprobe."""
    probe = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    document = json.loads(probe.stdout)["format"]
    tags = document.get("tags", {})

    created = tags.get("com.apple.quicktime.creationdate")
    taken = None
    if created:
        try:
            taken = datetime.fromisoformat(created).astimezone(timezone.utc)
        except ValueError:
            taken = None

    lat = lng = altitude = None
    matched = VIDEO_LOCATION_PATTERN.match(
        tags.get("com.apple.quicktime.location.ISO6709", "")
    )
    if matched:
        lat = float(matched.group(1))
        lng = float(matched.group(2))
        altitude = float(matched.group(3)) if matched.group(3) else None

    return {
        "taken_utc": taken,
        "lat": lat,
        "lng": lng,
        "altitude_m": altitude,
        "duration_s": float(document.get("duration", 0.0)),
        "model": tags.get("com.apple.quicktime.model"),
    }


def frame_photo(video, offset_seconds):
    """Describe the frame at an offset as though it were a photograph.

    The video supplies the moment. The route supplies the position for that
    moment, so a frame is matchable even though the video records only one
    position for the whole clip.
    """
    if video.get("taken_utc") is None:
        return {"lat": video.get("lat"), "lng": video.get("lng"), "taken_utc": None}
    return {
        "lat": video.get("lat"),
        "lng": video.get("lng"),
        "taken_utc": video["taken_utc"] + timedelta(seconds=offset_seconds),
    }


def extract_frame(video_path, offset_seconds, destination):
    """Write one frame to disk. The frame carries no metadata of its own."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{offset_seconds:.3f}",
            "-i", str(video_path),
            "-frames:v", "1",
            str(destination),
        ],
        check=True,
    )
    return destination
