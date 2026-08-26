from pathlib import Path

from scripts import publish_reference_world_packs
from scripts.publish_reference_world_packs import CORPUS_PATH, ROOT
from world_packs.verification import verify_pack


def test_reference_publication_inputs_are_fixed_inside_the_repository():
    assert ROOT == Path(__file__).resolve().parent
    assert CORPUS_PATH == ROOT / "docs/world-packs/reference-corpus.json"
    assert CORPUS_PATH.is_file()


def test_reference_publication_script_has_no_network_adapter():
    source = (ROOT / "scripts/publish_reference_world_packs.py").read_text()
    assert "requests" not in source
    assert "urllib" not in source
    assert "http://" not in source
    assert "https://" not in source


def test_reference_publication_preserves_previous_sealed_versions(
    tmp_path: Path, monkeypatch
):
    public_root = tmp_path / "world-packs"
    legacy = public_root / "tokyo-urban/wp_previous-version"
    legacy.mkdir(parents=True)
    marker = legacy / "sealed-marker"
    marker.write_bytes(b"previous sealed bytes")
    monkeypatch.setattr(publish_reference_world_packs, "PUBLIC_ROOT", public_root)

    publish_reference_world_packs.publish()

    assert marker.read_bytes() == b"previous sealed bytes"
    assert (public_root / "index.json").is_file()
    assert not list(tmp_path.glob(".world-packs-publish-*"))


def test_first_published_v1_pack_remains_verifiable():
    first_tokyo = (
        ROOT
        / "app/public/world-packs/tokyo-urban"
        / "wp_d14982d9c6ea7014abe3b0ebfe9d6dfe0afebe66eb7c70a796790a5471740a85"
    )

    assert verify_pack(first_tokyo).status == "complete"
