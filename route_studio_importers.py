"""Safe, source-faithful GPX, KML, and KMZ inspection for Route Studio."""

from dataclasses import dataclass
from datetime import datetime
import hashlib
import io
import math
from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile


IMPORTER_VERSION = "route-studio-importer/1"
MAX_SOURCE_BYTES = 25 * 1024 * 1024
MAX_KMZ_ENTRIES = 64
MAX_KMZ_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
ARCHIVE_SUFFIXES = frozenset((".zip", ".kmz", ".tar", ".gz", ".7z", ".rar"))


class ImportError(ValueError):
    pass


class ImportSecurityError(ImportError):
    pass


@dataclass(frozen=True)
class SourcePoint:
    lat: float
    lng: float
    elevation: float | None
    timestamp: datetime | None
    segment_index: int


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str

    def as_dict(self):
        return {"severity": self.severity, "code": self.code, "message": self.message}


@dataclass(frozen=True)
class GeometryCandidate:
    id: str
    label: str
    geometry_kind: str
    segments: tuple[tuple[SourcePoint, ...], ...]
    distance_m: float
    ascent_m: float | None
    elevation_status: str
    timing_status: str
    geometry_fingerprint: str
    reverse_geometry_fingerprint: str

    @property
    def point_count(self):
        return sum(len(segment) for segment in self.segments)

    @property
    def segment_count(self):
        return len(self.segments)

    @property
    def points(self):
        return tuple(point for segment in self.segments for point in segment)

    def as_dict(self):
        preview_segments = []
        for segment in self.segments:
            if len(segment) <= 200:
                sampled = segment
            else:
                sampled = tuple(
                    segment[round(index * (len(segment) - 1) / 199)]
                    for index in range(200)
                )
            preview_segments.append([
                [point.lat, point.lng, point.elevation]
                for point in sampled
            ])
        return {
            "id": self.id,
            "label": self.label,
            "geometry_kind": self.geometry_kind,
            "distance_m": round(self.distance_m, 1),
            "ascent_m": round(self.ascent_m, 1) if self.ascent_m is not None else None,
            "point_count": self.point_count,
            "segment_count": self.segment_count,
            "elevation_status": self.elevation_status,
            "timing_status": self.timing_status,
            "geometry_fingerprint": self.geometry_fingerprint,
            "reverse_geometry_fingerprint": self.reverse_geometry_fingerprint,
            "preview_segments": preview_segments,
        }


@dataclass(frozen=True)
class SourceInspection:
    source_format: str
    candidates: tuple[GeometryCandidate, ...]
    selected_geometry_id: str | None
    findings: tuple[Finding, ...]
    source_metadata: dict[str, object]

    def as_dict(self):
        return {
            "source_format": self.source_format,
            "selected_geometry_id": self.selected_geometry_id,
            "candidates": [candidate.as_dict() for candidate in self.candidates],
            "findings": [finding.as_dict() for finding in self.findings],
            "source_metadata": self.source_metadata,
            "importer_version": IMPORTER_VERSION,
        }


def inspect_source(filename: str, payload: bytes) -> SourceInspection:
    if not isinstance(payload, bytes) or not payload:
        raise ImportError("route source is empty")
    if len(payload) > MAX_SOURCE_BYTES:
        raise ImportSecurityError("route source exceeds the 25 MiB limit")
    source_format = detect_source_format(filename, payload)
    if source_format == "gpx":
        candidates, metadata = _parse_gpx(payload)
    elif source_format == "kml":
        candidates, metadata = _parse_kml(payload, prefix="kml")
    else:
        candidates, metadata = _parse_kmz(payload)
    if not candidates:
        raise ImportError("route source contains no supported route geometry")

    findings = []
    if len(candidates) > 1:
        findings.append(Finding(
            "blocker",
            "multiple-geometries",
            "Select the intended route geometry before identifying this route.",
        ))
    for candidate in candidates:
        if candidate.point_count < 2:
            findings.append(Finding(
                "blocker", "insufficient-points", f"{candidate.label} has fewer than two points."
            ))
        if candidate.elevation_status == "unavailable":
            findings.append(Finding(
                "information", "elevation-unavailable", f"{candidate.label} has no recorded elevation."
            ))
        if candidate.timing_status == "unavailable":
            findings.append(Finding(
                "information", "timing-unavailable", f"{candidate.label} has no trustworthy recorded timing."
            ))
    return SourceInspection(
        source_format=source_format,
        candidates=tuple(candidates),
        selected_geometry_id=candidates[0].id if len(candidates) == 1 else None,
        findings=tuple(findings),
        source_metadata=metadata,
    )


