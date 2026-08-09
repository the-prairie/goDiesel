"""Annotations are anchored to the recorded route, and must stay honest."""

import unittest

from route_annotations import build_route_annotations


def annotation(**overrides):
    base = {
        "id": "start-gate",
        "at_distance_m": 120.0,
        "kind": "landmark",
        "evidence": "recorded",
        "body": "The gate at the start of the climb.",
    }
    base.update(overrides)
    return base


class BuildRouteAnnotationsTest(unittest.TestCase):
    def test_no_annotations_is_an_empty_list(self):
        self.assertEqual(build_route_annotations(None, 1000), [])

    def test_a_valid_annotation_is_normalized(self):
        result = build_route_annotations([annotation(body="  padded  ")], 1000)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["body"], "padded")
        self.assertEqual(result[0]["at_distance_m"], 120.0)

    def test_annotations_are_ordered_by_distance_travelled(self):
        result = build_route_annotations(
            [
                annotation(id="third", at_distance_m=900),
                annotation(id="first", at_distance_m=10),
                annotation(id="second", at_distance_m=500),
            ],
            1000,
        )

        self.assertEqual([a["id"] for a in result], ["first", "second", "third"])

    def test_an_anchor_beyond_the_route_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(at_distance_m=1500)], 1000)

    def test_a_negative_anchor_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(at_distance_m=-1)], 1000)

    def test_an_unknown_evidence_label_is_refused(self):
        """CONTEXT.md section 4 fixes the four labels."""
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(evidence="probably")], 1000)

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(kind="rant")], 1000)

    def test_an_unknown_field_is_refused_rather_than_ignored(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(caption="silently dropped")], 1000)

    def test_an_empty_body_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(body="   ")], 1000)

    def test_a_duplicated_id_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations(
                [annotation(id="same"), annotation(id="same", at_distance_m=200)], 1000
            )

    def test_a_boolean_is_not_a_distance(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(at_distance_m=True)], 1000)

    def test_the_start_and_the_finish_are_valid_anchors(self):
        result = build_route_annotations(
            [
                annotation(id="start", at_distance_m=0),
                annotation(id="finish", at_distance_m=1000),
            ],
            1000,
        )

        self.assertEqual([a["id"] for a in result], ["start", "finish"])


if __name__ == "__main__":
    unittest.main()


class AnnotationMediaTest(unittest.TestCase):
    MEDIA = {
        "url": "media/route-1/abc.jpg",
        "thumb_url": "media/route-1/abc-thumb.jpg",
        "width": 1600,
        "height": 1067,
    }

    def test_an_image_annotation_carries_published_media(self):
        result = build_route_annotations(
            [annotation(kind="image", media=dict(self.MEDIA))], 1000
        )

        self.assertEqual(result[0]["media"]["width"], 1600)

    def test_an_image_annotation_without_media_is_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations([annotation(kind="image")], 1000)

    def test_media_must_point_at_a_published_path(self):
        """Never reference a file outside the published media directory."""
        with self.assertRaises(ValueError):
            build_route_annotations(
                [
                    annotation(
                        kind="image",
                        media={**self.MEDIA, "url": "/Users/someone/Photos/IMG.HEIC"},
                    )
                ],
                1000,
            )

    def test_unknown_media_fields_are_refused(self):
        with self.assertRaises(ValueError):
            build_route_annotations(
                [annotation(kind="image", media={**self.MEDIA, "lat": 35.6})], 1000
            )
