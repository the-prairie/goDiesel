import json
from pathlib import Path

from world_packs.cli import main


ROOT = Path(__file__).resolve().parent
UCLUELET = ROOT / "app/public/data/routes/6496900063.json"


def parse_output(capsys) -> dict[str, object]:
    output = json.loads(capsys.readouterr().out)
    assert isinstance(output, dict)
    return output


def build_arguments(repository: Path) -> list[str]:
    return [
        "world",
        "--repository",
        str(repository),
        "build",
        str(UCLUELET),
        "--quality",
        "core",
        "--world-id",
        "ucluelet-cli-test",
        "--acquired-at",
        "2026-08-26T00:00:00Z",
        "--source-date",
        "2021-10-14",
        "--licence",
        "owner-controlled-derived-route-data",
        "--attribution",
        "goDiesel route pipeline",
        "--corridor-radius-m",
        "100",
        "--exploration-radius-m",
        "150",
        "--quality-cell-size-m",
        "100",
        "--missing-cell",
        "0,0",
    ]


def test_cli_inspects_builds_verifies_exports_and_imports(tmp_path: Path, capsys):
    repository = tmp_path / "repository"
    assert main(["world", "inspect", str(UCLUELET)]) == 0
    inspected = parse_output(capsys)
    assert inspected["kind"] == "strict-route-detail"
    assert inspected["routeId"] == "6496900063"

    assert main(build_arguments(repository)) == 0
    built = parse_output(capsys)
    assert built["status"] == "complete"
    pack_path = Path(str(built["path"]))

    assert main(["world", "verify", str(pack_path)]) == 0
    verified = parse_output(capsys)
    assert verified["status"] == "complete"
    assert verified["packId"] == built["packId"]

    archive = tmp_path / "ucluelet.worldpack.zip"
    assert main(["world", "export", str(pack_path), "--output", str(archive)]) == 0
    exported = parse_output(capsys)
    assert exported["sha256"]

    clean = tmp_path / "clean"
    assert main(["world", "--repository", str(clean), "import", str(archive)]) == 0
    imported = parse_output(capsys)
    assert imported["packId"] == built["packId"]


def test_cli_reports_named_quality_and_integrity_errors(tmp_path: Path, capsys):
    arguments = build_arguments(tmp_path / "repository")
    arguments[arguments.index("core")] = "detailed"

    assert main(arguments) == 2
    error = json.loads(capsys.readouterr().err)
    assert error["status"] == "error"
    assert error["error"] == "ValidationError"
    assert "only Core" in error["message"]
