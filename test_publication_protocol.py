import itertools
import subprocess
import sys

import pytest

from publication_protocol import (
    GeneratorPublicationActive,
    JournalMarkers,
    collect_generator_leftovers,
    generator_lock,
    generator_markers,
    hold_generator_lock,
    journal_markers,
    publication_disposition,
    release_generator_lock,
    retire_journal,
)


def expected_disposition(exists, ready, committed, live):
    """The rule, written out once so the table below is checked against it."""
    if not exists:
        return "none"
    if live:
        return "blocked"
    if committed:
        return "committed-cleanup"
    if ready:
        return "restore"
    return "discard"


# Every combination of the four facts recovery can observe on disk.
TRUTH_TABLE = [
    # exists, ready, committed, live -> disposition
    (False, False, False, False, "none"),
    (False, False, False, True, "none"),
    (False, False, True, False, "none"),
    (False, False, True, True, "none"),
    (False, True, False, False, "none"),
    (False, True, False, True, "none"),
    (False, True, True, False, "none"),
    (False, True, True, True, "none"),
    (True, False, False, False, "discard"),
    (True, False, False, True, "blocked"),
    (True, False, True, False, "committed-cleanup"),
    (True, False, True, True, "blocked"),
    (True, True, False, False, "restore"),
    (True, True, False, True, "blocked"),
    (True, True, True, False, "committed-cleanup"),
    (True, True, True, True, "blocked"),
]


def test_truth_table_covers_every_marker_combination():
    assert sorted(row[:4] for row in TRUTH_TABLE) == sorted(
        itertools.product((False, True), repeat=4)
    )
    assert all(expected_disposition(*row[:4]) == row[4] for row in TRUTH_TABLE)


@pytest.mark.parametrize("exists,ready,committed,live,disposition", TRUTH_TABLE)
def test_publication_disposition(exists, ready, committed, live, disposition):
    markers = JournalMarkers(exists=exists, ready=ready, committed=committed, live=live)
    assert publication_disposition(markers) == disposition


def test_disposition_is_pure_and_markers_are_immutable():
    markers = JournalMarkers(exists=True, ready=True)
    assert publication_disposition(markers) == publication_disposition(markers) == "restore"
    with pytest.raises(AttributeError):
        markers.ready = False


# The IO around the rule: markers observed on disk, the generator lock, and
# retirement by rename-then-delete.


def test_journal_markers_reads_only_existing_journals(tmp_path):
    journal = tmp_path / "journal"
    assert journal_markers(journal, live=True) == JournalMarkers(exists=False)
    journal.mkdir()
    (journal / "committed").touch()
    assert journal_markers(journal) == JournalMarkers(exists=True, committed=True)


def test_retire_journal_renames_before_deleting(tmp_path, monkeypatch):
    import shutil

    journal = tmp_path / ".route-generation-backup"
    (journal / "routes").mkdir(parents=True)
    (journal / "ready").touch()
    deleted = []
    monkeypatch.setattr(shutil, "rmtree", lambda path, **_: deleted.append(path))
    retire_journal(journal)
    assert not journal.exists()
    assert len(deleted) == 1 and deleted[0].name.startswith(".route-generation-backup.cleanup-")
    assert (deleted[0] / "ready").exists()


def hold_in_child(path):
    child = subprocess.Popen([sys.executable, "-c", '''import fcntl, os, sys
descriptor = os.open(sys.argv[1], os.O_RDONLY)
fcntl.flock(descriptor, fcntl.LOCK_EX)
print("held", flush=True)
sys.stdin.read()''', str(path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    assert child.stdout.readline().strip() == "held"
    return child


def test_generator_lock_is_exclusive_across_processes(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    backup = data / ".route-generation-backup"
    backup.mkdir()
    child = hold_in_child(data)
    try:
        assert not hold_generator_lock(data)
        assert generator_markers(backup).live
        with pytest.raises(GeneratorPublicationActive, match="another generator run"):
            with generator_lock(data):
                raise AssertionError("must not enter")
    finally:
        child.communicate("")
    assert not generator_markers(backup).live
    with generator_lock(data):
        assert not generator_markers(backup).live
    assert hold_generator_lock(data)
    release_generator_lock(data)


def test_leftovers_are_collected_only_under_the_generator_lock(tmp_path):
    details = tmp_path / "app/public/data/routes"
    details.mkdir(parents=True)
    staging = details.parent / ".routes-staging-live"
    staging.mkdir()
    with pytest.raises(RuntimeError, match="requires the generator lock"):
        collect_generator_leftovers(details.parent / ".route-generation-backup",
                                    details, (), tmp_path)
    assert staging.exists()
