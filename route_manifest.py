"""Manifest (summary-tier) route records: a small trace and its recorded gaps.

The summary trace is a sample of the recorded line for overviews. Sampling
alone can straddle a recorded gap, so the points bounding each gap are always
kept, and the gaps themselves travel with the summary so an overview can split
the line exactly where the recording does, instead of drawing across it.
"""


def _bounding_indices(points, gaps):
    indices = set()
    for gap in gaps:
        before = [i for i, p in enumerate(points) if p.get("d", 0) <= gap["start_d"]]
        after = [i for i, p in enumerate(points) if p.get("d", 0) >= gap["end_d"]]
        if before:
            indices.add(before[-1])
        if after:
            indices.add(after[0])
    return indices


def simplify_route_for_manifest(points, gaps=(), max_points=96):
    if len(points) <= max_points:
        simplified = points
    else:
        last = len(points) - 1
        indices = {round(index * last / (max_points - 1)) for index in range(max_points)}
        indices |= _bounding_indices(points, gaps)
        simplified = [points[index] for index in sorted(indices)]
    return [
        [point["lat"], point["lng"], point.get("elev"), point.get("d", 0)]
        for point in simplified
    ]


def manifest_discontinuities(record):
    """The route's recorded gaps, by kind, source and distance only."""
    return [
        {
            "kind": gap["kind"],
            "source": gap["source"],
            "start_d": gap["start_d"],
            "end_d": gap["end_d"],
        }
        for gap in (record.get("provenance") or {}).get("discontinuities", [])
    ]
