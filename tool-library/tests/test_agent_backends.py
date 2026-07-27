from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = PROJECT_ROOT / "tool-library" / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from agent_backends import (  # noqa: E402
    BACKEND_PROTOCOL_VERSION,
    BackendAccessPolicy,
    BackendCommandRequest,
    build_action_access_policy,
    get_backend,
    list_backends,
)


class AgentBackendProtocolTests(unittest.TestCase):
    def test_registry_exposes_versioned_backend_capabilities(self) -> None:
        discovered = list_backends()

        self.assertEqual(
            [item["id"] for item in discovered],
            ["claude-code", "codex-cli"],
        )
        by_id = {item["id"]: item for item in discovered}
        self.assertEqual(by_id["codex-cli"]["schema_version"], "1.0")
        self.assertTrue(
            by_id["codex-cli"]["capabilities"]["structured_output"]
        )
        self.assertTrue(by_id["codex-cli"]["capabilities"]["file_write"])
        self.assertTrue(
            by_id["claude-code"]["capabilities"]["structured_output"]
        )
        self.assertFalse(
            by_id["claude-code"]["capabilities"]["file_write"]
        )

    def test_unknown_backend_fails_with_available_ids(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "Available: claude-code, codex-cli",
        ):
            get_backend("missing-cli")

    def test_codex_adapter_builds_shell_free_retrieval_command(self) -> None:
        backend = get_backend("codex-cli")
        schema_path = (
            PROJECT_ROOT
            / "tool-library"
            / "schemas"
            / "dashboard_retrieval_response.schema.json"
        )
        request = BackendCommandRequest(
            action="vault-retrieval",
            agent="research-vault-retrieval",
            project_root=PROJECT_ROOT,
            sandbox="read-only",
            writes=False,
            model="gpt-5.6-terra",
            reasoning_effort="medium",
            service_tier="fast",
            retrieval_mode="web",
            output_schema=schema_path,
        )

        command = backend.build_command("codex.exe", request)

        self.assertEqual(command[0:2], ["codex.exe", "exec"])
        self.assertIn('web_search="live"', command)
        self.assertIn('service_tier="fast"', command)
        self.assertIn("--json", command)
        self.assertIn(str(schema_path), command)
        self.assertEqual(command[-1], "-")

    def test_action_access_policy_distinguishes_read_and_write_scopes(
        self,
    ) -> None:
        read_policy = build_action_access_policy(
            "vault-retrieval",
            {"writes": False},
            PROJECT_ROOT,
        )
        stage_policy = build_action_access_policy(
            "synthesis",
            {"writes": True},
            PROJECT_ROOT,
        )
        full_policy = build_action_access_policy(
            "pdf-xray",
            {"writes": True},
            PROJECT_ROOT,
        )

        self.assertEqual(read_policy.mode, "read-only")
        self.assertEqual(read_policy.write_scope, "none")
        self.assertIn("Bash", read_policy.denied_tools)
        self.assertEqual(stage_policy.write_scope, "stage-owned")
        self.assertTrue(stage_policy.require_change_manifest)
        self.assertEqual(full_policy.write_scope, "full")
        self.assertTrue(full_policy.rollback_on_failure)

    def test_access_policy_rejects_inconsistent_mode_and_scope(self) -> None:
        with self.assertRaisesRegex(ValueError, "read-only access"):
            BackendAccessPolicy(
                mode="read-only",
                write_scope="stage-owned",
                allowed_roots=(PROJECT_ROOT,),
            )

    def test_claude_adapter_builds_read_only_command_using_cli_default_model(
        self,
    ) -> None:
        backend = get_backend("claude-code")
        schema_path = (
            PROJECT_ROOT
            / "tool-library"
            / "schemas"
            / "dashboard_retrieval_response.schema.json"
        )
        request = BackendCommandRequest(
            action="vault-retrieval",
            agent="research-vault-retrieval",
            project_root=PROJECT_ROOT,
            sandbox="read-only",
            writes=False,
            model="",
            reasoning_effort="medium",
            service_tier="default",
            retrieval_mode="vault",
            output_schema=schema_path,
            access_policy=BackendAccessPolicy(
                mode="read-only",
                write_scope="none",
                allowed_roots=(PROJECT_ROOT,),
            ),
        )

        command = backend.build_command("claude.exe", request)

        self.assertEqual(command[0:2], ["claude.exe", "-p"])
        self.assertIn("--safe-mode", command)
        self.assertIn("plan", command)
        self.assertIn("Read,Glob,Grep", command)
        self.assertIn("Edit,Write,NotebookEdit,Bash", command)
        self.assertIn("stream-json", command)
        self.assertIn("--json-schema", command)
        self.assertNotIn("--model", command)

    def test_claude_adapter_rejects_write_mode_until_host_audit_exists(
        self,
    ) -> None:
        backend = get_backend("claude-code")
        request = BackendCommandRequest(
            action="synthesis",
            agent="research-vault-synthesis",
            project_root=PROJECT_ROOT,
            sandbox="workspace-write",
            writes=True,
            model="",
            reasoning_effort="high",
            service_tier="default",
            access_policy=BackendAccessPolicy(
                mode="workspace-write",
                write_scope="stage-owned",
                allowed_roots=(
                    PROJECT_ROOT / "knowledge-base" / "wiki" / "methods",
                ),
            ),
        )

        with self.assertRaisesRegex(ValueError, "write access is not enabled"):
            backend.build_command("claude.exe", request)

    def test_claude_annotation_uses_zero_tools_without_plan_mode(self) -> None:
        backend = get_backend("claude-code")
        request = BackendCommandRequest(
            action="annotation-explain",
            agent="annotation-assistant",
            project_root=PROJECT_ROOT,
            sandbox="read-only",
            writes=False,
            model="",
            reasoning_effort="medium",
            service_tier="default",
            access_policy=BackendAccessPolicy(
                mode="read-only",
                write_scope="none",
                allowed_roots=(PROJECT_ROOT,),
            ),
        )

        command = backend.build_command("claude.exe", request)

        self.assertIn("dontAsk", command)
        self.assertIn("--tools=", command)
        self.assertNotIn("Read,Glob,Grep", command)
        self.assertEqual(command[-2:], ["--output-format", "text"])

    def test_claude_adapter_normalizes_init_tool_and_result_events(
        self,
    ) -> None:
        backend = get_backend("claude-code")
        init_event = {
            "type": "system",
            "subtype": "init",
            "model": "qwen3.7-flash[1m]",
        }
        tool_event = {
            "type": "assistant",
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "Read",
                        "input": {"file_path": "knowledge-base/wiki/index.md"},
                    }
                ]
            },
        }
        result_event = {
            "type": "result",
            "subtype": "success",
            "structured_output": {
                "answer_markdown": "answer",
                "vault_sources": [],
            },
        }

        parsed_init = backend.parse_event(init_event)
        parsed_tool = backend.parse_event(tool_event)
        parsed_result = backend.parse_event(result_event)

        self.assertIn(
            "qwen3.7-flash[1m]",
            parsed_init.dashboard_events[0]["label"],
        )
        self.assertEqual(
            parsed_tool.dashboard_events[0]["stage"],
            "reading-evidence",
        )
        self.assertEqual(
            json.loads(parsed_result.final_messages[0])["answer_markdown"],
            "answer",
        )

    def test_codex_adapter_normalizes_status_sources_and_final_text(self) -> None:
        backend = get_backend("codex-cli")
        web_event = {
            "type": "item.completed",
            "item": {
                "type": "web_search",
                "query": "official documentation",
                "sources": [
                    {
                        "type": "url",
                        "url": "HTTPS://Example.COM:443/docs#section",
                    }
                ],
            },
        }
        message_event = {
            "type": "item.completed",
            "item": {
                "type": "agent_message",
                "text": "final answer",
            },
        }

        parsed_web = backend.parse_event(web_event)
        parsed_message = backend.parse_event(message_event)

        self.assertEqual(parsed_web.search_queries, ["official documentation"])
        self.assertEqual(parsed_web.source_urls, {"https://example.com/docs"})
        self.assertEqual(parsed_web.dashboard_events[0]["stage"], "web-search")
        self.assertEqual(parsed_message.final_messages, ["final answer"])
        self.assertEqual(
            parsed_message.dashboard_events[0]["stage"],
            "structuring-answer",
        )

    def test_protocol_schemas_are_versioned_json(self) -> None:
        schema_root = PROJECT_ROOT / "tool-library" / "schemas"
        for name in (
            "agent_backend_task.schema.json",
            "agent_backend_event.schema.json",
            "agent_backend_capabilities.schema.json",
        ):
            payload = json.loads(
                (schema_root / name).read_text(encoding="utf-8")
            )
            self.assertEqual(payload["type"], "object")
            self.assertIn("schema_version", payload["properties"])

    def test_dashboard_events_receive_protocol_version(self) -> None:
        import importlib.util

        runner_path = SCRIPTS_ROOT / "run_vault_action.py"
        spec = importlib.util.spec_from_file_location(
            "run_vault_action_backend_event_test",
            runner_path,
        )
        assert spec and spec.loader
        runner = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = runner
        spec.loader.exec_module(runner)
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr):
            runner.emit_dashboard_event(
                {
                    "type": "status",
                    "stage": "test",
                    "label": "testing",
                }
            )

        line = stderr.getvalue().strip()
        payload = json.loads(line.removeprefix("DASHBOARD_EVENT "))
        self.assertEqual(payload["schema_version"], BACKEND_PROTOCOL_VERSION)
        self.assertEqual(payload["type"], "status")


if __name__ == "__main__":
    unittest.main()
