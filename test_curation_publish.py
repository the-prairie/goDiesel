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
    def test_fixed_name_staging_symlinks_are_never_followed(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            paths = generated_paths(workspace)
            external = Path(directory) / "outside.json"
            external.write_text("outside\n", encoding="utf-8")
            traps = [
                paths["detail"] / f".{slug}.json.tmp",
                paths["detail"] / f".{slug}.json.rollback",
                paths["manifest"].with_name(".routes.manifest.json.tmp"),
                paths["manifest"].with_name(".routes.manifest.json.rollback"),
            ]
            for trap in traps:
                trap.symlink_to(external)

            publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertEqual(external.read_text(encoding="utf-8"), "outside\n")
            self.assertTrue(all(trap.is_symlink() for trap in traps))

    def test_generated_target_symlink_is_rejected_without_external_write(self):
        slug = _first_generated_slug()
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "checkout"
            _copy_workspace(workspace)
            detail = generated_paths(workspace)["detail"] / f"{slug}.json"
            external = Path(directory) / "outside.json"
            original = detail.read_bytes()
            external.write_bytes(original)
            detail.unlink()
            detail.symlink_to(external)

            with self.assertRaises(OSError):
                publish_curation(workspace, slug, REVIEWED_CURATION)

            self.assertTrue(detail.is_symlink())
            self.assertEqual(external.read_bytes(), original)

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
            real_write_text = curation_publish.write_local_text_atomic
            failed = False

            def write_part_then_fail(root, directory, name, content):
                nonlocal failed
                result = real_write_text(root, directory, name, content)
                if name.endswith(".tmp") and not failed:
                    failed = True
                    raise OSError("injected partial staging write")
                return result

            with mock.patch.object(
                curation_publish,
                "write_local_text_atomic",
                side_effect=write_part_then_fail,
            ):
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
            real_write_bytes = curation_publish.write_local_bytes_atomic
            failed = False

            def write_part_then_fail(root, directory, name, content):
                nonlocal failed
                result = real_write_bytes(root, directory, name, content)
                if name.endswith(".rollback") and not failed:
                    failed = True
                    raise OSError("injected partial backup write")
                return result

            with mock.patch.object(
                curation_publish,
                "write_local_bytes_atomic",
                side_effect=write_part_then_fail,
            ):
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
            real_replace = curation_publish.replace_local_file
            failed = False

            def fail_first_publication(root, directory, source, destination):
                nonlocal failed
                if source.endswith(".tmp") and not failed:
                    failed = True
                    raise OSError("injected first-replace failure")
                return real_replace(root, directory, source, destination)

            with mock.patch.object(
                curation_publish,
                "replace_local_file",
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
            real_replace = curation_publish.replace_local_file
            publication_replaces = 0

            def fail_second_publication(root, directory, source, destination):
                nonlocal publication_replaces
                if source.endswith(".tmp"):
                    publication_replaces += 1
                    if publication_replaces == 2:
                        raise OSError("injected second-replace failure")
                return real_replace(root, directory, source, destination)

            with mock.patch.object(
                curation_publish,
                "replace_local_file",
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
            real_replace = curation_publish.replace_local_file
            publication_replaces = 0

            def fail_publication_and_rollback(root, directory, source, destination):
                nonlocal publication_replaces
                if source.endswith(".tmp"):
                    publication_replaces += 1
                    if publication_replaces == 2:
                        raise OSError("injected second-replace failure")
                if source.endswith(".rollback"):
                    raise OSError("injected rollback failure")
                return real_replace(root, directory, source, destination)

            with mock.patch.object(
                curation_publish,
                "replace_local_file",
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
            real_unlink = curation_publish.unlink_local_file
            failed = False

            def fail_one_cleanup(root, directory, name, *, missing_ok):
                nonlocal failed
                if (
                    name.endswith((".tmp", ".rollback"))
                    and not failed
                ):
                    failed = True
                    raise OSError("injected post-commit cleanup failure")
                return real_unlink(root, directory, name, missing_ok=missing_ok)

            with mock.patch.object(
                curation_publish,
                "unlink_local_file",
                side_effect=fail_one_cleanup,
            ):
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
            real_write_text = curation_publish.write_local_text_atomic
            real_unlink = curation_publish.unlink_local_file
            staging_writes = 0
            cleanup_calls = []

            def fail_second_staging_write(root, directory, name, content):
                nonlocal staging_writes
                result = real_write_text(root, directory, name, content)
                if name.endswith(".tmp"):
                    staging_writes += 1
                    if staging_writes == 2:
                        raise OSError("injected partial staging failure")
                return result

            def fail_first_cleanup(root, directory, name, *, missing_ok):
                if name.endswith(".tmp"):
                    path = Path(root) / directory / name
                    cleanup_calls.append(path)
                    if len(cleanup_calls) == 1:
                        raise OSError("injected cleanup failure")
                return real_unlink(root, directory, name, missing_ok=missing_ok)

            with (
                mock.patch.object(
                    curation_publish,
                    "write_local_text_atomic",
                    side_effect=fail_second_staging_write,
                ),
                mock.patch.object(
                    curation_publish,
                    "unlink_local_file",
                    side_effect=fail_first_cleanup,
                ),
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
