"""Local launcher contracts. No real browser, key, or model call is used."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("walk_vertex", Path(__file__).parent / "scripts/walk_vertex.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class VertexLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        dep = self.root / "app/node_modules/playwright/package.json"
        dep.parent.mkdir(parents=True)
        dep.write_text("{}")
        self.chrome = self.root / "chrome"
        self.chrome.write_text("")
        self.key = "private-test-key-never-a-real-key"

    def invoke(self, env, tty=True):
        with patch.object(launcher, "ROOT", self.root), patch.dict(os.environ, env, clear=True), \
             patch.object(launcher.shutil, "which", return_value="node"), \
             patch.object(launcher.sys.stdin, "isatty", return_value=tty), \
             patch.object(launcher.getpass, "getpass", return_value=self.key) as prompt, \
             patch.object(launcher.subprocess, "run") as child:
            captured = {}
            def run(command, **options):
                captured.update(command=command, env=dict(options["env"]), cwd=options["cwd"])
                return subprocess.CompletedProcess(command, 2)
            child.side_effect = run
            code = launcher.main(["--model", "gemini-example", "--chrome", str(self.chrome)])
            self.assertNotIn("GOOGLE_API_KEY", os.environ.keys() - env.keys())
            return code, captured, prompt.call_count, child.call_count

    def test_hidden_key_is_process_only_and_chrome_is_explicit(self):
        code, captured, prompts, calls = self.invoke({})
        self.assertEqual((code, prompts, calls), (2, 1, 1))
        self.assertNotIn(self.key, " ".join(captured["command"]))
        self.assertEqual(captured["env"]["GODIESEL_WALK_PROVIDER"], "vertex")
        self.assertEqual(captured["env"]["GOOGLE_API_KEY"], self.key)
        self.assertEqual(captured["env"]["GODIESEL_WALK_BROWSER_PATH"], str(self.chrome))
        self.assertIn("--headed", captured["command"])
        self.assertIn("--driver", captured["command"])

    def test_secure_existing_environment_key_needs_no_prompt(self):
        _, _, prompts, calls = self.invoke({"GOOGLE_API_KEY": self.key}, tty=False)
        self.assertEqual((prompts, calls), (0, 1))

    def test_noninteractive_missing_key_never_falls_back_to_visible_input(self):
        code, _, prompts, calls = self.invoke({}, tty=False)
        self.assertEqual((code, prompts, calls), (2, 0, 0))

    def test_missing_chrome_does_not_silently_use_bundled_browser(self):
        with self.assertRaises(ValueError):
            launcher.find_chrome(str(self.root / "missing"))


if __name__ == "__main__":
    unittest.main()
