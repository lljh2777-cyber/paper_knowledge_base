from __future__ import annotations

import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "run_vault_action.py"
)
SPEC = importlib.util.spec_from_file_location("run_vault_action", SCRIPT_PATH)
assert SPEC and SPEC.loader
run_vault_action = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = run_vault_action
SPEC.loader.exec_module(run_vault_action)


def process_is_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        still_active = 259
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information,
            False,
            pid,
        )
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not ctypes.windll.kernel32.GetExitCodeProcess(
                handle,
                ctypes.byref(exit_code),
            ):
                return False
            return exit_code.value == still_active
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


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
        self.assertIn("--json", web_command)
        self.assertIn("--output-schema", web_command)
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

    def test_annotation_explanation_is_read_only_and_returns_only_explanation(
        self,
    ) -> None:
        prompt = run_vault_action.build_prompt(
            "annotation-explain",
            "选中文字：spatial proximity\n上下文：chromosome territories",
            Path("D:/vault"),
        )
        spec = run_vault_action.ACTION_SPECS["annotation-explain"]

        self.assertEqual(spec["sandbox"], "read-only")
        self.assertFalse(spec["writes"])
        self.assertIn("immediate reading comprehension", prompt)
        self.assertIn("Return only the user-facing explanation", prompt)
        self.assertNotIn("files created or updated", prompt)

    def test_keyword_payload_parser_accepts_json_and_deduplicates(self) -> None:
        keywords = run_vault_action.parse_keyword_payload(
            '```json\n{"keywords":["SingleR","细胞注释","singler",""]}\n```'
        )

        self.assertEqual(keywords, ["SingleR", "细胞注释"])

    def test_structured_retrieval_result_validates_citations(self) -> None:
        payload = {
            "answer_markdown": (
                "已核验 [官方文档](https://example.com/docs)。"
                "另见 [未知链接](https://invalid.example/item)。"
            ),
            "vault_sources": [
                {
                    "path": "knowledge-base/wiki/methods/example.md",
                    "title": "示例方法",
                }
            ],
            "web_sources": [
                {
                    "title": "官方文档",
                    "url": "https://example.com/docs",
                    "publisher": "Example",
                    "published_at": "2026-07-25",
                }
            ],
            "conflicts": [],
            "evidence_gaps": [],
            "retrieval_path": {
                "stage": "vault+web",
                "inspected_vault_paths": ["wiki/methods/example.md"],
                "web_queries": ["example docs"],
                "fallback_reason": "",
            },
        }

        normalized = run_vault_action.normalize_structured_retrieval_result(
            payload,
            "web",
            {"https://example.com/docs"},
            ["example docs current"],
        )

        self.assertEqual(
            normalized["vault_sources"][0]["path"],
            "wiki/methods/example.md",
        )
        self.assertEqual(
            normalized["web_sources"][0]["verification"],
            "event",
        )
        self.assertTrue(normalized["web_sources"][0]["cited"])
        self.assertNotIn(
            "](https://invalid.example/item)",
            normalized["answer_markdown"],
        )
        self.assertEqual(
            normalized["citation_validation"]["status"],
            "partial",
        )
        self.assertIn(
            "example docs current",
            normalized["retrieval_path"]["web_queries"],
        )

    def test_vault_mode_removes_external_sources(self) -> None:
        payload = {
            "answer_markdown": "仅使用 Vault。",
            "vault_sources": [],
            "web_sources": [
                {
                    "title": "不应保留",
                    "url": "https://example.com",
                    "publisher": "",
                    "published_at": "",
                }
            ],
            "conflicts": [],
            "evidence_gaps": [],
            "retrieval_path": {
                "stage": "vault",
                "inspected_vault_paths": [],
                "web_queries": ["should disappear"],
                "fallback_reason": "",
            },
        }

        normalized = run_vault_action.normalize_structured_retrieval_result(
            payload,
            "vault",
        )

        self.assertEqual(normalized["web_sources"], [])
        self.assertEqual(normalized["retrieval_path"]["web_queries"], [])

    def test_vault_wikilinks_are_checked_against_structured_sources(self) -> None:
        payload = {
            "answer_markdown": (
                "参考 [[wiki/methods/singler|SingleR]]；"
                "另见 [[wiki/methods/unlisted|未登记页面]]。"
            ),
            "vault_sources": [
                {
                    "path": "wiki/methods/singler.md",
                    "title": "SingleR",
                }
            ],
            "web_sources": [],
            "conflicts": [],
            "evidence_gaps": [],
            "retrieval_path": {
                "stage": "vault",
                "inspected_vault_paths": ["wiki/methods/singler.md"],
                "web_queries": [],
                "fallback_reason": "",
            },
        }

        normalized = run_vault_action.normalize_structured_retrieval_result(
            payload,
            "vault",
        )

        self.assertTrue(normalized["vault_sources"][0]["cited"])
        self.assertEqual(
            normalized["citation_validation"]["unlisted_vault_citations"],
            ["wiki/methods/unlisted"],
        )
        self.assertEqual(
            normalized["citation_validation"]["status"],
            "partial",
        )

    def test_retrieval_schema_is_valid_json(self) -> None:
        schema_path = (
            SCRIPT_PATH.parents[1]
            / "schemas"
            / "dashboard_retrieval_response.schema.json"
        )
        schema = json.loads(schema_path.read_text(encoding="utf-8"))

        self.assertEqual(schema["type"], "object")
        self.assertIn("answer_markdown", schema["required"])

    def test_jsonl_runner_emits_structured_dashboard_result(self) -> None:
        payload = {
            "answer_markdown": "参考 [官方页面](https://example.com/docs)。",
            "vault_sources": [],
            "web_sources": [
                {
                    "title": "官方页面",
                    "url": "https://example.com/docs",
                    "publisher": "Example",
                    "published_at": "2026-07-25",
                }
            ],
            "conflicts": [],
            "evidence_gaps": [],
            "retrieval_path": {
                "stage": "vault+web",
                "inspected_vault_paths": [],
                "web_queries": ["example docs"],
                "fallback_reason": "",
            },
        }
        events = [
            {"type": "turn.started"},
            {
                "type": "item.completed",
                "item": {
                    "type": "web_search",
                    "query": "example docs",
                    "sources": [{"type": "url", "url": "https://example.com/docs"}],
                },
            },
            {
                "type": "item.completed",
                "item": {
                    "type": "agent_message",
                    "text": json.dumps(payload, ensure_ascii=False),
                },
            },
        ]
        script = (
            "import json,sys;"
            "sys.stdin.read();"
            f"events={json.dumps(events, ensure_ascii=False)!r};"
            "[print(json.dumps(item, ensure_ascii=False), flush=True) "
            "for item in json.loads(events)]"
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = run_vault_action.run_retrieval_process(
                [sys.executable, "-c", script],
                Path.cwd(),
                10,
                "prompt",
                "web",
            )

        self.assertEqual(result, 0)
        self.assertEqual(
            stdout.getvalue().strip(),
            "参考 [官方页面](https://example.com/docs)。",
        )
        dashboard_events = [
            json.loads(line.removeprefix("DASHBOARD_EVENT "))
            for line in stderr.getvalue().splitlines()
            if line.startswith("DASHBOARD_EVENT ")
        ]
        result_event = next(
            event for event in dashboard_events
            if event["type"] == "retrieval-result"
        )
        self.assertTrue(
            result_event["payload"]["web_sources"][0]["event_verified"]
        )
        self.assertEqual(
            result_event["payload"]["citation_validation"]["status"],
            "verified",
        )


class ProcessTreeStopTests(unittest.TestCase):
    def test_stop_file_terminates_spawned_process_tree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stop_file = root / "stop.signal"
            pid_file = root / "pids.json"
            heartbeat = root / "heartbeat.txt"
            child_code = (
                "import pathlib,sys,time\n"
                "target=pathlib.Path(sys.argv[1])\n"
                "while True:\n"
                " target.write_text(str(time.time()), encoding='utf-8')\n"
                " time.sleep(0.05)\n"
            )
            parent_code = (
                "import json,os,pathlib,subprocess,sys,time\n"
                "child=subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[3]])\n"
                "pathlib.Path(sys.argv[2]).write_text("
                "json.dumps({'parent':os.getpid(),'child':child.pid}),encoding='utf-8')\n"
                "while True: time.sleep(1)\n"
            )
            result: list[int] = []

            def run() -> None:
                result.append(
                    run_vault_action.run_process(
                        [
                            sys.executable,
                            "-c",
                            parent_code,
                            child_code,
                            str(pid_file),
                            str(heartbeat),
                        ],
                        root,
                        30,
                        stop_file=stop_file,
                    )
                )

            runner = threading.Thread(target=run)
            runner.start()
            deadline = time.monotonic() + 5
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(pid_file.exists(), "test process tree did not start")
            pids = json.loads(pid_file.read_text(encoding="utf-8"))
            stop_file.write_text("stop\n", encoding="utf-8")
            runner.join(timeout=10)
            self.assertFalse(runner.is_alive())
            self.assertEqual(result, [130])
            time.sleep(0.2)
            self.assertFalse(process_is_alive(int(pids["parent"])))
            self.assertFalse(process_is_alive(int(pids["child"])))


if __name__ == "__main__":
    unittest.main()
