"""Codex CLI implementation of the Dashboard agent backend protocol."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .base import (
    BACKEND_PROTOCOL_VERSION,
    BackendCapabilities,
    BackendCommandRequest,
    ParsedBackendEvent,
)


FAST_SERVICE_MODELS = {"gpt-5.6-terra", "gpt-5.6-sol"}


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
    path = parsed.path or "/"
    return urlunsplit(
        (
            parsed.scheme.lower(),
            netloc,
            path,
            parsed.query,
            "",
        )
    )


def _collect_type_markers(value: Any) -> set[str]:
    markers: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"type", "name", "tool_name"} and isinstance(child, str):
                markers.add(child.lower())
            elif isinstance(child, (dict, list)):
                markers.update(_collect_type_markers(child))
    elif isinstance(value, list):
        for child in value:
            markers.update(_collect_type_markers(child))
    return markers


def is_web_search_event(event: dict[str, Any]) -> bool:
    return any(
        marker == "web_search"
        or marker == "web_search_call"
        or marker.startswith("web_search_")
        for marker in _collect_type_markers(event)
    )


def collect_web_event_metadata(
    value: Any,
    urls: set[str],
    queries: list[str],
) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"url", "uri"} and isinstance(child, str):
                canonical = _canonicalize_external_url(child)
                if canonical:
                    urls.add(canonical)
            elif key in {"query", "search_query"} and isinstance(child, str):
                query = child.strip()
                if query and query not in queries:
                    queries.append(query[:500])
            elif key == "queries" and isinstance(child, list):
                for item in child:
                    query = str(item or "").strip()
                    if query and query not in queries:
                        queries.append(query[:500])
            collect_web_event_metadata(child, urls, queries)
    elif isinstance(value, list):
        for child in value:
            collect_web_event_metadata(child, urls, queries)


class CodexCliBackend:
    backend_id = "codex-cli"
    label = "Codex CLI"
    capabilities = BackendCapabilities(
        structured_output=True,
        streaming=True,
        sessions=False,
        model_selection=True,
        reasoning_effort=True,
        service_tier=True,
        file_write=True,
        web_search=True,
        citations=True,
        image_input=False,
    )

    def effective_service_tier(self, model: str, requested: str) -> str:
        return (
            "fast"
            if requested == "fast" and model in FAST_SERVICE_MODELS
            else "default"
        )

    def build_command(
        self,
        executable: str,
        request: BackendCommandRequest,
    ) -> list[str]:
        effective_service_tier = self.effective_service_tier(
            request.model,
            request.service_tier,
        )
        command = [
            executable,
            "exec",
            "--ephemeral",
            "--color",
            "never",
            "-C",
            str(request.project_root),
            "-s",
            request.sandbox,
            "-c",
            'approval_policy="never"',
            "-c",
            f'model_reasoning_effort="{request.reasoning_effort}"',
            "-c",
            f'service_tier="{effective_service_tier}"',
        ]
        if request.action == "vault-retrieval":
            if request.output_schema is None:
                raise ValueError("vault retrieval requires an output schema")
            web_search_mode = (
                "live" if request.retrieval_mode == "web" else "disabled"
            )
            command.extend(
                [
                    "-c",
                    f'web_search="{web_search_mode}"',
                    "--json",
                    "--output-schema",
                    str(request.output_schema),
                ]
            )
        if request.model.strip():
            command.extend(["-m", request.model.strip()])
        command.append("-")
        return command

    def parse_event(self, payload: dict[str, Any]) -> ParsedBackendEvent:
        parsed = ParsedBackendEvent()
        event_type = str(payload.get("type") or "")
        item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
        item_type = str(item.get("type") or "")
        if is_web_search_event(payload):
            collect_web_event_metadata(
                payload,
                parsed.source_urls,
                parsed.search_queries,
            )
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "web-search",
                    "label": (
                        "正在核对联网来源"
                        if event_type.endswith("completed")
                        else "正在执行联网搜索"
                    ),
                }
            )
        elif event_type == "turn.started":
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "model-started",
                    "label": "正在调用模型并检查证据",
                }
            )
        elif item_type in {"command_execution", "mcp_tool_call"}:
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "reading-evidence",
                    "label": "正在读取并核验候选证据",
                }
            )
        elif item_type == "agent_message" and event_type.endswith("completed"):
            parsed.dashboard_events.append(
                {
                    "type": "status",
                    "stage": "structuring-answer",
                    "label": "正在整理回答与来源",
                }
            )
        if (
            event_type.endswith("completed")
            and item_type == "agent_message"
            and isinstance(item.get("text"), str)
        ):
            parsed.final_messages.append(item["text"])
        return parsed

    def describe(self) -> dict[str, Any]:
        return {
            "schema_version": BACKEND_PROTOCOL_VERSION,
            "id": self.backend_id,
            "label": self.label,
            "capabilities": self.capabilities.to_payload(),
        }
