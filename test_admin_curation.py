import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import admin_curation

from admin_curation import (
    SourceRollbackError,
    curation_readiness,
    publish_curation_or_rebuild,
    save_curation_and_rebuild,
    update_route_curation,
)
from curation_publish import CurationPublishError, CurationRecoveryError


COMPLETE_CURATION = {
    "vibe": "Quiet lanes opening into a sustained climb.",
    "ideal_use": "A cool day with time to explore.",
    "terrain": ["Paved lanes", "Hills"],
    "difficulty": "Demanding",
    "highlights": ["Temple district"],
    "caveats": ["Frequent road crossings"],
    "seasonality": "Best in cool, dry weather.",
    "editorial_note": "Preserved for its city-to-hills contrast.",
    "review_status": "reviewed",
}


class AdminCurationTests(unittest.TestCase):
    def test_readiness_distinguishes_incomplete_draft_from_reviewed_guide(self):
        draft = curation_readiness({
            "vibe": "Riverside miles.",
            "review_status": "draft",
        })
        reviewed = curation_readiness(COMPLETE_CURATION)

        self.assertEqual(draft["status"], "draft")
        self.assertFalse(draft["complete"])
        self.assertIn("ideal_use", draft["missing_fields"])
        self.assertEqual(reviewed, {
            "status": "reviewed",
            "complete": True,
            "missing_fields": [],
            "error": None,
        })

    def test_update_changes_only_the_selected_route(self):
        config = {
            "routes": [
                {"activity_id": "one", "status": "approved"},
                {"activity_id": "two", "status": "approved", "region": "Kyoto"},
            ]
        }

        updated = update_route_curation(config, "one", COMPLETE_CURATION)

        self.assertNotIn("curation", config["routes"][0])
        self.assertEqual(updated["routes"][0]["curation"], COMPLETE_CURATION)
        self.assertEqual(updated["routes"][1], config["routes"][1])

    def test_save_regenerates_outputs_and_preserves_unrelated_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "quests.json"
            manifest_path = root / "routes.manifest.json"
            detail_path = root / "one.json"
            config = {
                "routes": [
                    {"activity_id": "one", "status": "approved"},
                    {"activity_id": "two", "status": "pending", "region": "Elsewhere"},
                ]
            }
            config_path.write_text(json.dumps(config), encoding="utf-8")

            def rebuild():
                current = json.loads(config_path.read_text(encoding="utf-8"))
                selected = current["routes"][0]
                manifest_path.write_text(
                    json.dumps({"routes": [{"slug": "one", "guide_preview": {
                        "vibe": selected["curation"]["vibe"],
                        "review_status": selected["curation"]["review_status"],
                    }}]}),
                    encoding="utf-8",
                )
                detail_path.write_text(json.dumps(selected), encoding="utf-8")

            save_curation_and_rebuild(
                config_path, "one", COMPLETE_CURATION, rebuild
            )

            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["routes"][1], config["routes"][1])
            self.assertEqual(
                json.loads(manifest_path.read_text())["routes"][0]["guide_preview"]["review_status"],
                "reviewed",
            )
            self.assertEqual(
                json.loads(detail_path.read_text())["curation"], COMPLETE_CURATION
            )

    def test_failed_rebuild_rolls_back_the_source_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "quests.json"
            original = {"routes": [{"activity_id": "one", "status": "approved"}]}
            config_path.write_text(json.dumps(original), encoding="utf-8")

            def fail():
                raise RuntimeError("build failed")

            with self.assertRaisesRegex(RuntimeError, "build failed"):
                save_curation_and_rebuild(config_path, "one", COMPLETE_CURATION, fail)

            self.assertEqual(json.loads(config_path.read_text()), original)

    def test_incomplete_publication_recovery_does_not_start_a_full_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "quests.json"
            recovery_path = root / ".one.json.rollback"
            original = {"routes": [{"activity_id": "one", "status": "approved"}]}
            config_path.write_text(json.dumps(original), encoding="utf-8")
            recovery_path.write_text("recoverable prior detail", encoding="utf-8")
            full_rebuild_started = False

            def publish():
                raise CurationRecoveryError(
                    f"publication and rollback failed; recovery copies: {recovery_path}"
                )

            def full_rebuild():
                nonlocal full_rebuild_started
                full_rebuild_started = True

            with self.assertRaisesRegex(
                CurationRecoveryError,
                str(recovery_path),
            ):
                save_curation_and_rebuild(
                    config_path,
                    "one",
                    COMPLETE_CURATION,
                    lambda: publish_curation_or_rebuild(publish, full_rebuild),
                )

            self.assertEqual(json.loads(config_path.read_text()), original)
            self.assertFalse(full_rebuild_started)
            self.assertEqual(
                recovery_path.read_text(encoding="utf-8"),
                "recoverable prior detail",
            )

    def test_recoverable_incremental_failure_uses_the_full_rebuild(self):
        full_rebuild_started = False

        def publish():
            raise CurationPublishError("generated route is missing")

        def full_rebuild():
            nonlocal full_rebuild_started
            full_rebuild_started = True

        publish_curation_or_rebuild(publish, full_rebuild)

        self.assertTrue(full_rebuild_started)

    def test_failed_source_rollback_preserves_and_reports_its_recovery_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "quests.json"
            recovery_path = root / ".quests.json.rollback"
            original = {"routes": [{"activity_id": "one", "status": "approved"}]}
            config_path.write_text(json.dumps(original), encoding="utf-8")
            real_replace = admin_curation.os.replace

            def fail_source_restore(source, destination):
                if Path(source) == recovery_path:
                    raise OSError("injected source rollback failure")
                return real_replace(source, destination)

            def fail_publication():
                raise CurationRecoveryError("injected generated recovery failure")

            with mock.patch.object(
                admin_curation.os,
                "replace",
                side_effect=fail_source_restore,
            ):
                with self.assertRaises(SourceRollbackError) as caught:
                    save_curation_and_rebuild(
                        config_path,
                        "one",
                        COMPLETE_CURATION,
                        fail_publication,
                    )

            message = str(caught.exception)
            self.assertIn("injected generated recovery failure", message)
            self.assertIn("injected source rollback failure", message)
            self.assertIn(str(recovery_path), message)
            self.assertEqual(json.loads(recovery_path.read_text()), original)
            current = json.loads(config_path.read_text())
            self.assertEqual(current["routes"][0]["curation"], COMPLETE_CURATION)


if __name__ == "__main__":
    unittest.main()
