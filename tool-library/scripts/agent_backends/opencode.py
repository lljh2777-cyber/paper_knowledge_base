"""OpenCode implementation of the Dashboard CLI backend protocol."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .base import (
    BACKEND_PROTOCOL_VERSION,
    BackendCapabilities,
    BackendCommandRequest,
    ParsedBackendEvent,
)


_STAGE_WRITE_ACTIONS = {"code-analysis", "synthesis"}


def _canonicalize_external_url(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"}:
        return ""
    if not parsed.hostname or parsed.username or parsed.password:
        return ""
    host = parsed.hostname.lower()
    try:
        port = parsed.port
    except ValueError:
        return ""
    netloc = host
    if port and not (
        (parsed.scheme.lower() == "http" and port == 80)
        or (parsed.scheme.lower() == "https" and port == 443)
    ):
        netloc = f"{host}:{port}"
    return urlunsplit(
        (
            parsed.scheme.lower(),
            netloc,
            parsed.path or "/",
            parsed.query,
            "",
        )
    )


def _tool_event(payload: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    part = payload.get("part")
    if not isinstance(part, dict):
        return "", {}
    tool = str(part.get("tool") or "").strip().lower()
    state = part.get("state")
    if not isinstance(state, dict):
        state = {}
    tool_input = state.get("input")
    return tool, tool_input if isinstance(tool_input, dict) else {}


class OpenCodeBackend:
    backend_id = "opencode"
    label = "OpenCode"
    capabilities = BackendCapabilities(
        structured_output=True,
        streaming=True,
        sessions=True,
        model_selection=True,
        reasoning_effort=True,
        service_tier=False,
        file_write=True,
        web_search=True,
        citations=False,
        image_input=False,
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
                "OpenCode currently permits read-only actions and "
                "stage-owned writes for code-analysis or synthesis only"
            )

        allows_web = (
            request.action == "vault-retrieval"
            and request.retrieval_mode == "web"
        )
        if is_stage_write:
            permission_profile = "stage-write"
        elif request.action == "vault-retrieval":
            permission_profile = "read-only-web" if allows_web else "read-only"
        else:
            permission_profile = "no-tools"

        command = [
            executable,
            "run",
            "--format",
            "json",
            "--dir",
            str(request.project_root),
            "--title",
            f"agent-dashboard:{permission_profile}",
            "--agent",
            "build",
        ]
        model = str(request.model or "").strip()
        if model:
            command.extend(["--model", model])
        effort = str(request.reasoning_effort or "").strip().lower()
        if effort in {"low", "medium", "high", "xhigh"}:
            command.extend(["--variant", effort])
        return command

    def parse_event(self, payload: dict[str, Any]) -> ParsedBackendEvent:
        parsed = ParsedBackendEvent()
        event_type = str(payload.get("type") or "").strip().lower()
        part = payload.get("part")
        part = part if isinstance(part, dict) else {}

        if event_type == "step_start":
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "model-started",
                    "label": "正在调用 OpenCode 并检查证据",
                }
            )
            return parsed

        if event_type == "tool_use":
            tool, tool_input = _tool_event(payload)
            if tool in {"websearch", "web_search"}:
                query = str(
                    tool_input.get("query")
                    or tool_input.get("search_query")
                    or ""
                ).strip()
                if query:
                    parsed.search_queries.append(query[:500])
                parsed.dashboard_events.append(
                    {
                        "type": "status",
                        "stage": "web-search",
                        "label": "正在执行联网搜索",
                    }
                )
            elif tool in {"webfetch", "web_fetch"}:
                url = _canonicalize_external_url(tool_input.get("url"))
                if url:
                    parsed.source_urls.add(url)
                parsed.dashboard_events.append(
                    {
                        "type": "status",
                        "stage": "web-search",
                        "label": "正在读取联网来源",
                    }
                )
            elif tool in {"read", "glob", "grep", "list"}:
                parsed.dashboard_events.append(
                    {
                        "type": "status",
                        "stage": "reading-evidence",
                        "label": "正在读取并核验候选证据",
                    }
                )
            return parsed

        if event_type == "text":
            text = str(part.get("text") or payload.get("text") or "").strip()
            if text:
                parsed.final_messages.append(text)
            return parsed

        if event_type == "step_finish":
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
                    "runtime permission profile",
                    "shell and external-directory access denied",
                    "host change manifest",
                    "post-run path audit",
                    "validator and rollback",
                ],
            },
        }
