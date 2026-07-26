from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "run_code_practice.py"
)
SPEC = importlib.util.spec_from_file_location("run_code_practice", SCRIPT_PATH)
assert SPEC and SPEC.loader
run_code_practice = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = run_code_practice
SPEC.loader.exec_module(run_code_practice)


class CodePracticeBoundaryTests(unittest.TestCase):
    def validate(self, language: str, code: str) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            return run_code_practice.validate_request(
                {
                    "language": language,
                    "code": code,
                    "working_directory": "tool-library/output/code-practice",
                },
                root,
            )

    def assert_blocked(self, language: str, code: str) -> None:
        with self.assertRaises(run_code_practice.RequestError):
            self.validate(language, code)

    def test_normal_computation_remains_allowed(self) -> None:
        result = self.validate("python", "values = [1, 2, 3]\nsum(values)")
        self.assertEqual(result["language"], "python")

    def test_common_python_escape_and_write_patterns_are_blocked(self) -> None:
        self.assert_blocked("python", 'open("outside.txt", "w").write("x")')
        self.assert_blocked("python", 'Path("outside.txt").write_text("x")')
        self.assert_blocked("python", '__import__("socket")')
        self.assert_blocked("python", 'importlib.import_module("requests")')
        self.assert_blocked("python", 'os.popen("whoami")')
        self.assert_blocked("python", "import httpx")

    def test_common_r_write_and_network_patterns_are_blocked(self) -> None:
        self.assert_blocked("r", 'writeLines("x", "outside.txt")')
        self.assert_blocked("r", 'write.csv(data.frame(x = 1), "outside.csv")')
        self.assert_blocked("r", 'download.file("https://example.com", "x")')
        self.assert_blocked("r", 'httr2::request("https://example.com")')


if __name__ == "__main__":
    unittest.main()
