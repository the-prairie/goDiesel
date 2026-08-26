from pathlib import Path

from scripts.publish_reference_world_packs import CORPUS_PATH, ROOT


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
