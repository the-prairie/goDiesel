"""Command-line interface for World Pack inspection, compilation, and custody."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .archive import ARCHIVE_SUFFIX, export_pack, import_pack
from .canonical import sha256_file
from .compiler import BuildConfiguration, WorldPackCompiler
from .errors import WorldPackError
from .migrations import migrate_pack
from .repair import repair_pack
from .route import load_canonical_route
from .verification import inspect_pack, verify_pack


DEFAULT_REPOSITORY = Path("world-packs-local")


def _print(value: object, *, stream: object | None = None) -> None:
    print(
        json.dumps(value, indent=2, sort_keys=True),
        file=stream if stream is not None else sys.stdout,
    )


def _missing_offsets(values: list[str]) -> tuple[tuple[int, int], ...]:
    result = []
    for value in values:
        parts = value.split(",")
        if len(parts) != 2:
            raise ValueError(f"missing-cell offset must be x,y: {value!r}")
        result.append((int(parts[0]), int(parts[1])))
    return tuple(result)


def _route_summary(path: Path) -> dict[str, object]:
    route = load_canonical_route(path)
    coordinates = route["coordinates"]
    assert isinstance(coordinates, list)
    final = coordinates[-1]
    assert isinstance(final, dict)
    return {
        "kind": "strict-route-detail",
        "routeId": route["routeId"],
        "slug": route["slug"],
        "name": route["name"],
        "region": route["region"],
        "pointCount": len(coordinates),
        "distanceM": final["distanceM"],
        "segmentCount": route["segmentCount"],
        "discontinuityCount": len(route["discontinuities"]),
        "sourceSha256": sha256_file(path),
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="godiesel")
    root = parser.add_subparsers(dest="root_command", required=True)
    world = root.add_parser("world", help="compile and preserve local World Packs")
    world.add_argument(
        "--repository", type=Path, default=DEFAULT_REPOSITORY, help="local pack repository"
    )
    commands = world.add_subparsers(dest="world_command", required=True)

    inspect_command = commands.add_parser("inspect")
    inspect_command.add_argument("target", type=Path)

    build = commands.add_parser("build")
    build.add_argument("route", type=Path)
    build.add_argument("--quality", choices=["core", "detailed", "archival"], default="core")
    build.add_argument("--world-id")
    build.add_argument("--acquired-at", required=True)
    build.add_argument("--source-uri")
    build.add_argument("--source-date")
    build.add_argument("--licence", required=True)
    build.add_argument("--attribution", required=True)
    build.add_argument("--corridor-radius-m", type=int, default=1_000)
    build.add_argument("--exploration-radius-m", type=int, default=1_600)
    build.add_argument("--quality-cell-size-m", type=int, default=250)
    build.add_argument("--missing-cell", action="append", default=[])

    verify = commands.add_parser("verify")
    verify.add_argument("pack", type=Path)

    repair = commands.add_parser("repair")
    repair.add_argument("pack", type=Path)

    export = commands.add_parser("export")
    export.add_argument("pack", type=Path)
    export.add_argument("--output", type=Path)

    import_command = commands.add_parser("import")
    import_command.add_argument("archive", type=Path)

    migrate = commands.add_parser("migrate")
    migrate.add_argument("pack", type=Path)
    migrate.add_argument("--target", type=int, default=1)
    return parser


def _run(args: argparse.Namespace) -> dict[str, object]:
    repository = args.repository.resolve()
    if args.world_command == "inspect":
        target = args.target
        if target.is_dir():
            return inspect_pack(target).as_dict()
        return _route_summary(target)
    if args.world_command == "build":
        route = load_canonical_route(args.route)
        world_id = args.world_id or f"route-{route['slug']}"
        source_uri = args.source_uri or f"source:sha256:{sha256_file(args.route)}"
        configuration = BuildConfiguration(
            world_id=world_id,
            acquired_at=args.acquired_at,
            quality=args.quality,
            corridor_radius_m=args.corridor_radius_m,
            exploration_radius_m=args.exploration_radius_m,
            quality_cell_size_m=args.quality_cell_size_m,
            source_uri=source_uri,
            source_date=args.source_date,
            licence=args.licence,
            attribution=args.attribution,
            deliberate_missing_cell_offsets=_missing_offsets(args.missing_cell),
        )
        result = WorldPackCompiler(repository).build_route(args.route, configuration)
        return {
            "status": "complete",
            "worldId": result.world_id,
            "packId": result.pack_id,
            "path": str(result.path),
            "created": result.created,
        }
    if args.world_command == "verify":
        return verify_pack(args.pack).as_dict()
    if args.world_command == "repair":
        result = repair_pack(args.pack, repository)
        return {
            "status": "complete",
            "packId": result.pack_id,
            "path": str(result.path),
            "repaired": result.repaired,
            "quarantinedPath": (
                str(result.quarantined_path) if result.quarantined_path else None
            ),
        }
    if args.world_command == "export":
        health = verify_pack(args.pack)
        output = args.output or Path(f"{health.packId}{ARCHIVE_SUFFIX}")
        result = export_pack(args.pack, output)
        return {
            "status": "complete",
            "packId": result.pack_id,
            "path": str(result.path),
            "sha256": result.sha256,
            "byteSize": result.byte_size,
        }
    if args.world_command == "import":
        result = import_pack(args.archive, repository)
        return {
            "status": "complete",
            "packId": result.pack_id,
            "path": str(result.path),
            "archiveSha256": result.sha256,
            "archiveByteSize": result.byte_size,
        }
    if args.world_command == "migrate":
        result = migrate_pack(args.pack, target=args.target)
        return {
            "status": "complete",
            "path": str(result.path),
            "sourceVersion": result.source_version,
            "targetVersion": result.target_version,
            "changed": result.changed,
        }
    raise ValueError(f"unknown world command: {args.world_command}")


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        _print(_run(args))
        return 0
    except (WorldPackError, OSError, ValueError) as error:
        _print(
            {"status": "error", "error": type(error).__name__, "message": str(error)},
            stream=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
