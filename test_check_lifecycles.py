"""scripts/check-lifecycles.mjs keeps the lifecycle registry and the code in step.

Each test builds a small synthetic repository, runs the real checker against it
with --root, and reads the exit status and message. The last test runs the
checker against this repository.
"""

import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).parent
CHECKER = ROOT / "scripts" / "check-lifecycles.mjs"
SCHEMA = ROOT / "docs" / "architecture" / "lifecycles.schema.json"

DOC = """# Lifecycles

Prose before.

<!-- BEGIN GENERATED: lifecycles.json -->
<!-- END GENERATED: lifecycles.json -->

Prose after.
"""


def run(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", str(CHECKER), "--root", str(root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def reducer_entry(**overrides) -> dict:
    entry = {
        "id": "foo-load",
        "kind": "reducer",
        "area": "react-app",
        "summary": "Loads foo.",
        "module": "app/src/foo/foo-state.ts",
        "transition": "reduceFoo",
        "test": ["app/src/foo/foo-state.test.ts"],
        "adapters": ["app/src/foo/foo-page.tsx"],
        "states": ["idle", "loading"],
        "identity": "requestId",
    }
    entry.update(overrides)
    return entry


class Fixture:
    def __init__(self, tmp_path: Path):
        self.root = tmp_path / "repo"
        self.registry_path = self.root / "docs" / "architecture" / "lifecycles.json"
        self.doc_path = self.root / "docs" / "architecture" / "state-machines.md"
        shutil.copyfile(SCHEMA, self._mkparent(self.root / "docs" / "architecture" / "lifecycles.schema.json"))
        write(self.doc_path, DOC)
        write(
            self.root / "app" / "src" / "foo" / "foo-state.ts",
            'export type FooState = { phase: "idle" } | { phase: "loading"; requestId: number };\n'
            "export function reduceFoo(state: FooState): FooState {\n  return state;\n}\n",
        )
        write(
            self.root / "app" / "src" / "foo" / "foo-state.test.ts",
            'import { reduceFoo } from "./foo-state";\nreduceFoo({ phase: "idle" });\n',
        )
        write(self.root / "app" / "src" / "foo" / "foo-page.tsx", "export {};\n")
        write(self.root / "admin-ui" / "README.md", "standalone admin\n")
        self.entries = [reducer_entry()]

    @staticmethod
    def _mkparent(path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def save(self) -> None:
        write(
            self.registry_path,
            json.dumps(
                {"$schema": "./lifecycles.schema.json", "lifecycles": self.entries},
                indent=2,
            )
            + "\n",
        )

    def regenerate(self) -> None:
        self.save()
        result = run(self.root, "--write")
        assert result.returncode == 0, result.stdout + result.stderr

    def check(self) -> subprocess.CompletedProcess:
        return run(self.root)


def test_a_registry_that_matches_the_code_passes(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()

    result = fixture.check()

    assert result.returncode == 0, result.stdout + result.stderr
    assert "foo-load" in fixture.doc_path.read_text()
    assert "Prose before." in fixture.doc_path.read_text()
    assert "Prose after." in fixture.doc_path.read_text()


def test_an_unregistered_state_module_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()
    write(
        fixture.root / "admin-ui" / "bar-state.ts",
        "export function reduceBar(state: number): number {\n  return state;\n}\n",
    )

    result = fixture.check()

    assert result.returncode == 1
    assert "admin-ui/bar-state.ts" in result.stderr


def test_state_module_tests_and_generated_output_need_no_entry(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()
    write(fixture.root / "admin-ui" / "generated" / "baz-state.ts", "export {};\n")
    write(fixture.root / "app" / "src" / "foo" / "other-state.test.ts", "export {};\n")
    write(fixture.root / "app" / "node_modules" / "x" / "dep-state.ts", "export {};\n")

    result = fixture.check()

    assert result.returncode == 0, result.stdout + result.stderr


def test_an_exported_reducer_outside_a_state_module_must_be_registered(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()
    write(
        fixture.root / "app" / "src" / "foo" / "store.ts",
        "export function reduceStore(state: number): number {\n  return state;\n}\n",
    )

    result = fixture.check()

    assert result.returncode == 1
    assert "reduceStore" in result.stderr


def test_a_transition_that_is_not_exported_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.entries = [reducer_entry(transition="reduceMissing")]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "reduceMissing" in result.stderr


def test_a_private_function_is_not_an_exported_transition(tmp_path):
    fixture = Fixture(tmp_path)
    write(
        fixture.root / "app" / "src" / "foo" / "foo-state.ts",
        'export type FooState = { phase: "idle" | "loading" };\n'
        "function reduceFoo(state: FooState): FooState {\n  return state;\n}\n",
    )
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "reduceFoo" in result.stderr


def test_a_missing_test_file_fails(tmp_path):
    fixture = Fixture(tmp_path)
    (fixture.root / "app" / "src" / "foo" / "foo-state.test.ts").unlink()
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "foo-state.test.ts" in result.stderr


def test_a_test_that_never_names_the_transition_fails(tmp_path):
    fixture = Fixture(tmp_path)
    write(fixture.root / "app" / "src" / "foo" / "foo-state.test.ts", "it('works', () => {});\n")
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "reduceFoo" in result.stderr


def test_a_missing_module_or_adapter_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.entries = [reducer_entry(adapters=["app/src/foo/gone.tsx"])]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "app/src/foo/gone.tsx" in result.stderr


def test_a_state_name_absent_from_the_module_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.entries = [reducer_entry(states=["idle", "settled"])]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "settled" in result.stderr


def test_duplicate_ids_fail(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.entries = [reducer_entry(), reducer_entry()]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "duplicate" in result.stderr.lower()


def test_a_left_implicit_entry_without_a_reason_fails_the_schema(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.entries = [
        reducer_entry(),
        {
            "id": "foo-latch",
            "kind": "left-implicit",
            "area": "react-app",
            "summary": "A latch.",
            "module": "app/src/foo/foo-page.tsx",
            "adapters": [],
            "identity": None,
        },
    ]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "reason" in result.stderr


def test_a_reducer_without_a_transition_fails_the_schema(tmp_path):
    fixture = Fixture(tmp_path)
    entry = reducer_entry()
    del entry["transition"]
    fixture.entries = [entry]
    fixture.save()

    result = fixture.check()

    assert result.returncode == 1
    assert "transition" in result.stderr


def test_python_dispositions_need_a_top_level_def_and_a_test_that_names_it(tmp_path):
    fixture = Fixture(tmp_path)
    write(
        fixture.root / "recovery.py",
        'Disposition = Literal["none", "restore"]\n\n'
        "def publication_disposition(markers):\n    return 'none'\n",
    )
    write(fixture.root / "test_recovery.py", "from recovery import publication_disposition\n")
    fixture.entries = [
        reducer_entry(),
        reducer_entry(
            id="recovery",
            kind="disposition",
            area="python",
            module="recovery.py",
            transition="publication_disposition",
            test=["test_recovery.py"],
            adapters=[],
            states=["none", "restore"],
            identity=None,
        ),
    ]
    fixture.regenerate()
    assert fixture.check().returncode == 0

    write(
        fixture.root / "recovery.py",
        "class Recovery:\n    def publication_disposition(self, markers):\n        return 'none'\n",
    )
    result = fixture.check()

    assert result.returncode == 1
    assert "publication_disposition" in result.stderr


def test_an_unregistered_python_reducer_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()
    write(fixture.root / "admin_thing.py", "def reduce_thing(state, event):\n    return state\n")

    result = fixture.check()

    assert result.returncode == 1
    assert "reduce_thing" in result.stderr


def test_a_stale_generated_block_fails_and_write_repairs_it(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.regenerate()
    fixture.entries = [reducer_entry(summary="Loads foo, and now says so differently.")]
    fixture.save()

    stale = fixture.check()
    assert stale.returncode == 1
    assert "--write" in stale.stderr

    fixture.regenerate()
    assert fixture.check().returncode == 0


def test_a_doc_without_the_generated_markers_fails(tmp_path):
    fixture = Fixture(tmp_path)
    fixture.save()
    write(fixture.doc_path, "# Lifecycles\n\nNo block here.\n")

    result = fixture.check()

    assert result.returncode == 1
    assert "BEGIN GENERATED" in result.stderr


def test_this_repository_passes():
    result = run(ROOT)

    assert result.returncode == 0, result.stdout + result.stderr
