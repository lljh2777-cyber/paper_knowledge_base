from __future__ import annotations

from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = PROJECT_ROOT / "tool-library" / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import lint_vault  # noqa: E402
import validate_vault  # noqa: E402


class VaultLintScopeTests(unittest.TestCase):
    def test_paper_packages_are_excluded_from_authored_note_scan(self) -> None:
        paths = validate_vault.iter_knowledge_markdown()
        relatives = [
            path.relative_to(validate_vault.KNOWLEDGE_ROOT).as_posix()
            for path in paths
        ]

        self.assertTrue(any(path.startswith("wiki/") for path in relatives))
        self.assertFalse(any(path.startswith("papers/") for path in relatives))

        audit = lint_vault.Audit()
        notes = lint_vault.load_notes(audit)
        self.assertFalse(any(path.startswith("papers/") for path in notes))

    def test_papers_wikilink_targets_are_recognized(self) -> None:
        self.assertTrue(lint_vault.is_papers_link_target("papers/example/article"))
        self.assertTrue(
            lint_vault.is_papers_link_target(
                "knowledge-base/papers/example/article.md"
            )
        )
        self.assertTrue(
            lint_vault.is_papers_link_target(
                "../../papers/example/article.md", "wiki/sources/example.md"
            )
        )
        self.assertFalse(
            lint_vault.is_papers_link_target("wiki/sources/example")
        )

    def test_wiki_to_papers_links_are_reported(self) -> None:
        for body in (
            "[[papers/example/article|原文包]]",
            "[原文包](../../papers/example/article.md)",
        ):
            with self.subTest(body=body):
                note = lint_vault.Note(
                    path=Path("example.md"),
                    relative="wiki/sources/example.md",
                    text=body,
                    body=body,
                    frontmatter={},
                    note_type="source",
                )
                audit = lint_vault.Audit()
                lint_vault.check_graph_and_duplicates(
                    {note.relative: note}, audit
                )

                self.assertTrue(
                    any(
                        finding.code == "cross-root-link"
                        for finding in audit.findings
                    )
                )

    def test_current_main_roots_have_no_cross_root_links(self) -> None:
        violations: list[str] = []

        for path in (validate_vault.KNOWLEDGE_ROOT / "wiki").rglob("*.md"):
            source = path.relative_to(validate_vault.KNOWLEDGE_ROOT).as_posix()
            text = path.read_text(encoding="utf-8")
            links = [
                *lint_vault.extract_wikilinks(text),
                *lint_vault.extract_markdown_links(text),
            ]
            if any(
                lint_vault.is_papers_link_target(link, source)
                for link in links
            ):
                violations.append(path.relative_to(PROJECT_ROOT).as_posix())
        for path in (validate_vault.KNOWLEDGE_ROOT / "papers").rglob("*.md"):
            source = path.relative_to(validate_vault.KNOWLEDGE_ROOT).as_posix()
            text = path.read_text(encoding="utf-8")
            links = [
                *lint_vault.extract_wikilinks(text),
                *lint_vault.extract_markdown_links(text),
            ]
            targets = [
                lint_vault.normalize_internal_link_target(link, source)
                for link in links
            ]
            if any(
                target.casefold().startswith(
                    ("wiki/", "knowledge-base/wiki/")
                )
                for target in targets
            ):
                violations.append(path.relative_to(PROJECT_ROOT).as_posix())

        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
