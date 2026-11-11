"""Owner-authored annotations anchored to a distance along a route.

An annotation is editorial content pinned to a point on the recorded trace. One
anchor drives every surface: the route guide shows it in the margin, Replay can
reveal it on arrival, and the cinematic director can cut to it.

The anchor is `at_distance_m`, the metres travelled along the recorded trace, so
it survives resampling and is unambiguous on an out-and-back route where the same
coordinates occur twice.

Every annotation carries an evidence label, per CONTEXT.md section 4. Editorial
interpretation is `hypothesis` and must never be presented as recorded truth.
"""

ANNOTATION_KINDS = ("note", "landmark", "warning", "image")
ANNOTATION_EVIDENCE = ("recorded", "derived", "measured", "hypothesis")
ANNOTATION_FIELDS = frozenset(
    ("id", "at_distance_m", "kind", "body", "evidence", "title", "media")
)
MEDIA_FIELDS = frozenset(("url", "thumb_url", "width", "height"))
MAX_BODY_LENGTH = 2000
MAX_TITLE_LENGTH = 120


def build_route_annotations(value, route_distance_m):
    """Validate and order the annotations for one route.

    Annotations are returned sorted by anchor so that every surface presents
    them in the order they are met along the route. The order is part of the
    contract, not a rendering choice.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("annotations must be a list")

    seen_ids = set()
    annotations = []
    for index, item in enumerate(value):
        annotation = _build_one(item, index, route_distance_m)
        if annotation["id"] in seen_ids:
            raise ValueError(f"annotation id {annotation['id']} is duplicated")
        seen_ids.add(annotation["id"])
        annotations.append(annotation)

    annotations.sort(key=lambda a: (a["at_distance_m"], a["id"]))
    return annotations


def _build_one(item, index, route_distance_m):
    if not isinstance(item, dict):
        raise ValueError(f"annotation {index} must be an object")

    unknown = sorted(set(item) - ANNOTATION_FIELDS)
    if unknown:
        raise ValueError(f"annotation {index} has unknown fields: {', '.join(unknown)}")

    identifier = item.get("id")
    if not isinstance(identifier, str) or not identifier.strip():
        raise ValueError(f"annotation {index} must have a non-empty id")

    kind = item.get("kind")
    if kind not in ANNOTATION_KINDS:
        raise ValueError(
            f"annotation {identifier} kind must be one of {', '.join(ANNOTATION_KINDS)}"
        )

    evidence = item.get("evidence")
    if evidence not in ANNOTATION_EVIDENCE:
        raise ValueError(
            f"annotation {identifier} evidence must be one of "
            f"{', '.join(ANNOTATION_EVIDENCE)}"
        )

    distance = item.get("at_distance_m")
    if isinstance(distance, bool) or not isinstance(distance, (int, float)):
        raise ValueError(f"annotation {identifier} at_distance_m must be a number")
    if distance < 0 or distance > route_distance_m:
        raise ValueError(
            f"annotation {identifier} at_distance_m must fall on the recorded route"
        )

    body = item.get("body")
    if not isinstance(body, str) or not body.strip():
        raise ValueError(f"annotation {identifier} body must be a non-empty string")
    if len(body) > MAX_BODY_LENGTH:
        raise ValueError(
            f"annotation {identifier} body must be at most {MAX_BODY_LENGTH} characters"
        )

    annotation = {
        "id": identifier.strip(),
        "at_distance_m": round(float(distance), 3),
        "kind": kind,
        "evidence": evidence,
        "body": body.strip(),
    }

    media = item.get("media")
    if annotation["kind"] == "image" and media is None:
        raise ValueError(f"annotation {identifier} of kind image requires media")
    if media is not None:
        annotation["media"] = _build_media(media, identifier)

    title = item.get("title")
    if title is not None:
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"annotation {identifier} title must be a non-empty string")
        if len(title) > MAX_TITLE_LENGTH:
            raise ValueError(
                f"annotation {identifier} title must be at most "
                f"{MAX_TITLE_LENGTH} characters"
            )
        annotation["title"] = title.strip()

    return annotation


def _build_media(media, identifier):
    """Validate a published image reference.

    The published paths come from route_media.publish_photo, which strips EXIF,
    so a reference here never carries the coordinates or the clock of the
    photograph it came from. A path outside the published media directory is
    refused, so an annotation can never point at the curator's own filesystem.
    """
    if not isinstance(media, dict):
        raise ValueError(f"annotation {identifier} media must be an object")
    unknown = sorted(set(media) - MEDIA_FIELDS)
    if unknown:
        raise ValueError(
            f"annotation {identifier} media has unknown fields: {', '.join(unknown)}"
        )
    built = {}
    for field in ("url", "thumb_url"):
        value = media.get(field)
        if not isinstance(value, str) or not value.startswith("media/"):
            raise ValueError(
                f"annotation {identifier} media {field} must be a published media path"
            )
        built[field] = value
    for field in ("width", "height"):
        value = media.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(
                f"annotation {identifier} media {field} must be a positive integer"
            )
        built[field] = value
    return built
