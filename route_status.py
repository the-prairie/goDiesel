"""Where a route stands on the way to being published.

`validate-route-microsite.mjs` already refuses a route whose geometry is unfit.
This answers the different question a curator actually asks: is the guide
finished, and what is still missing?

Nothing here blocks. A scouted route with a draft guide is publishable, and
sometimes that is the right call. The point is that the curator should know what
they are publishing.
"""

import json
from pathlib import Path

from admin_curation import curation_readiness
from route_annotations import build_route_annotations
from route_imports import imported_route_from_spec, route_source_kind


def route_status(checkout_root, activity_id):
    """Report one route's readiness, from the generated record and the source."""
    root = Path(checkout_root)
    activity_id = str(activity_id)

    config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
    specs = [
        spec
        for spec in config.get("routes", [])
        if str(spec.get("activity_id")) == activity_id
    ]
    if not specs:
        return {"slug": activity_id, "known": False, "problems": ["not in quests.json"]}
    spec = specs[0]

    detail_path = root / "app/public/data/routes" / f"{activity_id}.json"
    generated = detail_path.is_file()
    detail = json.loads(detail_path.read_text(encoding="utf-8")) if generated else {}

    readiness = curation_readiness(spec.get("curation") or {})
    annotations = detail.get("annotations") or []
    images = [item for item in annotations if item.get("kind") == "image"]
    replay = detail.get("replay") or {}
    temporal = (detail.get("provenance") or {}).get("temporal") or {}

    problems = []
    # These are the fields scripts/validate-route-microsite.mjs refuses to
    # publish without. Reporting readiness without checking them gave false
    # confidence: it called a route ready that the publisher then rejected.
    for field in ("name", "region", "type"):
        if generated and not str(detail.get(field) or "").strip():
            problems.append(f"{field} is empty; the publisher requires it")
    lifecycle = detail.get("lifecycle", spec.get("lifecycle", "completed"))
    if generated and not str(detail.get("date") or "").strip() and lifecycle != "discovered":
        problems.append("date is empty; only discovered routes support an unknown date")
    # Mirrors scripts/validate-route-microsite.mjs: a page needs words, from
    # either the recorded activity description or the curated vibe.
    if generated and not (
        str(detail.get("description") or "").strip()
        or str((detail.get("curation") or {}).get("vibe") or "").strip()
    ):
        problems.append("no activity description and no curated vibe; the page would be wordless")
    if generated and not (
        str(detail.get("subtitle") or "").strip()
        or str(detail.get("activity_name") or "").strip()
    ):
        problems.append("subtitle or activity_name is required for the public title")
    if spec.get("status") != "approved":
        problems.append(f"status is {spec.get('status', 'pending')}, not approved")
    if spec.get("source_gpx"):
        try:
            imported_route_from_spec(spec, root)
        except ValueError as error:
            problems.append(f"source health failed: {error}")
    if not generated:
        problems.append("no generated record; run a build")
    elif replay.get("geometry_status") != "ready":
        problems.append(f"geometry is {replay.get('geometry_status')}")

    notes = []
    if readiness["status"] == "draft":
        missing = len(readiness["missing_fields"])
        notes.append(
            "guide is a draft"
            + (f", {missing} of 8 fields missing" if missing else ", all 8 fields written")
        )
    if not annotations:
        notes.append("no annotations")
    if not images:
        notes.append("no photographs")
    if temporal.get("status") != "recorded":
        notes.append("scouted: no recorded time")

    return {
        "slug": activity_id,
        "known": True,
        "source_kind": route_source_kind(spec),
        "lifecycle": lifecycle,
        "region": detail.get("region", spec.get("region", "")),
        "generated": generated,
        "geometry_status": replay.get("geometry_status"),
        "review_status": readiness["status"],
        "guide_complete": readiness["complete"],
        "missing_fields": readiness["missing_fields"],
        "annotations": len(annotations),
        "photographs": len(images),
        "publishable": not problems,
        "problems": problems,
        "notes": notes,
    }


def format_status(status):
    """One route, rendered for a terminal."""
    if not status.get("known"):
        return f"{status['slug']}: not in quests.json"

    mark = "ready" if status["publishable"] else "blocked"
    lines = [
        f"{status['slug']}  {status['region']}",
        f"  {mark}  ({status['source_kind']}, {status['lifecycle']},"
        f" geometry {status['geometry_status']})",
        f"  guide         {status['review_status']}"
        + ("" if status["guide_complete"] else
           f", missing {', '.join(status['missing_fields'])}"),
        f"  annotations   {status['annotations']} ({status['photographs']} photographs)",
    ]
    for problem in status["problems"]:
        lines.append(f"  BLOCKED       {problem}")
    for note in status["notes"]:
        lines.append(f"  note          {note}")
    return "\n".join(lines)


def main(argv):
    root = Path(__file__).resolve().parent
    if not argv:
        config = json.loads((root / "quests.json").read_text(encoding="utf-8"))
        approved = [
            str(spec["activity_id"])
            for spec in config.get("routes", [])
            if spec.get("status") == "approved"
        ]
        ready = published = 0
        for slug in approved:
            status = route_status(root, slug)
            ready += 1 if status["publishable"] else 0
            published += 1 if status["review_status"] != "draft" else 0
        print(f"{len(approved)} approved routes")
        print(f"  {ready} publishable")
        print(f"  {published} with a reviewed guide")
        return 0

    for slug in argv:
        print(format_status(route_status(root, slug)))
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
