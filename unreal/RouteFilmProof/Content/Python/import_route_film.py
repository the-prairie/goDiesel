"""Build the continuous Unreal Level Sequence from a portable route-film manifest.

Run this inside Unreal Editor after opening RouteFilmWorld. The scene must contain
exactly one CesiumGeoreference and one Google Photorealistic 3D Tiles actor.
"""

from __future__ import annotations

import argparse

import unreal

from route_film_contract import load_manifest


def _actors_of_class_name(class_name: str) -> list[unreal.Actor]:
    return [
        actor
        for actor in unreal.EditorLevelLibrary.get_all_level_actors()
        if actor.get_class().get_name() == class_name
    ]


def _require_scene_actor(class_name: str) -> unreal.Actor:
    actors = _actors_of_class_name(class_name)
    if len(actors) != 1:
        raise RuntimeError(
            f"RouteFilmWorld requires exactly one {class_name}; found {len(actors)}"
        )
    return actors[0]


def _unreal_position(georeference: unreal.Actor, position: dict[str, float]):
    coordinates = unreal.Vector(
        position["longitude"], position["latitude"], position["heightM"]
    )
    transform = getattr(
        georeference,
        "transform_longitude_latitude_height_position_to_unreal",
        None,
    )
    if transform is None:
        raise RuntimeError(
            "CesiumGeoreference does not expose the expected WGS84 transform method"
        )
    return transform(coordinates)


def _add_vector_keys(channels, frame: int, values) -> None:
    for channel, value in zip(channels, values):
        channel.add_key(unreal.FrameNumber(frame), float(value))


def import_sequence(manifest_path: str) -> str:
    manifest = load_manifest(manifest_path)
    route_slug = manifest["route"]["slug"]
    georeference = _require_scene_actor("CesiumGeoreference")
    _require_scene_actor("Cesium3DTileset")

    camera = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.CineCameraActor, unreal.Vector(), unreal.Rotator()
    )
    camera.set_actor_label(f"RouteFilmCamera_{route_slug}")

    sequence_name = f"RouteFilm_{route_slug}"
    package_path = "/Game/RouteFilmProof/Sequences"
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    existing = unreal.load_asset(f"{package_path}/{sequence_name}")
    if existing:
        unreal.EditorAssetLibrary.delete_asset(f"{package_path}/{sequence_name}")
    sequence = asset_tools.create_asset(
        sequence_name,
        package_path,
        unreal.LevelSequence,
        unreal.LevelSequenceFactoryNew(),
    )
    fps = manifest["render"]["fps"]
    frame_count = manifest["render"]["frameCount"]
    sequence.set_display_rate(unreal.FrameRate(fps, 1))
    sequence.set_playback_start(0)
    sequence.set_playback_end(frame_count)

    binding = sequence.add_possessable(camera)
    transform_track = binding.add_track(unreal.MovieScene3DTransformTrack)
    transform_section = transform_track.add_section()
    transform_section.set_range(0, frame_count)
    channels = transform_section.get_channels()

    lens_track = binding.add_track(unreal.MovieSceneFloatTrack)
    lens_track.set_property_name_and_path("CurrentFocalLength", "CurrentFocalLength")
    lens_section = lens_track.add_section()
    lens_section.set_range(0, frame_count)
    lens_channel = lens_section.get_channels()[0]

    for keyframe in manifest["camera"]["keyframes"]:
        frame = keyframe["frame"]
        eye = _unreal_position(georeference, keyframe["eye"])
        target = _unreal_position(georeference, keyframe["target"])
        rotation = unreal.MathLibrary.find_look_at_rotation(eye, target)
        _add_vector_keys(channels[0:3], frame, (eye.x, eye.y, eye.z))
        _add_vector_keys(
            channels[3:6], frame, (rotation.roll, rotation.pitch, rotation.yaw)
        )
        _add_vector_keys(channels[6:9], frame, (1.0, 1.0, 1.0))
        lens_channel.add_key(unreal.FrameNumber(frame), keyframe["lensMm"])

    cuts = sequence.add_master_track(unreal.MovieSceneCameraCutTrack)
    cut = cuts.add_section()
    cut.set_range(0, frame_count)
    cut.set_camera_binding_id(unreal.MovieSceneObjectBindingID(binding.get_id()))

    unreal.EditorAssetLibrary.save_loaded_asset(sequence)
    unreal.log(f"Imported {len(manifest['camera']['keyframes'])} camera keyframes")
    return f"{package_path}/{sequence_name}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    args = parser.parse_args()
    print(import_sequence(args.manifest))


if __name__ == "__main__":
    main()
