from __future__ import annotations

import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "run_mineru_extract.py"
)
SPEC = importlib.util.spec_from_file_location("run_mineru_extract", SCRIPT_PATH)
assert SPEC and SPEC.loader
run_mineru_extract = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = run_mineru_extract
SPEC.loader.exec_module(run_mineru_extract)


class MineruExtractionTests(unittest.TestCase):
    def test_normalize_pages_uses_one_based_ranges(self) -> None:
        self.assertEqual(run_mineru_extract.normalize_pages("1-3, 5"), "1-3,5")
        self.assertEqual(run_mineru_extract.normalize_pages(""), "")
        with self.assertRaisesRegex(ValueError, "start at 1"):
            run_mineru_extract.normalize_pages("0-2")
        with self.assertRaisesRegex(ValueError, "cannot descend"):
            run_mineru_extract.normalize_pages("4-2")

    def test_validate_package_accepts_table_evidence_asset(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package = Path(temp_dir)
            images = package / "images"
            images.mkdir()
            (images / "figure.jpg").write_bytes(b"figure")
            (images / "table.jpg").write_bytes(b"table")
            article = (
                "# Example paper\n\n"
                + "Body text for deterministic MinerU package validation. " * 4
                + "\n\n![](images/figure.jpg)\n"
            )
            (package / "article.md").write_text(article, encoding="utf-8")
            payload = [
                {"type": "text", "page_idx": 0, "text": "Example"},
                {
                    "type": "image",
                    "page_idx": 0,
                    "img_path": "images/figure.jpg",
                },
                {
                    "type": "table",
                    "page_idx": 1,
                    "img_path": "images/table.jpg",
                    "table_body": "<table></table>",
                },
            ]
            (package / "mineru-result.json").write_text(
                json.dumps(payload),
                encoding="utf-8",
            )

            validation = run_mineru_extract.validate_package(package)

        self.assertEqual(validation["status"], "passed")
        self.assertEqual(validation["page_count"], 2)
        self.assertEqual(validation["json_asset_count"], 2)
        self.assertEqual(validation["markdown_asset_count"], 1)
        self.assertEqual(
            validation["unreferenced_json_assets"],
            ["images/table.jpg"],
        )

    def test_validate_package_rejects_missing_markdown_asset(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package = Path(temp_dir)
            article = "# Example paper\n\n" + "Body " * 30 + "\n![](images/missing.jpg)\n"
            (package / "article.md").write_text(article, encoding="utf-8")
            (package / "mineru-result.json").write_text(
                json.dumps([{"type": "text", "page_idx": 0, "text": "Example"}]),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "Missing or empty Markdown asset"):
                run_mineru_extract.validate_package(package)

    def test_write_contract_records_source_and_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package = root / "package"
            package.mkdir()
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-test")
            (package / "article.md").write_text(
                "# Example\n\n" + "Body " * 30,
                encoding="utf-8",
            )
            (package / "mineru-result.json").write_text("[]", encoding="utf-8")
            validation = {"status": "passed", "checks": {"example": True}}

            run_mineru_extract.write_contract(
                package,
                source,
                Path("mineru-open-api.cmd"),
                "mineru-open-api version v0.test",
                {"model": "vlm"},
                validation,
                True,
            )

            manifest = json.loads(
                (package / "_extraction" / "manifest.json").read_text(encoding="utf-8")
            )
            source_copied = (package / "_extraction" / "source.pdf").is_file()

        self.assertEqual(manifest["extractor"], "mineru-open-api")
        self.assertEqual(manifest["processing_depth"], "conversion-only")
        self.assertTrue(manifest["privacy"]["remote_processing"])
        self.assertTrue(source_copied)

    def test_main_stages_validates_and_publishes_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "AGENTS.md").write_text("# Test\n", encoding="utf-8")
            source = root / "paper.pdf"
            source.write_bytes(b"%PDF-test")
            mineru = root / "mineru-open-api.cmd"
            mineru.write_text("@echo off\n", encoding="utf-8")

            def fake_run_command(
                _executable: Path,
                arguments: list[str],
                _cwd: Path,
                _timeout: int,
            ) -> subprocess.CompletedProcess[str]:
                if arguments == ["version"]:
                    return subprocess.CompletedProcess(
                        arguments,
                        0,
                        stdout="mineru-open-api version v0.test\n",
                        stderr="",
                    )
                output = Path(arguments[arguments.index("--output") + 1])
                (output / "images").mkdir(parents=True)
                (output / "images" / "figure.jpg").write_bytes(b"figure")
                (output / "paper.md").write_text(
                    "# Example\n\n" + "Body " * 30 + "\n![](images/figure.jpg)\n",
                    encoding="utf-8",
                )
                (output / "paper.json").write_text(
                    json.dumps(
                        [
                            {"type": "text", "page_idx": 0, "text": "Example"},
                            {
                                "type": "image",
                                "page_idx": 0,
                                "img_path": "images/figure.jpg",
                            },
                        ]
                    ),
                    encoding="utf-8",
                )
                return subprocess.CompletedProcess(arguments, 0, stdout="Done\n", stderr="")

            argv = [
                "run_mineru_extract.py",
                "--project-root",
                str(root),
                "--source",
                str(source),
                "--citekey",
                "example_2026",
                "--mineru",
                str(mineru),
                "--model",
                "vlm",
                "--language",
                "en",
            ]
            with (
                mock.patch.object(sys, "argv", argv),
                mock.patch.object(run_mineru_extract, "run_command", side_effect=fake_run_command),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                result = run_mineru_extract.main()

            package = root / "knowledge-base" / "papers" / "example_2026"
            self.assertEqual(result, 0)
            self.assertTrue((package / "article.md").is_file())
            self.assertTrue((package / "mineru-result.json").is_file())
            self.assertTrue((package / "_extraction" / "manifest.json").is_file())
            self.assertTrue((package / "_extraction" / "validation.json").is_file())
            with mock.patch.object(sys, "argv", argv):
                with self.assertRaisesRegex(FileExistsError, "will not be overwritten"):
                    run_mineru_extract.main()


if __name__ == "__main__":
    unittest.main()
