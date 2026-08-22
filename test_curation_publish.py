"""The incremental curation publisher must equal a full rebuild."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from curation_publish import (
    CurationPublishError,
    generated_paths,
    publish_annotations,
    publish_curation,
)

ROOT = Path(__file__).resolve().parent

# A complete guide, so the saved record can reach the reviewed state.
REVIEWED_CURATION = {
    "vibe": "A test vibe.",
    "ideal_use": "A test use.",
    "terrain": ["Test terrain"],
    "difficulty": "Test difficulty.",
    "highlights": ["Test highlight"],
    "caveats": ["Test caveat"],
    "seasonality": "Test seasonality.",
    "editorial_note": "A test note.",
    "review_status": "reviewed",
}


def _without_timestamp(path):
    document = json.loads(path.read_text(encoding="utf-8"))
    document["generated_at"] = "<generated_at>"
    return json.dumps(document, ensure_ascii=False)


def _first_generated_slug():
    manifest = json.loads(
        (ROOT / "app/src/data/generated/routes.manifest.json").read_text(
            encoding="utf-8"
        )
    )
    return str(manifest["routes"][0]["slug"])


class CurationPublishTest(unittest.TestCase):
    def test_incremental_publication_equals_a_full_rebuild(self):
        """The whole justification for this module.

        If the two ever diverge, an incremental save silently corrupts the
        generated data, and no other test would notice.
        """
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)

            config_path = workspace / "quests.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            for route in config["routes"]:
                if str(route["activity_id"]) == slug:
                    route["curation"] = dict(REVIEWED_CURATION)
                    break
            else:
                self.fail(f"route {slug} is not in quests.json")
            config_path.write_text(
                json.dumps(config, indent=2) + "\n", encoding="utf-8"
            )

            publish_curation(workspace, slug, REVIEWED_CURATION)
            incremental = _artifact_text(workspace)

            result = subprocess.run(
                [sys.executable, str(workspace / "build.py")],
                cwd=str(workspace),
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr[-2000:])
            rebuilt = _artifact_text(workspace)

            for name, text in rebuilt.items():
                self.assertEqual(
                    incremental[name],
                    text,
                    f"{name} differs between an incremental save and a rebuild",
                )

    def test_a_route_without_a_generated_record_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)

            with self.assertRaises(CurationPublishError):
                publish_curation(workspace, "not-a-real-route", REVIEWED_CURATION)

    def test_an_invalid_guide_is_refused_before_anything_is_written(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)

            with self.assertRaises(ValueError):
                publish_curation(
                    workspace, slug, {"review_status": "reviewed", "vibe": "only one"}
                )

            self.assertEqual(_artifact_text(workspace), before)


class AnnotationPublishTest(unittest.TestCase):
    ANNOTATIONS = [
        {
            "id": "gate",
            "at_distance_m": 100.0,
            "kind": "landmark",
            "evidence": "hypothesis",
            "title": "The gate",
            "body": "Where the climb starts.",
        }
    ]

    def test_incremental_annotation_publication_equals_a_full_rebuild(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)

            config_path = workspace / "quests.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            for route in config["routes"]:
                if str(route["activity_id"]) == slug:
                    route["annotations"] = [dict(a) for a in self.ANNOTATIONS]
                    break
            config_path.write_text(
                json.dumps(config, indent=2) + "\n", encoding="utf-8"
            )

            publish_annotations(workspace, slug, self.ANNOTATIONS)
            incremental = _artifact_text(workspace)

            result = subprocess.run(
                [sys.executable, str(workspace / "build.py")],
                cwd=str(workspace),
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr[-2000:])
            rebuilt = _artifact_text(workspace)

            for name, text in rebuilt.items():
                self.assertEqual(
                    incremental[name],
                    text,
                    f"{name} differs between an incremental save and a rebuild",
                )

    def test_an_anchor_beyond_the_route_is_refused(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)

            with self.assertRaises(ValueError):
                publish_annotations(
                    workspace,
                    slug,
                    [{**self.ANNOTATIONS[0], "at_distance_m": 9_999_999}],
                )

            self.assertEqual(_artifact_text(workspace), before)


def _copy_workspace(workspace):
    """Copy the files a generation run reads and writes."""
    workspace.mkdir(parents=True)
    for name in (
        "build.py",
        "quests.json",
        "quest_meta.py",
        "route_provenance.py",
        "route_compiler.py",
        "route_imports.py",
        "route_annotations.py",
        "route_timezones.py",
        ".env",
    ):
        source = ROOT / name
        if source.exists():
            shutil.copy2(source, workspace / name)
    shutil.copytree(ROOT / "route_sources", workspace / "route_sources")
    for relative in (
        "app/public/data/routes",
        "app/src/data/generated",
    ):
        shutil.copytree(ROOT / relative, workspace / relative)
    shutil.copy2(
        ROOT / "app/src/data/quests.generated.json",
        workspace / "app/src/data/quests.generated.json",
    )


def _artifact_text(workspace):
    """Read every tracked artifact, with the wall-clock stamp neutralised.

    generated_at records when a file was written, so two runs can never match on
    it. Every other byte must be identical.
    """
    paths = generated_paths(workspace)
    text = {
        "routes.manifest.json": _without_timestamp(paths["manifest"]),
        "quests.generated.json": _without_timestamp(paths["payload"]),
    }
    for detail in sorted(paths["detail"].glob("*.json")):
        text[f"routes/{detail.name}"] = detail.read_text(encoding="utf-8")
    return text


if __name__ == "__main__":
    unittest.main()