def detect_source_format(filename: str, payload: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in (".gpx", ".kml", ".kmz"):
        raise ImportError("supported route formats are GPX, KML, and KMZ")
    if payload.startswith(b"PK\x03\x04"):
        if suffix != ".kmz":
            raise ImportError("ZIP route sources must use the .kmz extension")
        return "kmz"
    prefix = payload[:2048].lower()
    if suffix == ".kmz":
        raise ImportError("KMZ source is not a readable ZIP archive")
    if suffix == ".gpx" and b"<gpx" not in prefix:
        raise ImportError("GPX source does not contain a GPX document")
    if suffix == ".kml" and b"<kml" not in prefix:
        raise ImportError("KML source does not contain a KML document")
    return suffix[1:]


def _safe_xml(payload: bytes):
    if re.search(br"<!\s*(?:doctype|entity)\b", payload, flags=re.IGNORECASE):
        raise ImportSecurityError("XML document type and entity declarations are not allowed")
    try:
        return ET.fromstring(payload)
    except ET.ParseError as error:
        raise ImportError(f"route source XML is malformed: {error}") from error


def _local_name(element):
    return element.tag.rsplit("}", 1)[-1]


def _child_text(element, local_name):
    for child in element:
        if _local_name(child) == local_name and child.text:
            return child.text.strip()
    return ""


def _parse_timestamp(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ImportError(f"{label} is not numeric") from error
    if not math.isfinite(number):
        raise ImportError(f"{label} is not finite")
    return number


def _point(lat, lng, elevation, timestamp, segment_index):
    lat_value = _number(lat, "latitude")
    lng_value = _number(lng, "longitude")
    if not -90 <= lat_value <= 90 or not -180 <= lng_value <= 180:
        raise ImportError("route coordinate is outside valid latitude or longitude bounds")
    return SourcePoint(
        lat=lat_value,
        lng=lng_value,
        elevation=_number(elevation, "elevation") if elevation not in (None, "") else None,
        timestamp=_parse_timestamp(timestamp),
        segment_index=segment_index,
    )


def _parse_gpx(payload):
    root = _safe_xml(payload)
    candidates = []
    for track_index, track in enumerate(element for element in root.iter() if _local_name(element) == "trk"):
        segments = []
        for segment_index, segment in enumerate(child for child in track if _local_name(child) == "trkseg"):
            points = []
            for item in (child for child in segment if _local_name(child) == "trkpt"):
                points.append(_point(
                    item.attrib.get("lat"),
                    item.attrib.get("lon"),
                    _child_text(item, "ele") or None,
                    _child_text(item, "time") or None,
                    segment_index,
                ))
            if points:
                segments.append(tuple(points))
        if segments:
            candidates.append(_candidate(
                f"gpx-track-{track_index + 1}",
                _child_text(track, "name") or f"Track {track_index + 1}",
                "track",
                segments,
            ))
    for route_index, route in enumerate(element for element in root.iter() if _local_name(element) == "rte"):
        points = [
            _point(
                item.attrib.get("lat"),
                item.attrib.get("lon"),
                _child_text(item, "ele") or None,
                _child_text(item, "time") or None,
                0,
            )
            for item in route
            if _local_name(item) == "rtept"
        ]
        if points:
            candidates.append(_candidate(
                f"gpx-route-{route_index + 1}",
                _child_text(route, "name") or f"Route {route_index + 1}",
                "route",
                [tuple(points)],
            ))
    metadata = {
        "creator": root.attrib.get("creator", ""),
        "name": next((_child_text(item, "name") for item in root if _local_name(item) == "metadata"), ""),
    }
    return candidates, metadata


def _parse_kml(payload, *, prefix):
    root = _safe_xml(payload)
    candidates = []
    placemarks = [element for element in root.iter() if _local_name(element) == "Placemark"]
    for placemark_index, placemark in enumerate(placemarks):
        label = _child_text(placemark, "name") or f"Geometry {placemark_index + 1}"
        line_index = 0
        for element in placemark.iter():
            if _local_name(element) != "LineString":
                continue
            coordinate_text = next(
                (child.text or "" for child in element if _local_name(child) == "coordinates"),
                "",
            )
            points = _kml_coordinate_points(coordinate_text, 0)
            if points:
                line_index += 1
                suffix = f" {line_index}" if sum(1 for item in placemark.iter() if _local_name(item) == "LineString") > 1 else ""
                candidates.append(_candidate(
                    f"{prefix}-line-{placemark_index + 1}-{line_index}",
                    f"{label}{suffix}",
                    "line-string",
                    [tuple(points)],
                ))
        track_index = 0
        for element in placemark.iter():
            if _local_name(element) != "Track":
                continue
            coordinates = [child.text or "" for child in element if _local_name(child) == "coord"]
            timestamps = [child.text or "" for child in element if _local_name(child) == "when"]
            points = []
            for point_index, coordinate in enumerate(coordinates):
                parts = coordinate.split()
                if len(parts) < 2:
                    raise ImportError("gx:Track coordinate must contain longitude and latitude")
                points.append(_point(
                    parts[1], parts[0], parts[2] if len(parts) > 2 else None,
                    timestamps[point_index] if point_index < len(timestamps) else None,
                    0,
                ))
            if points:
                track_index += 1
                candidates.append(_candidate(
                    f"{prefix}-track-{placemark_index + 1}-{track_index}",
                    label,
                    "gx-track",
                    [tuple(points)],
                ))
    return candidates, {"placemark_count": len(placemarks)}


def _kml_coordinate_points(value, segment_index):
    points = []
    for coordinate in re.split(r"\s+", value.strip()):
        if not coordinate:
            continue
        parts = coordinate.split(",")
        if len(parts) < 2:
            raise ImportError("KML coordinate must contain longitude and latitude")
        points.append(_point(
            parts[1], parts[0], parts[2] if len(parts) > 2 and parts[2] != "" else None,
            None, segment_index,
        ))
    return points


def _parse_kmz(payload):
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as error:
        raise ImportError("KMZ source is not a readable ZIP archive") from error
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_KMZ_ENTRIES:
            raise ImportSecurityError("KMZ contains too many entries")
        total_size = 0
        kml_entries = []
        for info in infos:
            path = PurePosixPath(info.filename.replace("\\", "/"))
            if path.is_absolute() or ".." in path.parts:
                raise ImportSecurityError("KMZ contains a path traversal entry")
            suffix = path.suffix.lower()
            if suffix in ARCHIVE_SUFFIXES:
                raise ImportSecurityError("KMZ contains a nested archive")
            total_size += info.file_size
            if total_size > MAX_KMZ_UNCOMPRESSED_BYTES:
                raise ImportSecurityError("KMZ exceeds the uncompressed size limit")
            if suffix == ".kml" and not info.is_dir():
                kml_entries.append(info)
        if not kml_entries:
            raise ImportError("KMZ contains no KML document")
        candidates = []
        for entry_index, info in enumerate(kml_entries):
            content = archive.read(info)
            parsed, _ = _parse_kml(content, prefix=f"kmz-{entry_index + 1}")
            candidates.extend(parsed)
        return candidates, {
            "entry_count": len(infos),
            "kml_files": [info.filename for info in kml_entries],
        }


def _candidate(candidate_id, label, geometry_kind, segments):
    points = [point for segment in segments for point in segment]
    elevations = [point.elevation for point in points]
    timestamps = [point.timestamp for point in points]
    elevation_recorded = bool(points) and all(value is not None for value in elevations)
    timing_recorded = bool(points) and all(value is not None for value in timestamps)
    if timing_recorded:
        timing_recorded = all(
            current >= previous
            for previous, current in zip(timestamps, timestamps[1:])
        )
    distance = sum(
        _distance(previous, current)
        for segment in segments
        for previous, current in zip(segment, segment[1:])
    )
    ascent = None
    if elevation_recorded:
        ascent = sum(
            max(0.0, current.elevation - previous.elevation)
            for segment in segments
            for previous, current in zip(segment, segment[1:])
        )
    fingerprint_payload = "|".join(
        f"{point.segment_index}:{point.lat:.7f},{point.lng:.7f}"
        for point in points
    ).encode("ascii")
    reverse_fingerprint_payload = "|".join(
        f"{point.segment_index}:{point.lat:.7f},{point.lng:.7f}"
        for point in reversed(points)
    ).encode("ascii")
    return GeometryCandidate(
        id=candidate_id,
        label=label.strip() or candidate_id,
        geometry_kind=geometry_kind,
        segments=tuple(segments),
        distance_m=distance,
        ascent_m=ascent,
        elevation_status="recorded" if elevation_recorded else "unavailable",
        timing_status="recorded" if timing_recorded else "unavailable",
        geometry_fingerprint=hashlib.sha256(fingerprint_payload).hexdigest(),
        reverse_geometry_fingerprint=hashlib.sha256(reverse_fingerprint_payload).hexdigest(),
    )


def _distance(start, end):
    radius_m = 6_371_000
    delta_lat = math.radians(end.lat - start.lat)
    delta_lng = math.radians(end.lng - start.lng)
    start_lat = math.radians(start.lat)
    end_lat = math.radians(end.lat)
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(start_lat) * math.cos(end_lat) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * radius_m * math.asin(math.sqrt(value))


def candidate_by_id(inspection, candidate_id):
    for candidate in inspection.candidates:
        if candidate.id == candidate_id:
            return candidate
    raise ImportError(f"geometry candidate {candidate_id!r} was not found")


def canonical_gpx(candidate, *, name, preserve_timing=True):
    root = ET.Element("gpx", {
        "version": "1.1",
        "creator": IMPORTER_VERSION,
        "xmlns": "http://www.topografix.com/GPX/1/1",
    })
    track = ET.SubElement(root, "trk")
    ET.SubElement(track, "name").text = name
    for segment in candidate.segments:
        segment_element = ET.SubElement(track, "trkseg")
        for point in segment:
            point_element = ET.SubElement(segment_element, "trkpt", {
                "lat": f"{point.lat:.8f}",
                "lon": f"{point.lng:.8f}",
            })
            if point.elevation is not None:
                ET.SubElement(point_element, "ele").text = f"{point.elevation:.3f}"
            if preserve_timing and point.timestamp is not None:
                ET.SubElement(point_element, "time").text = point.timestamp.isoformat().replace("+00:00", "Z")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"
