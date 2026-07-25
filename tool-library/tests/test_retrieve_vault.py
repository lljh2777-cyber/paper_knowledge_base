from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "retrieve_vault.py"
)
SPEC = importlib.util.spec_from_file_location("retrieve_vault", SCRIPT_PATH)
assert SPEC and SPEC.loader
retrieve_vault = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = retrieve_vault
SPEC.loader.exec_module(retrieve_vault)


class RetrieveVaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temp_dir.name)
        vault_root = self.project_root / "knowledge-base"
        (vault_root / "wiki" / "methods").mkdir(parents=True)
        (vault_root / "wiki" / "sources").mkdir(parents=True)
        (vault_root / "研究方法索引.md").write_text(
            "# 研究方法索引\n",
            encoding="utf-8",
        )
        (vault_root / "wiki" / "index.md").write_text(
            "# Wiki Index\n",
            encoding="utf-8",
        )
        (vault_root / "wiki" / "methods" / "cell-annotation.md").write_text(
            """---
title: Cell type annotation
title_zh: 细胞类型注释
aliases:
  - SingleR annotation
---

# Cell type annotation

SingleR 可用于单细胞 RNA-seq 的细胞类型注释。

相关证据：[[../sources/example-paper|相关文献]]。
""",
            encoding="utf-8",
        )
        (vault_root / "wiki" / "sources" / "example-paper.md").write_text(
            """---
title: Example single-cell paper
title_zh: 单细胞示例论文
---

# Example single-cell paper

该文献链接到 [[../methods/cell-annotation|方法页]]。
""",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_lexical_seed_and_graph_expansion(self) -> None:
        result = retrieve_vault.retrieve(
            self.project_root,
            "SingleR annotation workflow",
        )

        self.assertEqual(result["stage"], "lexical-seed+ppr")
        self.assertEqual(result["retrieval_label"], "Lex+PPR")
        self.assertEqual(
            result["lexical_seeds"][0]["path"],
            "wiki/methods/cell-annotation.md",
        )
        expanded_paths = {
            candidate["path"] for candidate in result["graph_expansion"]
        }
        self.assertIn("wiki/sources/example-paper.md", expanded_paths)
        self.assertNotIn("wiki/index.md", expanded_paths)
        self.assertFalse(result["fallback"]["used"])

    def test_expanded_terms_use_llm_ppr_label(self) -> None:
        result = retrieve_vault.retrieve(
            self.project_root,
            "细胞身份判定",
            expanded_terms=["SingleR annotation"],
        )

        self.assertEqual(result["stage"], "llm-keyword+ppr")
        self.assertEqual(result["retrieval_label"], "LLM+PPR")
        self.assertTrue(result["keyword_expansion"]["used"])
        self.assertIn("singler annotation", result["keyword_expansion"]["terms"])
        self.assertEqual(
            result["lexical_seeds"][0]["path"],
            "wiki/methods/cell-annotation.md",
        )

    def test_unrelated_query_uses_orientation_fallback(self) -> None:
        result = retrieve_vault.retrieve(
            self.project_root,
            "完全不存在的量子香蕉协议 zzqv999",
        )

        self.assertEqual(result["stage"], "no-match-fallback")
        self.assertEqual(result["retrieval_label"], "NoMatch+Index")
        self.assertEqual(result["lexical_seeds"], [])
        self.assertEqual(result["graph_expansion"], [])
        self.assertTrue(result["fallback"]["used"])
        self.assertEqual(
            result["fallback"]["paths"],
            ["研究方法索引.md", "wiki/index.md"],
        )


if __name__ == "__main__":
    unittest.main()
