"""The incremental curation publisher must equal a full rebuild."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import curation_publish

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

    def test_a_partial_staging_write_is_cleaned_without_publishing(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)
            real_write_text = Path.write_text
            failed = False

            def write_part_then_fail(path, content, *args, **kwargs):
                nonlocal failed
                if path.name.endswith(".tmp") and not failed:
                    failed = True
                    real_write_text(path, content[:16], *args, **kwargs)
                    raise OSError("injected partial staging write")
                return real_write_text(path, content, *args, **kwargs)

            with mock.patch.object(Path, "write_text", new=write_part_then_fail):
                with self.assertRaisesRegex(OSError, "partial staging write"):
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(_artifact_text(workspace), before)
            self.assertFalse(list(workspace.rglob("*.tmp")))

    def test_a_partial_backup_write_is_cleaned_without_publishing(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)
            real_write_bytes = Path.write_bytes
            failed = False

            def write_part_then_fail(path, content):
                nonlocal failed
                if path.name.endswith(".rollback") and not failed:
                    failed = True
                    real_write_bytes(path, content[:16])
                    raise OSError("injected partial backup write")
                return real_write_bytes(path, content)

            with mock.patch.object(Path, "write_bytes", new=write_part_then_fail):
                with self.assertRaisesRegex(OSError, "partial backup write"):
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(_artifact_text(workspace), before)
            self.assertFalse(list(workspace.rglob("*.rollback")))
            self.assertFalse(list(workspace.rglob("*.tmp")))

    def test_a_failed_first_replace_changes_no_artifact(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)
            real_replace = curation_publish.os.replace
            failed = False

            def fail_first_publication(source, destination):
                nonlocal failed
                if Path(source).name.endswith(".tmp") and not failed:
                    failed = True
                    raise OSError("injected first-replace failure")
                return real_replace(source, destination)

            with mock.patch.object(
                curation_publish.os,
                "replace",
                side_effect=fail_first_publication,
            ):
                with self.assertRaisesRegex(OSError, "first-replace failure"):
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(_artifact_text(workspace), before)
            self.assertFalse(list(workspace.rglob("*.rollback")))
            self.assertFalse(list(workspace.rglob("*.tmp")))

    def test_a_failed_second_replace_restores_every_artifact(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)
            real_replace = curation_publish.os.replace
            publication_replaces = 0

            def fail_second_publication(source, destination):
                nonlocal publication_replaces
                if Path(source).name.endswith(".tmp"):
                    publication_replaces += 1
                    if publication_replaces == 2:
                        raise OSError("injected second-replace failure")
                return real_replace(source, destination)

            with mock.patch.object(
                curation_publish.os,
                "replace",
                side_effect=fail_second_publication,
            ):
                with self.assertRaisesRegex(OSError, "injected second-replace"):
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(_artifact_text(workspace), before)
            self.assertFalse(list(workspace.rglob("*.rollback")))
            self.assertFalse(list(workspace.rglob("*.tmp")))

    def test_a_failed_rollback_preserves_and_reports_the_recovery_copy(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            paths = generated_paths(workspace)
            detail_path = paths["detail"] / f"{slug}.json"
            original_detail = detail_path.read_bytes()
            real_replace = curation_publish.os.replace
            publication_replaces = 0

            def fail_publication_and_rollback(source, destination):
                nonlocal publication_replaces
                source = Path(source)
                if source.name.endswith(".tmp"):
                    publication_replaces += 1
                    if publication_replaces == 2:
                        raise OSError("injected second-replace failure")
                if source.name.endswith(".rollback"):
                    raise OSError("injected rollback failure")
                return real_replace(source, destination)

            with mock.patch.object(
                curation_publish.os,
                "replace",
                side_effect=fail_publication_and_rollback,
            ):
                with self.assertRaises(CurationPublishError) as caught:
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            message = str(caught.exception)
            self.assertIn("injected second-replace failure", message)
            self.assertIn("injected rollback failure", message)
            recovery_copies = list(workspace.rglob("*.rollback"))
            self.assertEqual(len(recovery_copies), 1)
            self.assertEqual(recovery_copies[0].read_bytes(), original_detail)
            self.assertIn(str(recovery_copies[0]), message)
            self.assertFalse(list(workspace.rglob("*.tmp")))

    def test_cleanup_failure_after_commit_does_not_report_publication_failure(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            real_unlink = Path.unlink
            failed = False

            def fail_one_cleanup(path, *args, **kwargs):
                nonlocal failed
                if (
                    path.name.endswith((".tmp", ".rollback"))
                    and not failed
                ):
                    failed = True
                    raise OSError("injected post-commit cleanup failure")
                return real_unlink(path, *args, **kwargs)

            with mock.patch.object(Path, "unlink", new=fail_one_cleanup):
                result = publish_curation(
                    workspace,
                    slug,
                    REVIEWED_CURATION,
                )

            self.assertEqual(result, REVIEWED_CURATION)
            paths = generated_paths(workspace)
            detail = json.loads(
                (paths["detail"] / f"{slug}.json").read_text(encoding="utf-8")
            )
            manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
            summary = next(route for route in manifest["routes"] if route["slug"] == slug)
            self.assertEqual(detail["curation"], REVIEWED_CURATION)
            self.assertEqual(summary["guide_preview"]["review_status"], "reviewed")

    def test_cleanup_failure_does_not_mask_staging_failure_or_stop_cleanup(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            before = _artifact_text(workspace)
            real_write_text = Path.write_text
            real_unlink = Path.unlink
            staging_writes = 0
            cleanup_calls = []

            def fail_second_staging_write(path, content, *args, **kwargs):
                nonlocal staging_writes
                if path.name.endswith(".tmp"):
                    staging_writes += 1
                    if staging_writes == 2:
                        real_write_text(path, content[:16], *args, **kwargs)
                        raise OSError("injected partial staging failure")
                return real_write_text(path, content, *args, **kwargs)

            def fail_first_cleanup(path, *args, **kwargs):
                if path.name.endswith(".tmp"):
                    cleanup_calls.append(path)
                    if len(cleanup_calls) == 1:
                        raise OSError("injected cleanup failure")
                return real_unlink(path, *args, **kwargs)

            with (
                mock.patch.object(Path, "write_text", new=fail_second_staging_write),
                mock.patch.object(Path, "unlink", new=fail_first_cleanup),
            ):
                with self.assertRaisesRegex(OSError, "partial staging failure"):
                    publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(_artifact_text(workspace), before)
            self.assertEqual(len(cleanup_calls), 2)
            leftovers = list(workspace.rglob("*.tmp"))
            self.assertEqual(leftovers, [cleanup_calls[0]])


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


def _artifact_text(workspace):
    """Read every tracked artifact, with the wall-clock stamp neutralised.

    generated_at records when a file was written, so two runs can never match on
    it. Every other byte must be identical.
    """
    paths = generated_paths(workspace)
    text = {
        "routes.manifest.json": _without_timestamp(paths["manifest"]),
    }
    for detail in sorted(paths["detail"].glob("*.json")):
        text[f"routes/{detail.name}"] = detail.read_text(encoding="utf-8")
    return text


if __name__ == "__main__":
    unittest.main()
