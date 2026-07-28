"""Claude Code implementation of the Dashboard CLI backend protocol."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .base import (
    BACKEND_PROTOCOL_VERSION,
    BackendCapabilities,
    BackendCommandRequest,
    ParsedBackendEvent,
)


_READ_TOOLS = "Read,Glob,Grep"
_WRITE_TOOL_NAMES = ("Edit", "Write", "NotebookEdit", "Bash")
_STAGE_WRITE_ACTIONS = {"code-analysis", "synthesis"}


def _permission_path(project_root: Path, path: Path) -> str:
    root = project_root.resolve()
    target = path.resolve()
    try:
        relative = target.relative_to(root)
    except ValueError as error:
        raise ValueError(
            f"Claude Code permission path is outside project root: {target}"
        ) from error
    value = relative.as_posix()
    if target.is_dir() or not target.suffix:
        return f"{value}/**"
    return value


def _message_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    message = payload.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict)]


class ClaudeCodeBackend:
    backend_id = "claude-code"
    label = "Claude Code"
    capabilities = BackendCapabilities(
        structured_output=True,
        streaming=True,
        sessions=False,
        model_selection=True,
        reasoning_effort=True,
        service_tier=False,
        file_write=True,
        web_search=False,
        citations=False,
        image_input=True,
    )

    def effective_service_tier(self, model: str, requested: str) -> str:
        return "default"

    def build_command(
        self,
        executable: str,
        request: BackendCommandRequest,
    ) -> list[str]:
        policy = request.resolved_access_policy()
        is_read_only = policy.mode == "read-only" and policy.write_scope == "none"
        is_stage_write = (
            request.action in _STAGE_WRITE_ACTIONS
            and policy.mode == "workspace-write"
            and policy.write_scope == "stage-owned"
            and policy.require_change_manifest
            and policy.rollback_on_failure
        )
        if not is_read_only and not is_stage_write:
            raise ValueError(
                "Claude Code currently permits read-only actions and "
                "stage-owned writes for code-analysis or synthesis only"
            )

        needs_vault_read = request.action == "vault-retrieval"
        command = [
            executable,
            "-p",
            "--safe-mode",
            "--permission-mode",
            "plan" if needs_vault_read else "dontAsk",
        ]
        if is_stage_write:
            command.extend(
                [
                    "--tools",
                    "Read,Glob,Grep,Edit,Write,NotebookEdit",
                    "--allowedTools",
                    ",".join(
                        [
                            "Read",
                            "Glob",
                            "Grep",
                            *[
                                f"Edit({_permission_path(request.project_root, root)})"
                                for root in policy.allowed_roots
                            ],
                        ]
                    ),
                    "--disallowedTools",
                    ",".join(
                        [
                            "Bash",
                            *[
                                f"Edit({_permission_path(request.project_root, root)})"
                                for root in policy.denied_roots
                            ],
                        ]
                    ),
                ]
            )
        elif needs_vault_read:
            command.extend(["--tools", _READ_TOOLS])
            command.extend(
                [
                    "--disallowedTools",
                    ",".join(_WRITE_TOOL_NAMES),
                ]
            )
        else:
            command.append("--tools=")
            command.extend(
                [
                    "--disallowedTools",
                    ",".join(_WRITE_TOOL_NAMES),
                ]
            )
        command.append("--no-session-persistence")
        effort = str(request.reasoning_effort or "").strip().lower()
        if effort in {"low", "medium", "high", "xhigh"}:
            command.extend(["--effort", effort])
        model = str(request.model or "").strip()
        if model:
            command.extend(["--model", model])

        if request.action == "vault-retrieval":
            if request.output_schema is None:
                raise ValueError("vault retrieval requires an output schema")
            schema = json.loads(request.output_schema.read_text(encoding="utf-8"))
            command.extend(
                [
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--json-schema",
                    json.dumps(schema, ensure_ascii=False, separators=(",", ":")),
                ]
            )
        else:
            command.extend(["--output-format", "text"])
        return command

    def parse_event(self, payload: dict[str, Any]) -> ParsedBackendEvent:
        parsed = ParsedBackendEvent()
        event_type = str(payload.get("type") or "")
        subtype = str(payload.get("subtype") or "")

        if event_type == "system" and subtype == "init":
            model = str(payload.get("model") or "").strip()
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "model-started",
                    "label": (
                        f"正在调用 Claude Code（{model}）"
                        if model
                        else "正在调用 Claude Code"
                    ),
                }
            )
            return parsed

        if event_type == "assistant":
            for block in _message_blocks(payload):
                if block.get("type") != "tool_use":
                    continue
                tool_name = str(block.get("name") or "")
                if tool_name in {"Read", "Glob", "Grep"}:
                    parsed.dashboard_events.append(
                        {
                            "type": "status",
                            "stage": "reading-evidence",
                            "label": "正在读取并核验候选证据",
                        }
                    )
            return parsed

        if event_type == "result":
            structured = payload.get("structured_output")
            result = payload.get("result")
            if isinstance(structured, dict):
                parsed.final_messages.append(
                    json.dumps(structured, ensure_ascii=False)
                )
            elif isinstance(result, str) and result.strip():
                parsed.final_messages.append(result)
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "structuring-answer",
                    "label": "正在整理回答与来源",
                }
            )
        return parsed

    def describe(self) -> dict[str, Any]:
        return {
            "schema_version": BACKEND_PROTOCOL_VERSION,
            "id": self.backend_id,
            "label": self.label,
            "capabilities": self.capabilities.to_payload(),
            "write_support": {
                "enabled": True,
                "scopes": ["stage-owned"],
                "actions": sorted(_STAGE_WRITE_ACTIONS),
                "guardrails": [
                    "path-specific Edit allow rules",
                    "Bash disabled",
                    "host change manifest",
                    "post-run path audit",
                    "validator and rollback",
                ],
            },
        }
