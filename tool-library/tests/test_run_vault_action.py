from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "run_vault_action.py"
)
SPEC = importlib.util.spec_from_file_location("run_vault_action", SCRIPT_PATH)
assert SPEC and SPEC.loader
run_vault_action = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = run_vault_action
SPEC.loader.exec_module(run_vault_action)


class RunVaultActionQuerySessionTests(unittest.TestCase):
    def test_query_session_separates_question_from_context(self) -> None:
        raw_input = """{
          "kind": "query-session",
          "schema_version": 1,
          "question": "详细讲讲 SingleR",
          "conversation_summary": "此前讨论了 scRNA-seq。",
          "recent_turns": [
            {"role": "user", "content": "什么是细胞注释？"},
            {"role": "assistant", "content": "上一轮回答"}
          ]
        }"""

        question, context, retrieval_mode = run_vault_action.normalize_action_input(
            "vault-retrieval",
            raw_input,
        )

        self.assertEqual(question, "详细讲讲 SingleR")
        self.assertEqual(retrieval_mode, "web")
        self.assertIn("此前讨论了 scRNA-seq。", context)
        self.assertIn("user: 什么是细胞注释？", context)
        self.assertIn("assistant: 上一轮回答", context)
        self.assertNotIn("query-session", question)

    def test_query_session_accepts_explicit_vault_mode(self) -> None:
        raw_input = """{
          "kind": "query-session",
          "schema_version": 1,
          "mode": "vault",
          "question": "只使用知识库回答"
        }"""

        question, context, retrieval_mode = (
            run_vault_action.normalize_action_input(
                "vault-retrieval",
                raw_input,
            )
        )

        self.assertEqual(question, "只使用知识库回答")
        self.assertEqual(context, "")
        self.assertEqual(retrieval_mode, "vault")

    def test_plain_retrieval_request_remains_compatible(self) -> None:
        question, context, retrieval_mode = (
            run_vault_action.normalize_action_input(
                "vault-retrieval",
                "知识库中有哪些单细胞分析方法？",
            )
        )

        self.assertEqual(question, "知识库中有哪些单细胞分析方法？")
        self.assertEqual(context, "")
        self.assertEqual(retrieval_mode, "vault")

    def test_retrieval_mode_controls_prompt_and_web_search_config(self) -> None:
        root = Path("D:/example-vault")
        web_prompt = run_vault_action.build_prompt(
            "vault-retrieval",
            "补充最新进展",
            root,
            retrieval_mode="web",
        )
        vault_prompt = run_vault_action.build_prompt(
            "vault-retrieval",
            "只总结已有证据",
            root,
            retrieval_mode="vault",
        )
        web_command = run_vault_action.build_codex_command(
            "codex",
            root,
            run_vault_action.ACTION_SPECS["vault-retrieval"],
            "gpt-5.6-terra",
            "medium",
            "default",
            retrieval_mode="web",
        )
        vault_command = run_vault_action.build_codex_command(
            "codex",
            root,
            run_vault_action.ACTION_SPECS["vault-retrieval"],
            "gpt-5.6-terra",
            "medium",
            "default",
            retrieval_mode="vault",
        )

        self.assertIn("VAULT + LIVE WEB", web_prompt)
        self.assertIn("知识库证据", web_prompt)
        self.assertIn('web_search="live"', web_command)
        self.assertIn("VAULT ONLY", vault_prompt)
        self.assertIn("Vault 中未找到足够依据", vault_prompt)
        self.assertIn('web_search="disabled"', vault_command)

    def test_non_retrieval_action_does_not_parse_session_json(self) -> None:
        raw_input = '{"kind":"query-session","question":"example"}'
        request, context, retrieval_mode = run_vault_action.normalize_action_input(
            "synthesis",
            raw_input,
        )

        self.assertEqual(request, raw_input)
        self.assertEqual(context, "")
        self.assertEqual(retrieval_mode, "vault")

    def test_keyword_payload_parser_accepts_json_and_deduplicates(self) -> None:
        keywords = run_vault_action.parse_keyword_payload(
            '```json\n{"keywords":["SingleR","细胞注释","singler",""]}\n```'
        )

        self.assertEqual(keywords, ["SingleR", "细胞注释"])


if __name__ == "__main__":
    unittest.main()
